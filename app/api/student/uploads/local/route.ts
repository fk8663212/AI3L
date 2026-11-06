import { NextResponse } from "next/server";
import { z } from "zod";
import { SUPPORTED_AUDIO_MIME_TYPES, normalizeAudioMimeType } from "@/lib/domain/recordings";
import { apiErrorResponse, ApiError, assertSameOrigin } from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import { getSessionUploadAuthorization } from "@/lib/services/session-service";
import { localStorageEnabled, put } from "@/lib/storage/blob-store";

const payloadSchema = z.object({
  kind: z.enum(["image", "audio"]),
  stage: z.enum(["pretest", "visualization", "self_concept_map", "sentence_scaffold", "posttest"]),
  pathname: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!localStorageEnabled()) throw new ApiError(404, "NOT_FOUND", "未啟用本機儲存。");
    const claims = await getStudentClaims();
    if (!claims) throw new ApiError(401, "UNAUTHORIZED", "請先輸入學生代碼。");
    // Bound the multipart body even if the browser omits Content-Length.
    const maximumBody = 13 * 1024 * 1024;
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "FILE_REQUIRED", "請選擇檔案。");
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumBody) { await reader.cancel(); throw new ApiError(413, "FILE_TOO_LARGE", "檔案超過上傳大小限制。"); }
        chunks.push(new Uint8Array(value));
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(new Blob(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const payload = payloadSchema.parse(Object.fromEntries(["kind", "stage", "pathname"].map((key) => [key, form.get(key)])));
    const session = await getSessionUploadAuthorization(claims.sessionId);
    if (!session.consented) throw new ApiError(409, "CONSENT_REQUIRED", "請先完成研究同意程序。");
    if (session.currentStage !== payload.stage) throw new ApiError(409, "STAGE_LOCKED", "此階段目前不可上傳檔案。");
    const prefix = `student/${claims.sessionId}/${payload.stage}/`;
    if (!payload.pathname.startsWith(prefix) || payload.pathname.slice(prefix.length).includes("/")) throw new ApiError(400, "INVALID_PATH", "上傳路徑無效。");
    const imageStage = ["visualization", "self_concept_map"].includes(payload.stage);
    if ((payload.kind === "image") !== imageStage) throw new ApiError(400, "INVALID_UPLOAD", "此階段不接受這種檔案。");
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "請選擇檔案。");
    const mime = normalizeAudioMimeType(file.type);
    const allowed: readonly string[] = imageStage ? ["image/jpeg", "image/png", "image/webp"] : SUPPORTED_AUDIO_MIME_TYPES;
    if (!allowed.includes(mime)) throw new ApiError(400, "INVALID_FILE_TYPE", "不支援這種檔案格式。");
    const maximumSize = (imageStage ? 10 : 12) * 1024 * 1024;
    if (!file.size || file.size > maximumSize) throw new ApiError(413, "FILE_TOO_LARGE", "檔案超過上傳大小限制。");
    const blob = await put(payload.pathname, file, { access: "private", contentType: mime, addRandomSuffix: true });
    return NextResponse.json({ ok: true, data: { url: blob.url, pathname: blob.pathname } });
  } catch (error) { return apiErrorResponse(error); }
}
