import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import { getSessionView } from "@/lib/services/session-service";

const payloadSchema = z.object({
  kind: z.enum(["image", "audio"]),
  stage: z.enum([
    "pretest",
    "visualization",
    "sentence_scaffold",
    "posttest",
  ]),
});

export async function POST(request: Request) {
  try {
    const claims = await getStudentClaims();
    if (!claims) throw new ApiError(401, "UNAUTHORIZED", "請先輸入學生代碼。");
    const body = (await request.json()) as HandleUploadBody;

    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = payloadSchema.parse(JSON.parse(clientPayload ?? "{}"));
        const view = await getSessionView(claims.sessionId);
        if (!view.session.consented) {
          throw new ApiError(409, "CONSENT_REQUIRED", "請先同意資料說明。");
        }
        if (view.session.currentStage !== payload.stage) {
          throw new ApiError(409, "STAGE_LOCKED", "此階段目前不可上傳檔案。");
        }
        const expectedPrefix = `student/${claims.sessionId}/${payload.stage}/`;
        if (!pathname.startsWith(expectedPrefix)) {
          throw new ApiError(400, "INVALID_PATH", "上傳路徑無效。");
        }
        if (
          payload.kind === "image" &&
          payload.stage !== "visualization"
        ) {
          throw new ApiError(400, "INVALID_UPLOAD", "圖片只能在手繪階段上傳。");
        }
        if (payload.kind === "audio" && payload.stage === "visualization") {
          throw new ApiError(400, "INVALID_UPLOAD", "此階段不接受錄音。");
        }

        return {
          allowedContentTypes:
            payload.kind === "image"
              ? ["image/jpeg", "image/png", "image/webp"]
              : ["audio/wav", "audio/webm", "audio/mp4", "audio/ogg"],
          maximumSizeInBytes:
            payload.kind === "image" ? 10 * 1024 * 1024 : 12 * 1024 * 1024,
          addRandomSuffix: true,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify({
            ...payload,
            sessionId: claims.sessionId,
          }),
        };
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
