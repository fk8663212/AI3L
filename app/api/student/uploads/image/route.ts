import { del, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  ApiError,
  assertSameOrigin,
} from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import {
  getSessionView,
  saveArtifact,
} from "@/lib/services/session-service";

export const maxDuration = 60;

const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function POST(request: Request) {
  let uploadedUrl: string | undefined;
  try {
    assertSameOrigin(request);
    const claims = await getStudentClaims();
    if (!claims) {
      throw new ApiError(401, "UNAUTHORIZED", "請重新登入學生介面。");
    }

    const view = await getSessionView(claims.sessionId);
    if (!view.session.consented) {
      throw new ApiError(409, "CONSENT_REQUIRED", "請先完成研究同意程序。");
    }
    if (view.session.currentStage !== "visualization") {
      throw new ApiError(
        409,
        "STAGE_LOCKED",
        "目前階段不接受手繪圖上傳。",
      );
    }

    const formData = await request.formData();
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

    const blob = await put(
      `student/${claims.sessionId}/visualization/drawing.webp`,
      file,
      {
        access: "private",
        contentType: file.type,
        addRandomSuffix: true,
        cacheControlMaxAge: 60,
      },
    );
    uploadedUrl = blob.url;

    await saveArtifact({
      sessionId: claims.sessionId,
      stageId: "visualization",
      type: "image",
      storageProvider: "vercel-blob",
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
