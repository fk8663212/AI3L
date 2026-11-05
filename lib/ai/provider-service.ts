import { createHash } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import sharp from "sharp";
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
  type ImageAnnotation,
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
import { normalizeTaskConfig } from "@/lib/domain/default-task";
import { decryptSecret, hashForLog } from "@/lib/security/crypto";
import { ApiError } from "@/lib/security/request";
import {
  replaceArtifactsAtomically,
  saveMessage,
  type DbTransaction,
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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function annotationColor(category: ImageAnnotation["category"]): string {
  return (
    {
      person: "#b84a3a",
      object: "#2f6da3",
      event: "#7d4da3",
      place: "#2f7d65",
      feeling: "#bd6f21",
      quality: "#82621b",
    } as const
  )[category];
}

async function renderAnnotatedDrawing(
  source: BinaryInput,
  annotations: ImageAnnotation[],
): Promise<Uint8Array> {
  const input = Buffer.from(source.bytes);
  const metadata = await sharp(input).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error("Drawing dimensions could not be determined.");
  }

  const lineWidth = Math.max(3, Math.round(width / 420));
  const fontSize = Math.max(18, Math.round(width / 48));
  const padding = Math.max(5, Math.round(fontSize * 0.28));
  const elements = annotations
    .map((item) => {
      const normalizedX = Math.min(999, Math.max(0, item.region.x));
      const normalizedY = Math.min(999, Math.max(0, item.region.y));
      const normalizedWidth = Math.min(
        1000 - normalizedX,
        Math.max(1, item.region.width),
      );
      const normalizedHeight = Math.min(
        1000 - normalizedY,
        Math.max(1, item.region.height),
      );
      const x = (normalizedX / 1000) * width;
      const y = (normalizedY / 1000) * height;
      const boxWidth = (normalizedWidth / 1000) * width;
      const boxHeight = (normalizedHeight / 1000) * height;
      const label = escapeXml(item.labelEn);
      const labelWidth = Math.min(
        width,
        Math.max(fontSize * 3, label.length * fontSize * 0.64 + padding * 2),
      );
      const labelX = Math.min(width - labelWidth, Math.max(0, x));
      const labelHeight = fontSize + padding * 2;
      const labelY = Math.max(0, y - labelHeight);
      const color = annotationColor(item.category);
      return `
        <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}"
          rx="${lineWidth * 1.5}" fill="none" stroke="#ffffff"
          stroke-width="${lineWidth * 2.5}" />
        <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}"
          rx="${lineWidth * 1.5}" fill="none" stroke="${color}"
          stroke-width="${lineWidth}" />
        <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}"
          rx="${padding}" fill="${color}" />
        <text x="${labelX + padding}" y="${labelY + padding + fontSize * 0.82}"
          fill="#ffffff" font-family="Arial, sans-serif" font-size="${fontSize}"
          font-weight="700">${label}</text>
      `;
    })
    .join("\n");
  const overlay = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
      xmlns="http://www.w3.org/2000/svg">
      ${elements}
    </svg>
  `;

  return new Uint8Array(
    await sharp(input)
      .composite([{ input: Buffer.from(overlay) }])
      .webp({ quality: 90 })
      .toBuffer(),
  );
}

export async function runStageAI(
  sessionId: string,
  stage: "image_analysis" | "ai_concept_map" | "sentence_scaffold",
  options?: {
    trigger?: "student_action" | "visualization_upload";
    sourceImageArtifactId?: string;
  },
) {
  const db = getDb();
  const context = await taskAIContext(sessionId);
  const promptConfig = normalizeTaskConfig(context.task.config).promptConfig;
  const isVisualizationUpload =
    stage === "image_analysis" &&
    options?.trigger === "visualization_upload";
  const allowedCurrentStage: "visualization" | undefined = isVisualizationUpload
    ? "visualization"
    : undefined;
  if (
    context.session.currentStage !== stage &&
    context.session.currentStage !== allowedCurrentStage
  ) {
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
    const studentSentences = Array.isArray(sentences?.data.sentences)
      ? (sentences.data.sentences as string[])
      : [];
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
        finalConceptMap: conceptDecisions?.data.accepted ?? {},
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
    });

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
    let annotatedBlobUrl: string | undefined;
    if (stage === "image_analysis" && sourceImageArtifactId) {
      const annotated = imageAnalysisGenerationSchema.parse(result.value);
      if (!binary) throw new Error("Drawing bytes are unavailable.");
      const annotatedBytes = await renderAnnotatedDrawing(
        binary,
        annotated.suggestions,
      );
      const stored = await put(
        `student/${sessionId}/image_analysis/annotated-drawing.webp`,
        Buffer.from(annotatedBytes),
        {
          access: "private",
          contentType: "image/webp",
          // A unique URL per run: invalidating an older analysis deletes its
          // blob by URL, which must never hit a newer run's annotated image.
          addRandomSuffix: true,
        },
      );
      annotatedBlobUrl = stored.url;
      writes.push(
        {
          sessionId,
          stageId: stage,
          type: "annotated_image",
          data: {
            sourceImageArtifactId,
            annotations: annotated.suggestions,
            pathname: stored.pathname,
          },
          storageProvider: "vercel-blob",
          storageLocator: stored.url,
          mimeType: "image/webp",
          sizeBytes: annotatedBytes.byteLength,
          sha256: createHash("sha256")
            .update(annotatedBytes)
            .digest("base64url"),
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

    try {
      await replaceArtifactsAtomically(writes, {
        allowWhenCurrentStage: allowedCurrentStage,
        assertCurrent: sourceImageArtifactId
          ? (tx) => assertSourceImageCurrent(tx, sessionId, sourceImageArtifactId!)
          : undefined,
      });
    } catch (error) {
      if (annotatedBlobUrl) {
        try {
          await del(annotatedBlobUrl);
        } catch {
          // Unreferenced blob; harmless if cleanup fails.
        }
      }
      throw error;
    }
    if (!isVisualizationUpload) {
      await saveMessage({
        sessionId,
        stageId: stage,
        role: "assistant",
        kind: stage,
        content: result.value as Record<string, unknown>,
      });
    }
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
    row.storageProvider === "vercel-blob" && row.storageLocator
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

export async function precomputeImageAnalysisAfterUpload(input: {
  sessionId: string;
  sourceImageArtifactId: string;
}) {
  try {
    await invalidateImageAnalysisArtifacts(input.sessionId);
    await runStageAI(input.sessionId, "image_analysis", {
      trigger: "visualization_upload",
      sourceImageArtifactId: input.sourceImageArtifactId,
    });
    return true;
  } catch (error) {
    console.error("Image-analysis precompute failed; upload was preserved", {
      sessionId: input.sessionId,
      sourceImageArtifactId: input.sourceImageArtifactId,
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
