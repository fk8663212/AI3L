import { get } from "@/lib/storage/blob-store";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { artifacts } from "@/lib/db/schema";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";
import { getDriveFileStream } from "@/lib/storage/google-drive";

const paramsSchema = z.object({
  sessionId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ sessionId: string; artifactId: string }>;
  },
) {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    const { sessionId, artifactId } = paramsSchema.parse(await context.params);
    const db = getDb();
    const artifact = await db.query.artifacts.findFirst({
      where: and(
        eq(artifacts.id, artifactId),
        eq(artifacts.sessionId, sessionId),
      ),
    });
    if (!artifact?.storageLocator) {
      throw new ApiError(404, "ARTIFACT_NOT_FOUND", "找不到指定檔案。");
    }

    if (artifact.storageProvider === "google-drive") {
      const file = await getDriveFileStream(artifact.storageLocator);
      return new Response(file.stream as unknown as BodyInit, {
        headers: {
          "content-type": file.mimeType,
          "content-disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
          "cache-control": "private, no-store",
        },
      });
    }

    const blob = await get(artifact.storageLocator, { access: "private" });
    if (!blob || blob.statusCode === 304 || !blob.stream) {
      throw new ApiError(404, "BLOB_NOT_FOUND", "找不到指定的 Blob 檔案。");
    }
    return new Response(blob.stream, {
      headers: {
        "content-type": blob.blob.contentType,
        etag: blob.blob.etag,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
