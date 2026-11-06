import { del, put, uploadStorageProvider } from "@/lib/storage/blob-store";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { artifacts, studentSessions } from "@/lib/db/schema";
import {
  apiErrorResponse,
  ApiError,
  assertSameOrigin,
} from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import { invalidateImageAnalysisAfterSourceDeletion } from "@/lib/ai/provider-service";
import {
  getSessionView,
  saveUploadedImage,
} from "@/lib/services/session-service";

export const maxDuration = 180;

const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const imageStageSchema = z.enum(["visualization", "self_concept_map"]);
const deleteImageSchema = z.object({
  artifactId: z.string().uuid(),
});

export async function POST(request: Request) {
  let uploadedUrl: string | undefined;
  try {
    assertSameOrigin(request);
    const claims = await getStudentClaims();
    if (!claims) {
      throw new ApiError(401, "UNAUTHORIZED", "請重新登入學生介面。");
    }

    const formData = await request.formData();
    const stage = imageStageSchema.parse(formData.get("stage"));
    const view = await getSessionView(claims.sessionId);
    if (!view.session.consented) {
      throw new ApiError(409, "CONSENT_REQUIRED", "請先完成研究同意程序。");
    }
    if (view.session.currentStage !== stage) {
      throw new ApiError(
        409,
        "STAGE_LOCKED",
        "目前階段不接受手繪圖上傳。",
      );
    }

    if (
      view.artifacts.some(
        (artifact) => artifact.stageId === stage && artifact.type === "image",
      )
    ) {
      throw new ApiError(
        409,
        "IMAGE_EXISTS",
        "此階段已有上傳圖片；請先刪除原圖片再重新上傳。",
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "IMAGE_REQUIRED", "請選擇要上傳的圖片。");
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      throw new ApiError(
        400,
        "INVALID_IMAGE",
        "僅接受 JPG、PNG 或 WebP 圖片。",
      );
    }
    if (file.size < 1 || file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new ApiError(
        413,
        "IMAGE_TOO_LARGE",
        "處理後的圖片不可超過 4 MB。",
      );
    }

    const filename =
      stage === "visualization" ? "drawing.webp" : "concept-map.webp";
    const blob = await put(
      `student/${claims.sessionId}/${stage}/${filename}`,
      file,
      {
        access: "private",
        contentType: file.type,
        addRandomSuffix: true,
        cacheControlMaxAge: 60,
      },
    );
    uploadedUrl = blob.url;

    await saveUploadedImage({
      sessionId: claims.sessionId,
      stageId: stage,
      storageProvider: uploadStorageProvider(),
      storageLocator: blob.url,
      mimeType: file.type,
      sizeBytes: file.size,
      data: {
        pathname: blob.pathname,
        stagingPathname: blob.pathname,
        uploadChannel: "server-fallback",
      },
    });

    return NextResponse.json({
      ok: true,
      data: await getSessionView(claims.sessionId),
    });
  } catch (error) {
    if (uploadedUrl) {
      try {
        await del(uploadedUrl);
      } catch {
        // Cleanup is best-effort if saving the artifact fails.
      }
    }
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const claims = await getStudentClaims();
    if (!claims) {
      throw new ApiError(401, "UNAUTHORIZED", "請重新登入學生介面。");
    }

    const body = deleteImageSchema.parse(await request.json());
    const db = getDb();
    const rows = await db
      .select({
        artifact: artifacts,
        currentStage: studentSessions.currentStage,
      })
      .from(artifacts)
      .innerJoin(
        studentSessions,
        eq(artifacts.sessionId, studentSessions.id),
      )
      .where(
        and(
          eq(artifacts.id, body.artifactId),
          eq(artifacts.sessionId, claims.sessionId),
          isNull(artifacts.supersededAt),
        ),
      )
      .limit(1);
    const found = rows[0];
    if (!found) {
      throw new ApiError(404, "IMAGE_NOT_FOUND", "找不到可刪除的圖片。");
    }

    const stage = imageStageSchema.safeParse(found.artifact.stageId);
    if (
      !stage.success ||
      found.artifact.type !== "image" ||
      !["vercel-blob", "local"].includes(found.artifact.storageProvider ?? "")
    ) {
      throw new ApiError(400, "INVALID_IMAGE", "此檔案不是學生上傳圖片。");
    }
    if (found.currentStage !== stage.data) {
      throw new ApiError(
        409,
        "STAGE_LOCKED",
        "只能刪除目前階段上傳的圖片。",
      );
    }

    const deletedAt = new Date();
    const updated = await db
      .update(artifacts)
      .set({
        status: "deleted",
        supersededAt: deletedAt,
        updatedAt: deletedAt,
      })
      .where(
        and(
          eq(artifacts.id, found.artifact.id),
          isNull(artifacts.supersededAt),
        ),
      )
      .returning({ id: artifacts.id });
    if (!updated[0]) {
      throw new ApiError(
        409,
        "IMAGE_ALREADY_CHANGED",
        "圖片狀態已改變，請重新整理後再試。",
      );
    }

    try {
      if (found.artifact.storageLocator) {
        await del(found.artifact.storageLocator);
      }
    } catch {
      await db
        .update(artifacts)
        .set({
          status: found.artifact.status,
          supersededAt: null,
          updatedAt: new Date(),
        })
        .where(eq(artifacts.id, found.artifact.id));
      throw new ApiError(
        502,
        "BLOB_DELETE_FAILED",
        "圖片刪除失敗，原圖片已保留，請稍後再試。",
      );
    }
    if (stage.data === "visualization") {
      try {
        await invalidateImageAnalysisAfterSourceDeletion(claims.sessionId);
      } catch (error) {
        console.error("Failed to invalidate deleted image analysis", {
          sessionId: claims.sessionId,
          sourceImageArtifactId: found.artifact.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      data: await getSessionView(claims.sessionId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
