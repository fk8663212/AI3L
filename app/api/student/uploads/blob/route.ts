import {
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { presignedPayloadFromUrl } from "@/lib/domain/blob-upload";
import { SUPPORTED_AUDIO_MIME_TYPES } from "@/lib/domain/recordings";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import { getSessionUploadAuthorization } from "@/lib/services/session-service";

const payloadSchema = z.object({
  kind: z.enum(["image", "audio"]),
  stage: z.enum([
    "pretest",
    "visualization",
    "self_concept_map",
    "sentence_scaffold",
    "posttest",
  ]),
});

const requestSchema = z.object({
  type: z.literal("blob.generate-presigned-url"),
  payload: z.object({
    pathname: z.string().min(1).max(1_024),
    clientPayload: z.string().nullable(),
    multipart: z.boolean(),
  }),
});

const SIGNED_UPLOAD_TTL_MS = 10 * 60 * 1_000;
const SIGNED_TOKEN_TIMEOUT_MS = 10_000;

export async function POST(request: Request) {
  try {
    const claims = await getStudentClaims();
    if (!claims) throw new ApiError(401, "UNAUTHORIZED", "請先輸入學生代碼。");
    const body = requestSchema.parse(await request.json());
    if (body.payload.multipart) {
      throw new ApiError(400, "MULTIPART_NOT_SUPPORTED", "此上傳不支援分段模式。");
    }

    const payload = payloadSchema.parse(
      JSON.parse(body.payload.clientPayload ?? "{}"),
    );
    const session = await getSessionUploadAuthorization(claims.sessionId);
    if (!session.consented) {
      throw new ApiError(409, "CONSENT_REQUIRED", "請先同意資料說明。");
    }
    if (session.currentStage !== payload.stage) {
      throw new ApiError(409, "STAGE_LOCKED", "此階段目前不可上傳檔案。");
    }
    const expectedPrefix = `student/${claims.sessionId}/${payload.stage}/`;
    if (!body.payload.pathname.startsWith(expectedPrefix)) {
      throw new ApiError(400, "INVALID_PATH", "上傳路徑無效。");
    }
    const imageStage =
      payload.stage === "visualization" ||
      payload.stage === "self_concept_map";
    if (payload.kind === "image" && !imageStage) {
      throw new ApiError(
        400,
        "INVALID_UPLOAD",
        "圖片只能在手繪情境或手繪概念圖階段上傳。",
      );
    }
    if (payload.kind === "audio" && imageStage) {
      throw new ApiError(400, "INVALID_UPLOAD", "此階段不接受錄音。");
    }

    const allowedContentTypes =
      payload.kind === "image"
        ? ["image/jpeg", "image/png", "image/webp"]
        : [...SUPPORTED_AUDIO_MIME_TYPES];
    const maximumSizeInBytes =
      payload.kind === "image" ? 10 * 1024 * 1024 : 12 * 1024 * 1024;
    const validUntil = Date.now() + SIGNED_UPLOAD_TTL_MS;
    const token = await issueSignedToken({
      pathname: body.payload.pathname,
      operations: ["put"],
      allowedContentTypes,
      maximumSizeInBytes,
      validUntil,
      abortSignal: AbortSignal.timeout(SIGNED_TOKEN_TIMEOUT_MS),
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: "put",
      pathname: body.payload.pathname,
      access: "private",
      allowedContentTypes,
      maximumSizeInBytes,
      validUntil,
      addRandomSuffix: true,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
    });

    return NextResponse.json({
      type: "blob.generate-presigned-url",
      presignedUrlPayload: presignedPayloadFromUrl(presignedUrl),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
