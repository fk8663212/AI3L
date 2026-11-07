import { get } from "@/lib/storage/blob-store";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { artifacts, studentSessions } from "@/lib/db/schema";
import { STAGE_IDS } from "@/lib/domain/stages";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import { getDriveFileStream } from "@/lib/storage/google-drive";
import { privateFileResponse } from "@/lib/storage/file-response";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const claims = await getStudentClaims();
    if (!claims) throw new ApiError(401, "UNAUTHORIZED", "請先輸入學生代碼。");
    const { id } = await context.params;
    const parsedId = z.string().uuid().safeParse(id);
    if (!parsedId.success) {
      throw new ApiError(404, "ARTIFACT_NOT_FOUND", "找不到檔案。");
    }
    const db = getDb();
    const rows = await db
      .select({
        artifact: artifacts,
        currentStage: studentSessions.currentStage,
        completedAt: studentSessions.completedAt,
      })
      .from(artifacts)
      .innerJoin(studentSessions, eq(artifacts.sessionId, studentSessions.id))
      .where(
        and(
          eq(artifacts.id, parsedId.data),
          eq(artifacts.sessionId, claims.sessionId),
          isNull(artifacts.supersededAt),
        ),
      )
      .limit(1);
    const found = rows[0];
    const artifact = found?.artifact;
    // Same visibility rule as the session view: no files from later stages
    // (e.g. a precomputed AI annotation) and none from earlier stages during
    // the posttest.
    const artifactStage = artifact ? STAGE_IDS.indexOf(artifact.stageId) : -1;
    const currentStage = found ? STAGE_IDS.indexOf(found.currentStage) : -1;
    const concealPriorStages =
      found?.currentStage === "posttest" && !found.completedAt;
    const visible =
      artifactStage >= 0 &&
      (concealPriorStages
        ? artifactStage === currentStage
        : artifactStage <= currentStage);
    if (!artifact?.storageLocator || !visible) {
      throw new ApiError(404, "ARTIFACT_NOT_FOUND", "找不到檔案。");
    }

    if (artifact.storageProvider === "google-drive") {
      const file = await getDriveFileStream(artifact.storageLocator);
      return privateFileResponse(request, {
        stream: file.stream as ReadableStream<Uint8Array>,
        size: file.size ? Number(file.size) : undefined, contentType: file.mimeType, filename: file.name,
      });
    }

    const blob = await get(artifact.storageLocator, { access: "private" });
    if (!blob || blob.statusCode === 304 || !blob.stream) {
      throw new ApiError(404, "BLOB_NOT_FOUND", "找不到 Blob 檔案。");
    }
    return privateFileResponse(request, {
      stream: blob.stream, size: blob.blob.size, contentType: blob.blob.contentType,
      filename: blob.blob.pathname.split("/").at(-1) || "recording", etag: blob.blob.etag,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
