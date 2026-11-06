import { del, get } from "@/lib/storage/blob-store";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  aiRuns,
  artifacts,
  providerCredentials,
  studentSessions,
  tasks,
} from "@/lib/db/schema";
import {
  generatedConceptMapSchema,
  imageAnalysisGenerationSchema,
  sentenceScaffoldSchema,
} from "@/lib/ai/schemas";
import type { ZodType } from "zod";
import {
  generateStructured,
  type AIProviderName,
  type BinaryInput,
} from "@/lib/ai/provider";
import {
  conceptExpansionPrompt,
  imageAnalysisPrompt,
  sentenceScaffoldPrompt,
} from "@/lib/ai/prompts";
import {
  normalizeImageAnalysisOutput,
  normalizeSentenceScaffoldOutput,
} from "@/lib/ai/normalize";
import { normalizeTaskConfig } from "@/lib/domain/default-task";
import type { StageId } from "@/lib/domain/stages";
import { decryptSecret, hashForLog } from "@/lib/security/crypto";
import { ApiError } from "@/lib/security/request";
import {
  replaceArtifactsAtomically,
  saveMessage,
  type DbTransaction,
} from "@/lib/services/session-service";

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** The concept map without the student's drag positions, for prompts. */
function withoutLayout(map: unknown): unknown {
  if (!map || typeof map !== "object") return {};
  const source = map as { nodes?: unknown; edges?: unknown };
  return {
    nodes: Array.isArray(source.nodes)
      ? source.nodes.map((node) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { x, y, edited, ...rest } = node as Record<string, unknown>;
          return rest;
        })
      : [],
    edges: Array.isArray(source.edges)
      ? source.edges.map((edge) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { edited, ...rest } = edge as Record<string, unknown>;
          return rest;
        })
      : [],
  };
}

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
      isNotNull(providerCredentials.verifiedAt),
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

/**
 * Locks the drawing an analysis was built from and refuses the write if the
 * student has deleted or replaced it while the AI was running.
 */
async function assertSourceImageCurrent(
  tx: DbTransaction,
  sessionId: string,
  sourceImageArtifactId: string,
) {
  const rows = await tx
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.id, sourceImageArtifactId),
        eq(artifacts.sessionId, sessionId),
        isNull(artifacts.supersededAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!rows[0]) {
    throw new ApiError(
      409,
      "SOURCE_REPLACED",
      "手繪圖已更換，舊的分析結果已捨棄。",
    );
  }
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

/**
 * Stages in which a background image analysis may run and be saved: from the
 * moment the drawing stage is submitted until the student reviews the result.
 */
const BACKGROUND_ANALYSIS_STAGES: StageId[] = [
  "visualization",
  "self_concept_map",
  "image_analysis",
];

/** Refuses a background result once the student already has one. */
async function assertNoCurrentOutput(
  tx: DbTransaction,
  sessionId: string,
  stage: "image_analysis" | "ai_concept_map",
) {
  const rows = await tx
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.sessionId, sessionId),
        eq(artifacts.stageId, stage),
        eq(
          artifacts.type,
          stage === "image_analysis" ? "image_analysis" : "generated_concept_map",
        ),
        isNull(artifacts.supersededAt),
      ),
    )
    .limit(1);
  if (rows[0]) {
    throw new ApiError(409, "ANALYSIS_EXISTS", "已有 AI 分析結果。");
  }
}

export async function runStageAI(
  sessionId: string,
  stage: "image_analysis" | "ai_concept_map" | "sentence_scaffold",
  options?: {
    trigger?: "student_action" | "background";
    sourceImageArtifactId?: string;
  },
) {
  const db = getDb();
  const context = await taskAIContext(sessionId);
  const promptConfig = normalizeTaskConfig(context.task.config).promptConfig;
  const isBackground =
    stage !== "sentence_scaffold" && options?.trigger === "background";
  const allowedCurrentStages: StageId[] =
    isBackground && stage === "image_analysis"
      ? BACKGROUND_ANALYSIS_STAGES
      : [stage];
  if (!allowedCurrentStages.includes(context.session.currentStage)) {
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
  let sourceImageArtifactId: string | undefined;
  let scaffoldSentences: string[] = [];

  if (stage === "image_analysis") {
    const image = artifactRows.find(
      (row) =>
        row.stageId === "visualization" &&
        row.type === "image" &&
        (!options?.sourceImageArtifactId ||
          row.id === options.sourceImageArtifactId),
    );
    const labels = artifactRows.find(
      (row) => row.stageId === "visualization" && row.type === "self_labels",
    );
    if (!image?.storageLocator) {
      throw new ApiError(409, "IMAGE_REQUIRED", "找不到先前上傳的手繪圖。");
    }
    schemaName = "image_analysis";
    schema = imageAnalysisGenerationSchema;
    prompt = imageAnalysisPrompt(
      {
        taskTitle: context.task.title,
        studentLabels: Array.isArray(labels?.data.labels)
          ? (labels.data.labels as string[])
          : [],
      },
      promptConfig.imageAnalysisTemplate,
    );
    binary = await privateBlobBytes(image.storageLocator);
    sourceImageArtifactId = image.id;
  } else if (stage === "ai_concept_map") {
    const selfMapImage = artifactRows.find(
      (row) => row.stageId === "self_concept_map" && row.type === "image",
    );
    const vocabulary = artifactRows.find(
      (row) =>
        row.stageId === "image_analysis" &&
        row.type === "vocabulary_decisions",
    );
    if (!selfMapImage?.storageLocator) {
      throw new ApiError(
        409,
        "CONCEPT_MAP_IMAGE_REQUIRED",
        "找不到學生上傳的手繪概念圖。",
      );
    }
    schemaName = "concept_map";
    schema = generatedConceptMapSchema;
    prompt = conceptExpansionPrompt(
      {
        taskTitle: context.task.title,
        studentMap: {
          format: "hand-drawn-image",
          attached: true,
          artifactId: selfMapImage.id,
        },
        acceptedVocabulary: vocabulary?.data.accepted ?? [],
      },
      promptConfig.conceptExpansionTemplate,
    );
    binary = await privateBlobBytes(selfMapImage.storageLocator);
  } else {
    const conceptDecisions = artifactRows.find(
      (row) =>
        row.stageId === "ai_concept_map" && row.type === "concept_decisions",
    );
    const sentences = artifactRows.find(
      (row) => row.stageId === "sentence_scaffold" && row.type === "sentences",
    );
    // Hints are built for the sentences the student first wrote, not for
    // revisions made while reading earlier hints.
    const studentSentences = stringList(
      sentences?.data.originals ?? sentences?.data.sentences,
    );
    scaffoldSentences = studentSentences;
    // The protocol is "write your own sentences first, then get hints".
    if (studentSentences.length < 3) {
      throw new ApiError(
        409,
        "SENTENCES_REQUIRED",
        "請先保存至少三個自己的英文句子，再取得語言鷹架。",
      );
    }
    schemaName = "sentence_scaffold";
    schema = sentenceScaffoldSchema;
    prompt = sentenceScaffoldPrompt(
      {
        taskTitle: context.task.title,
        finalConceptMap: withoutLayout(conceptDecisions?.data.accepted),
        studentSentences,
      },
      promptConfig.sentenceScaffoldTemplate,
    );
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
      system: promptConfig.baseSystemPrompt,
      prompt,
      binary,
      normalize:
        stage === "image_analysis"
          ? normalizeImageAnalysisOutput
          : stage === "sentence_scaffold"
            ? normalizeSentenceScaffoldOutput(scaffoldSentences)
            : undefined,
    });

    if (stage === "sentence_scaffold") {
      // Whatever the provider: each ladder belongs to the student's real
      // sentence, never to text the model wrote into "original".
      result.value = sentenceScaffoldSchema.parse(
        normalizeSentenceScaffoldOutput(scaffoldSentences)(result.value),
      );
    }
    const outputType =
      stage === "ai_concept_map" ? "generated_concept_map" : stage;
    const writes: Parameters<typeof replaceArtifactsAtomically>[0] = [
      {
        sessionId,
        stageId: stage,
        type: outputType,
        data: result.value as Record<string, unknown>,
      },
    ];
    if (stage === "image_analysis" && sourceImageArtifactId) {
      const annotated = imageAnalysisGenerationSchema.parse(result.value);
      // The labels are drawn over the original drawing in the browser, so the
      // annotated version is data only: no server-side image rendering.
      writes.push(
        {
          sessionId,
          stageId: stage,
          type: "annotated_image",
          data: {
            sourceImageArtifactId,
            annotations: annotated.suggestions,
          },
        },
        {
          sessionId,
          stageId: "image_analysis",
          type: "vocabulary_decisions",
          data: {
            pending: annotated.suggestions.map((item) => item.id),
            accepted: [],
            rejected: [],
          },
        },
      );
    } else if (stage === "ai_concept_map") {
      // A regenerated map invalidates any review of the previous one.
      const generated = generatedConceptMapSchema.parse(result.value);
      writes.push({
        sessionId,
        stageId: stage,
        type: "concept_decisions",
        data: {
          pending: [...generated.nodes, ...generated.edges]
            .filter((item) => item.source === "ai")
            .map((item) => item.id),
          accepted: { nodes: [], edges: [] },
          rejectedIds: [],
        },
      });
    }

    await replaceArtifactsAtomically(writes, {
      allowWhenCurrentStages: allowedCurrentStages,
      assertCurrent: async (tx) => {
        if (sourceImageArtifactId) {
          await assertSourceImageCurrent(tx, sessionId, sourceImageArtifactId);
        }
        if (isBackground) {
          await assertNoCurrentOutput(tx, sessionId, stage);
        }
      },
    });
    // A background result is saved under its own stage, so the student only
    // sees the message once they reach that stage.
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
    if (error instanceof ApiError) {
      // Not a provider failure: the result was valid but no longer applies
      // (source drawing replaced, or the student left the stage).
      await db
        .update(aiRuns)
        .set({
          status: "discarded",
          latencyMs: Date.now() - now,
          errorCode: error.code,
          errorMessage: error.message,
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, run.id));
      throw error;
    }
    const rawErrorMessage =
      error instanceof Error ? error.message : "Unknown provider error";
    const safeErrorMessage = rawErrorMessage
      .replaceAll(context.apiKey, "[redacted]")
      .replace(/([?&](?:key|api_key)=)[^&\s]+/giu, "$1[redacted]")
      .slice(0, 500);
    const providerStatus =
      typeof error === "object" &&
      error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : undefined;
    console.error("AI stage generation failed", {
      stage,
      provider: context.provider,
      modelId: context.task.modelId,
      status: providerStatus,
      error: safeErrorMessage,
    });
    await db
      .update(aiRuns)
      .set({
        status: "failed",
        latencyMs: Date.now() - now,
        errorCode: "PROVIDER_ERROR",
        errorMessage: safeErrorMessage,
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, run.id));

    const normalizedError = safeErrorMessage.toLowerCase();
    const publicMessage =
      providerStatus === 429 ||
      normalizedError.includes("quota") ||
      normalizedError.includes("rate limit")
        ? "AI 使用額度不足或目前請求過多，請稍後再試。"
        : providerStatus === 401 ||
            providerStatus === 403 ||
            normalizedError.includes("api key")
          ? "AI API Key 驗證失敗，請通知管理員檢查供應商設定。"
          : normalizedError.includes("model") &&
              (providerStatus === 404 ||
                normalizedError.includes("not found"))
            ? "目前設定的 AI 模型無法使用，請通知管理員檢查模型設定。"
            : "AI 分析暫時失敗，請稍後重試。";
    throw new ApiError(
      502,
      "AI_PROVIDER_FAILED",
      publicMessage,
    );
  }
}

const IMAGE_ANALYSIS_ARTIFACT_TYPES = [
  "image_analysis",
  "annotated_image",
  "vocabulary_decisions",
] as const;

async function invalidateImageAnalysisArtifacts(sessionId: string) {
  const db = getDb();
  const activeRows = await db.query.artifacts.findMany({
    where: and(
      eq(artifacts.sessionId, sessionId),
      eq(artifacts.stageId, "image_analysis"),
      inArray(artifacts.type, IMAGE_ANALYSIS_ARTIFACT_TYPES),
      isNull(artifacts.supersededAt),
    ),
  });
  if (!activeRows.length) return;

  const invalidatedAt = new Date();
  await db
    .update(artifacts)
    .set({ supersededAt: invalidatedAt, updatedAt: invalidatedAt })
    .where(
      and(
        eq(artifacts.sessionId, sessionId),
        eq(artifacts.stageId, "image_analysis"),
        inArray(artifacts.type, IMAGE_ANALYSIS_ARTIFACT_TYPES),
        isNull(artifacts.supersededAt),
      ),
    );

  const storedUrls = activeRows.flatMap((row) =>
    (row.storageProvider === "vercel-blob" || row.storageProvider === "local") && row.storageLocator
      ? [row.storageLocator]
      : [],
  );
  if (storedUrls.length) {
    try {
      await del(storedUrls);
    } catch {
      // Superseded analysis remains hidden even if Blob cleanup must be retried.
    }
  }
}

/**
 * Analyses the drawing in the background once the drawing stage is submitted,
 * so stage 4 only has to show the result. Never throws: on failure stage 4
 * offers a retry.
 */
export async function precomputeImageAnalysis(input: {
  sessionId: string;
  sourceImageArtifactId?: string;
}) {
  try {
    await invalidateImageAnalysisArtifacts(input.sessionId);
    await runStageAI(input.sessionId, "image_analysis", {
      trigger: "background",
      sourceImageArtifactId: input.sourceImageArtifactId,
    });
    return true;
  } catch (error) {
    console.error("Background image analysis failed", {
      sessionId: input.sessionId,
      sourceImageArtifactId: input.sourceImageArtifactId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return false;
  }
}

/**
 * Builds the AI concept map in the background once the vocabulary review
 * (stage 4) is submitted: its inputs, the stage 3 drawing and the accepted
 * words, are final then. Never throws: on failure stage 5 offers a retry.
 */
export async function precomputeConceptMap(input: { sessionId: string }) {
  try {
    await runStageAI(input.sessionId, "ai_concept_map", {
      trigger: "background",
    });
    return true;
  } catch (error) {
    console.error("Background concept map failed", {
      sessionId: input.sessionId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return false;
  }
}

export async function invalidateImageAnalysisAfterSourceDeletion(
  sessionId: string,
) {
  await invalidateImageAnalysisArtifacts(sessionId);
}
