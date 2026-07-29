import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { artifacts } from "@/lib/db/schema";
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
    const db = getDb();
    const artifact = await db.query.artifacts.findFirst({
      where: and(
        eq(artifacts.id, id),
        eq(artifacts.sessionId, claims.sessionId),
      ),
    });
    if (!artifact?.storageLocator) {
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
