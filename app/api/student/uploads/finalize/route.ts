import { del, get, head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiErrorResponse,
  ApiError,
  assertSameOrigin,
} from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import { analyzeRecording } from "@/lib/ai/voice-service";
import {
  getSessionView,
  saveArtifact,
  saveRecordingBundle,
} from "@/lib/services/session-service";
import {
  trashDriveFile,
  uploadAudioToDrive,
} from "@/lib/storage/google-drive";

export const maxDuration = 60;

const bodySchema = z.object({
  kind: z.enum(["image", "audio"]),
  stage: z.enum([
    "pretest",
    "visualization",
    "self_concept_map",
    "sentence_scaffold",
    "posttest",
  ]),
  url: z.string().url(),
  durationSeconds: z.number().min(1).max(180).optional(),
});

function extensionForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "wav";
}

export async function POST(request: Request) {
  let driveFileId: string | undefined;
  try {
    assertSameOrigin(request);
    const claims = await getStudentClaims();
    if (!claims) throw new ApiError(401, "UNAUTHORIZED", "請先輸入學生代碼。");
    const body = bodySchema.parse(await request.json());
    const view = await getSessionView(claims.sessionId);
    if (view.session.currentStage !== body.stage) {
      throw new ApiError(409, "STAGE_LOCKED", "此階段目前不可完成上傳。");
    }
    const imageStage =
      body.stage === "visualization" || body.stage === "self_concept_map";
    if (body.kind === "image" && !imageStage) {
      throw new ApiError(400, "INVALID_UPLOAD", "此階段不接受圖片。");
    }
    if (body.kind === "audio" && imageStage) {
      throw new ApiError(400, "INVALID_UPLOAD", "此階段不接受錄音。");
    }

    const metadata = await head(body.url);
    const expectedPrefix = `student/${claims.sessionId}/${body.stage}/`;
    if (!metadata.pathname.startsWith(expectedPrefix)) {
      throw new ApiError(403, "INVALID_UPLOAD_OWNER", "檔案不屬於此工作階段。");
    }

    const existing = view.artifacts.find(
      (artifact) =>
        artifact.stageId === body.stage &&
        artifact.type === body.kind &&
        artifact.data.stagingPathname === metadata.pathname,
    );
    if (existing) {
      return NextResponse.json({ ok: true, data: view });
    }

    if (body.kind === "image") {
      if (!metadata.contentType.startsWith("image/")) {
        throw new ApiError(400, "INVALID_IMAGE", "上傳檔案不是支援的圖片。");
      }
      await saveArtifact({
        sessionId: claims.sessionId,
        stageId: body.stage,
        type: "image",
        storageProvider: "vercel-blob",
        storageLocator: body.url,
        mimeType: metadata.contentType,
        sizeBytes: metadata.size,
        data: {
          pathname: metadata.pathname,
          stagingPathname: metadata.pathname,
        },
      });
    } else {
      if (!metadata.contentType.startsWith("audio/")) {
        throw new ApiError(400, "INVALID_AUDIO", "上傳檔案不是支援的音訊。");
      }
      const stageConfig = view.task.config.stageConfig[body.stage];
      const durationSeconds = body.durationSeconds ?? 0;
      const minimumSeconds = stageConfig.minimumRecordingSeconds ?? 1;
      const maximumSeconds = stageConfig.maximumRecordingSeconds ?? 180;
      if (
        durationSeconds < minimumSeconds ||
        durationSeconds > maximumSeconds
      ) {
        throw new ApiError(
          400,
          "INVALID_RECORDING_DURATION",
          `錄音長度必須介於 ${minimumSeconds} 到 ${maximumSeconds} 秒。`,
        );
      }
      const source = await get(body.url, { access: "private" });
      if (!source || source.statusCode === 304 || !source.stream) {
        throw new ApiError(404, "AUDIO_NOT_FOUND", "找不到暫存錄音。");
      }

      const bytes = new Uint8Array(
        await new Response(source.stream).arrayBuffer(),
      );
      const extension = extensionForMime(metadata.contentType);
      const driveFile = await uploadAudioToDrive({
        stream: new Blob([bytes], { type: metadata.contentType }).stream(),
        mimeType: metadata.contentType,
        taskSlug: view.task.id,
        sessionId: claims.sessionId,
        stageId: body.stage,
        extension,
      });
      driveFileId = driveFile.id ?? undefined;
      if (!driveFileId) throw new Error("Drive upload completed without file ID.");

      const analysis = await analyzeRecording({
        sessionId: claims.sessionId,
        stageId: body.stage,
        mimeType: metadata.contentType,
        bytes,
        filename: `${body.stage}.${extension}`,
        durationSeconds,
      });
      await saveRecordingBundle({
        sessionId: claims.sessionId,
        stageId: body.stage,
        audio: {
          storageLocator: driveFileId,
          mimeType: metadata.contentType,
          sizeBytes: Number(driveFile.size ?? metadata.size),
          data: {
            driveName: driveFile.name,
            driveWebViewLink: driveFile.webViewLink,
            durationSeconds,
            stagingPathname: metadata.pathname,
          },
        },
        transcript: analysis.transcript,
        evaluation: analysis.evaluation,
      });
      await del(body.url);
    }

    return NextResponse.json({
      ok: true,
      data: await getSessionView(claims.sessionId),
    });
  } catch (error) {
    if (driveFileId) {
      try {
        await trashDriveFile(driveFileId);
      } catch {
        // Compensation is best-effort; the orphan is still visible to the admin.
      }
    }
    return apiErrorResponse(error);
  }
}
