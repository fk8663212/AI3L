import { get } from "@vercel/blob";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  aiRuns,
  artifacts,
  providerCredentials,
  studentSessions,
  tasks,
} from "@/lib/db/schema";
import {
  conceptMapSchema,
  imageAnalysisSchema,
  sentenceScaffoldSchema,
} from "@/lib/ai/schemas";
import type { ZodType } from "zod";
import {
  generateStructured,
  type AIProviderName,
  type BinaryInput,
} from "@/lib/ai/provider";
import {
  BASE_SYSTEM_PROMPT,
  conceptExpansionPrompt,
  imageAnalysisPrompt,
  sentenceScaffoldPrompt,
} from "@/lib/ai/prompts";
import { decryptSecret, hashForLog } from "@/lib/security/crypto";
import { ApiError } from "@/lib/security/request";
import {
  replaceArtifactData,
  saveMessage,
} from "@/lib/services/session-service";

export async function taskAIContext(sessionId: string) {
  const db = getDb();
  const joined = await db
    .select({ session: studentSessions, task: tasks })
    .from(studentSessions)
    .innerJoin(tasks, eq(studentSessions.taskId, tasks.id))
    .where(eq(studentSessions.id, sessionId))
    .limit(1);
  const found = joined[0];
  if (!found) throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");

  const credential = await db.query.providerCredentials.findFirst({
    where: and(
      eq(providerCredentials.provider, found.task.provider),
      eq(providerCredentials.enabled, true),
    ),
  });
  if (!credential) {
    throw new ApiError(
      503,
      "AI_NOT_CONFIGURED",
      "此任務的 AI 供應商尚未完成 API Key 設定。",
    );
  }

  return {
    ...found,
    provider: found.task.provider as AIProviderName,
    apiKey: decryptSecret({
      encryptedValue: credential.encryptedKey,
      encryptionIv: credential.encryptionIv,
      encryptionTag: credential.encryptionTag,
    }),
  };
}

async function privateBlobBytes(locator: string): Promise<BinaryInput> {
  const blob = await get(locator, { access: "private" });
  if (!blob || blob.statusCode === 304 || !blob.stream) {
    throw new ApiError(404, "IMAGE_NOT_FOUND", "找不到可分析的圖片。");
  }
  const bytes = new Uint8Array(
    await new Response(blob.stream).arrayBuffer(),
  );
  return {
    bytes,
    mimeType: blob.blob.contentType || "image/jpeg",
  };
}

export async function runStageAI(
  sessionId: string,
  stage: "image_analysis" | "ai_concept_map" | "sentence_scaffold",
) {
  const db = getDb();
  const context = await taskAIContext(sessionId);
  if (context.session.currentStage !== stage) {
    throw new ApiError(409, "STAGE_LOCKED", "此 AI 階段目前不可操作。");
  }

  const artifactRows = await db.query.artifacts.findMany({
    where: and(
      eq(artifacts.sessionId, sessionId),
      isNull(artifacts.supersededAt),
    ),
    orderBy: [desc(artifacts.createdAt)],
  });
  const now = Date.now();
  let schemaName: string;
  let prompt: string;
  let schema: ZodType<unknown>;
  let binary: BinaryInput | undefined;

  if (stage === "image_analysis") {
    const image = artifactRows.find(
      (row) => row.stageId === "visualization" && row.type === "image",
    );
    const labels = artifactRows.find(
      (row) => row.stageId === "visualization" && row.type === "self_labels",
    );
    if (!image?.storageLocator) {
      throw new ApiError(409, "IMAGE_REQUIRED", "找不到先前上傳的手繪圖。");
    }
    schemaName = "image_analysis";
    schema = imageAnalysisSchema;
    prompt = imageAnalysisPrompt({
      taskTitle: context.task.title,
      studentLabels: Array.isArray(labels?.data.labels)
        ? (labels.data.labels as string[])
        : [],
    });
    binary = await privateBlobBytes(image.storageLocator);
  } else if (stage === "ai_concept_map") {
    const selfMap = artifactRows.find(
      (row) => row.stageId === "self_concept_map" && row.type === "concept_map",
    );
    const vocabulary = artifactRows.find(
      (row) =>
        row.stageId === "image_analysis" &&
        row.type === "vocabulary_decisions",
    );
    schemaName = "concept_map";
    schema = conceptMapSchema;
    prompt = conceptExpansionPrompt({
      taskTitle: context.task.title,
      studentMap: selfMap?.data ?? {},
      acceptedVocabulary: vocabulary?.data.accepted ?? [],
    });
  } else {
    const conceptDecisions = artifactRows.find(
      (row) =>
        row.stageId === "ai_concept_map" && row.type === "concept_decisions",
    );
    const sentences = artifactRows.find(
      (row) => row.stageId === "sentence_scaffold" && row.type === "sentences",
    );
    schemaName = "sentence_scaffold";
    schema = sentenceScaffoldSchema;
    prompt = sentenceScaffoldPrompt({
      taskTitle: context.task.title,
      finalConceptMap: conceptDecisions?.data.accepted ?? {},
      studentSentences: Array.isArray(sentences?.data.sentences)
        ? (sentences.data.sentences as string[])
        : [],
    });
  }

  const run = (
    await db
      .insert(aiRuns)
      .values({
        sessionId,
        stageId: stage,
        provider: context.provider,
        modelId: context.task.modelId,
        promptVersion: context.task.promptVersion,
        promptHash: hashForLog(prompt),
        status: "running",
      })
      .returning()
  )[0];

  try {
    const result = await generateStructured({
      provider: context.provider,
      apiKey: context.apiKey,
      modelId: context.task.modelId,
      schemaName,
      schema,
      system: BASE_SYSTEM_PROMPT,
      prompt,
      binary,
    });

    await replaceArtifactData({
      sessionId,
      stageId: stage,
      type: stage,
      data: result.value as Record<string, unknown>,
    });
    await saveMessage({
      sessionId,
      stageId: stage,
      role: "assistant",
      kind: stage,
      content: result.value as Record<string, unknown>,
    });
    await db
      .update(aiRuns)
      .set({
        status: "completed",
        providerResponseId: result.providerResponseId,
        latencyMs: Date.now() - now,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, run.id));
    return result.value;
  } catch (error) {
    await db
      .update(aiRuns)
      .set({
        status: "failed",
        latencyMs: Date.now() - now,
        errorCode: "PROVIDER_ERROR",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown",
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, run.id));
    throw new ApiError(
      502,
      "AI_PROVIDER_FAILED",
      "AI 分析暫時失敗，請稍後重試。",
    );
  }
}
