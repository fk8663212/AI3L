import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { getDb } from "@/lib/db/client";
import { appConnections } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { ApiError } from "@/lib/security/request";

const CONNECTION_KIND = "google_drive";

function oauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !clientSecret || !appUrl) {
    throw new ApiError(
      503,
      "GOOGLE_OAUTH_NOT_CONFIGURED",
      "Google OAuth 環境變數尚未設定。",
    );
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${appUrl.replace(/\/$/, "")}/api/admin/google/callback`,
  );
}

export function googleAuthorizationUrl(state: string): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/drive.file",
    ],
    state,
  });
}

async function ensureFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string,
): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const existing = await drive.files.list({
    q: `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`,
    spaces: "drive",
    fields: "files(id,name)",
    pageSize: 1,
  });
  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Could not create Drive folder: ${name}`);
  return created.data.id;
}

export async function completeGoogleConnection(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new ApiError(
      400,
      "GOOGLE_REFRESH_TOKEN_MISSING",
      "Google 未回傳離線授權，請移除舊授權後重新連接。",
    );
  }
  client.setCredentials(tokens);
  const oauth = google.oauth2({ version: "v2", auth: client });
  const identity = await oauth.userinfo.get();
  const drive = google.drive({ version: "v3", auth: client });
  const rootFolderId = await ensureFolder(drive, "AI3L Speaking Research");
  const encrypted = encryptSecret(tokens.refresh_token);
  const db = getDb();

  await db
    .insert(appConnections)
    .values({
      kind: CONNECTION_KIND,
      encryptedValue: encrypted.encryptedValue,
      encryptionIv: encrypted.encryptionIv,
      encryptionTag: encrypted.encryptionTag,
      metadata: {
        email: identity.data.email ?? null,
        rootFolderId,
        rootFolderName: "AI3L Speaking Research",
      },
      verifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConnections.kind,
      set: {
        encryptedValue: encrypted.encryptedValue,
        encryptionIv: encrypted.encryptionIv,
        encryptionTag: encrypted.encryptionTag,
        metadata: {
          email: identity.data.email ?? null,
          rootFolderId,
          rootFolderName: "AI3L Speaking Research",
        },
        verifiedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function googleDriveStatus() {
  const db = getDb();
  const connection = await db.query.appConnections.findFirst({
    where: eq(appConnections.kind, CONNECTION_KIND),
  });
  return connection
    ? {
        connected: true,
        email:
          typeof connection.metadata.email === "string"
            ? connection.metadata.email
            : null,
        rootFolderId:
          typeof connection.metadata.rootFolderId === "string"
            ? connection.metadata.rootFolderId
            : null,
        verifiedAt: connection.verifiedAt?.toISOString() ?? null,
      }
    : { connected: false, email: null, rootFolderId: null, verifiedAt: null };
}

async function authorizedDrive() {
  const db = getDb();
  const connection = await db.query.appConnections.findFirst({
    where: eq(appConnections.kind, CONNECTION_KIND),
  });
  if (!connection) {
    throw new ApiError(
      503,
      "DRIVE_NOT_CONNECTED",
      "管理員尚未連接 Google Drive。",
    );
  }

  const client = oauthClient();
  client.setCredentials({
    refresh_token: decryptSecret({
      encryptedValue: connection.encryptedValue,
      encryptionIv: connection.encryptionIv,
      encryptionTag: connection.encryptionTag,
    }),
  });
  return {
    drive: google.drive({ version: "v3", auth: client }),
    rootFolderId: String(connection.metadata.rootFolderId),
  };
}

export async function uploadAudioToDrive(input: {
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  taskSlug: string;
  sessionId: string;
  stageId: string;
  extension: string;
}) {
  const { drive, rootFolderId } = await authorizedDrive();
  const taskFolder = await ensureFolder(drive, input.taskSlug, rootFolderId);
  const sessionFolder = await ensureFolder(drive, input.sessionId, taskFolder);
  const filename = `${input.stageId}-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.${input.extension}`;

  const created = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [sessionFolder],
      description: `AI3L speaking recording: ${input.stageId}`,
    },
    media: {
      mimeType: input.mimeType,
      body: Readable.fromWeb(input.stream as never),
    },
    fields: "id,name,mimeType,size,webViewLink,createdTime",
  });
  if (!created.data.id) throw new Error("Google Drive did not return a file ID.");
  return created.data;
}

export async function trashDriveFile(fileId: string): Promise<void> {
  const { drive } = await authorizedDrive();
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
  });
}

export async function getDriveFileStream(fileId: string) {
  const { drive } = await authorizedDrive();
  const metadata = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size",
  });
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" },
  );
  return {
    stream: Readable.toWeb(response.data as Readable) as unknown as ReadableStream<Uint8Array>,
    name: metadata.data.name ?? "recording.wav",
    mimeType: metadata.data.mimeType ?? "audio/wav",
    size: metadata.data.size ?? null,
  };
}

export async function disconnectGoogleDrive(): Promise<void> {
  const db = getDb();
  await db
    .delete(appConnections)
    .where(eq(appConnections.kind, CONNECTION_KIND));
}
