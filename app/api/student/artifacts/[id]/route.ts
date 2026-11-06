import { get } from "@/lib/storage/blob-store";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { artifacts, studentSessions } from "@/lib/db/schema";
import { STAGE_IDS } from "@/lib/domain/stages";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import { getDriveFileStream } from "@/lib/storage/google-drive";

export async function GET(
  _request: Request,
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
      throw new ApiError(404, "BLOB_NOT_FOUND", "找不到 Blob 檔案。");
    }
    return new Response(blob.stream, {
      headers: {
        "content-type": blob.blob.contentType,
        etag: blob.blob.etag,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
