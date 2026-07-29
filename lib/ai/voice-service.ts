import { eq } from "drizzle-orm";
import {
  generateStructured,
  OPENAI_TRANSCRIPTION_MODEL,
  transcribeAudio,
} from "@/lib/ai/provider";
import { taskAIContext } from "@/lib/ai/provider-service";
import { speechEvaluationPrompt } from "@/lib/ai/prompts";
import { speechEvaluationSchema } from "@/lib/ai/schemas";
import { getDb } from "@/lib/db/client";
import { aiRuns } from "@/lib/db/schema";
import type { StageId } from "@/lib/domain/stages";
import { hashForLog } from "@/lib/security/crypto";
import { ApiError } from "@/lib/security/request";

const RECORDING_STAGES = new Set<StageId>([
  "pretest",
  "sentence_scaffold",
  "posttest",
]);

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

async function finishRun(
  runId: string,
  startedAt: number,
  result: {
    providerResponseId?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  },
) {
  const db = getDb();
  await db
    .update(aiRuns)
    .set({
      status: "completed",
      providerResponseId: result.providerResponseId,
      latencyMs: Date.now() - startedAt,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      completedAt: new Date(),
    })
    .where(eq(aiRuns.id, runId));
}

async function failRun(runId: string, startedAt: number, error: unknown) {
  const db = getDb();
  await db
    .update(aiRuns)
    .set({
      status: "failed",
      latencyMs: Date.now() - startedAt,
      errorCode: "PROVIDER_ERROR",
      errorMessage:
        error instanceof Error ? error.message.slice(0, 500) : "Unknown",
      completedAt: new Date(),
    })
    .where(eq(aiRuns.id, runId));
}

export async function analyzeRecording(input: {
  sessionId: string;
  stageId: StageId;
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  durationSeconds: number;
}) {
  if (!RECORDING_STAGES.has(input.stageId)) {
    throw new ApiError(400, "INVALID_RECORDING_STAGE", "此階段不接受錄音分析。");
  }

  const db = getDb();
  const context = await taskAIContext(input.sessionId);
  if (context.session.currentStage !== input.stageId) {
    throw new ApiError(409, "STAGE_LOCKED", "此錄音階段目前不可操作。");
  }

  const transcriptionModel =
    context.provider === "openai"
      ? OPENAI_TRANSCRIPTION_MODEL
      : context.task.modelId;
  const transcriptionPrompt = `faithful-en-transcript:${input.durationSeconds}`;
  const transcriptionStartedAt = Date.now();
  const transcriptionRun = (
    await db
      .insert(aiRuns)
      .values({
        sessionId: input.sessionId,
        stageId: input.stageId,
        provider: context.provider,
        modelId: transcriptionModel,
        promptVersion: context.task.promptVersion,
        promptHash: hashForLog(transcriptionPrompt),
        status: "running",
      })
      .returning()
  )[0];

  let transcript;
  try {
    transcript = await transcribeAudio({
      provider: context.provider,
      apiKey: context.apiKey,
      modelId: context.task.modelId,
      bytes: input.bytes,
      mimeType: input.mimeType,
      filename: input.filename,
      durationSeconds: input.durationSeconds,
    });
    await finishRun(transcriptionRun.id, transcriptionStartedAt, transcript);
  } catch (error) {
    await failRun(transcriptionRun.id, transcriptionStartedAt, error);
    throw new ApiError(
      502,
      "TRANSCRIPTION_FAILED",
      "錄音已收到，但逐字稿產生失敗；請稍後重新保存。",
    );
  }

  const basicWordsPerMinute = Math.round(
    (wordCount(transcript.value.text) / input.durationSeconds) * 60,
  );
  const evaluationPrompt = speechEvaluationPrompt({
    stage: input.stageId,
    transcript: transcript.value.text,
    durationSeconds: input.durationSeconds,
    wordsPerMinute: basicWordsPerMinute,
  });
  const evaluationStartedAt = Date.now();
  const evaluationRun = (
    await db
      .insert(aiRuns)
      .values({
        sessionId: input.sessionId,
        stageId: input.stageId,
        provider: context.provider,
        modelId: context.task.modelId,
        promptVersion: context.task.promptVersion,
        promptHash: hashForLog(evaluationPrompt),
        status: "running",
      })
      .returning()
  )[0];

  try {
    const evaluation = await generateStructured({
      provider: context.provider,
      apiKey: context.apiKey,
      modelId: context.task.modelId,
      schemaName: "speech_evaluation",
      schema: speechEvaluationSchema,
      system:
        "You analyze learner speech conservatively for education research. Return only schema-valid JSON and never invent acoustic measurements.",
      prompt: evaluationPrompt,
    });
    await finishRun(evaluationRun.id, evaluationStartedAt, evaluation);
    return {
      transcript: transcript.value,
      evaluation: {
        ...evaluation.value,
        wordsPerMinute: basicWordsPerMinute,
      },
    };
  } catch (error) {
    await failRun(evaluationRun.id, evaluationStartedAt, error);
    throw new ApiError(
      502,
      "SPEECH_EVALUATION_FAILED",
      "逐字稿已產生，但口說分析失敗；請稍後重新保存。",
    );
  }
}
