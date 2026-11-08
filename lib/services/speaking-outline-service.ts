import { normalizeTaskConfig } from "@/lib/domain/default-task";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { aiRuns, artifacts, tasks } from "@/lib/db/schema";
import { sameSpeakingTemplate, type SpeakingTemplate } from "@/lib/domain/speaking-templates";
import { conceptMapSchema } from "@/lib/ai/schemas";
import { generateStructured } from "@/lib/ai/provider";
import { taskAIContext } from "@/lib/ai/provider-service";
import { speakingOutlinePrompt } from "@/lib/ai/speaking-outline-prompt";
import {
  conceptMapSignature,
  outlineSchemaForMap,
  outlineGenerationSchema,
  validSpeakingOutline,
  type SpeakingSection,
} from "@/lib/domain/speaking-outline";
import { hashForLog } from "@/lib/security/crypto";
import { ApiError } from "@/lib/security/request";
import {
  getSessionView,
  replaceArtifactData,
  replaceArtifactsAtomically,
  saveMessage,
  type DbTransaction,
} from "@/lib/services/session-service";

async function outlineContext(sessionId: string) {
  const view = await getSessionView(sessionId);
  if (
    !["ai_concept_map", "sentence_scaffold"].includes(view.session.currentStage)
  )
    throw new ApiError(
      409,
      "STAGE_LOCKED",
      "只能在概念圖或口說練習階段安排段落。",
    );
  if (!view.session.consented)
    throw new ApiError(409, "CONSENT_REQUIRED", "請先完成研究同意程序。");
  const decisions = view.artifacts.find(
    (item) => item.type === "concept_decisions",
  );
  const map = conceptMapSchema.safeParse(decisions?.data.accepted);
  if (
    !map.success ||
    !map.data.nodes.length ||
    !Array.isArray(decisions?.data.pending) ||
    decisions.data.pending.length
  )
    throw new ApiError(409, "REVIEW_REQUIRED", "請先確認保留的概念與關係。");
  const previous = view.artifacts.find(
    (item) => item.type === "speaking_outline",
  );
  return { view, map: map.data, previous };
}

async function assertSource(
  tx: DbTransaction,
  sessionId: string,
  signature: string,
  previousId?: string,
  taskId?: string,
  template?: SpeakingTemplate,
) {
  const rows = await tx.query.artifacts.findMany({
    where: and(
      eq(artifacts.sessionId, sessionId),
      isNull(artifacts.supersededAt),
    ),
  });
  const map = conceptMapSchema.safeParse(
    rows.find((row) => row.type === "concept_decisions")?.data.accepted,
  );
  const outline = rows.find((row) => row.type === "speaking_outline");
  const task = taskId ? await tx.query.tasks.findFirst({ where: eq(tasks.id, taskId) }) : undefined;
  if (
    !map.success ||
    conceptMapSignature(map.data) !== signature ||
    outline?.id !== previousId
    || (taskId && !sameSpeakingTemplate(task?.config.speakingTemplate, template))
  )
    throw new ApiError(
      409,
      "OUTLINE_CHANGED",
      "概念圖或段落已變更，請重新整理後再試。",
    );
}

export async function generateSpeakingOutline(sessionId: string) {
  const { map, previous, view } = await outlineContext(sessionId);
  const context = await taskAIContext(sessionId);
  const template = context.task.config.speakingTemplate;
  const signature = conceptMapSignature(map);
  const prompt = speakingOutlinePrompt(
    context.task.title,
    JSON.parse(signature),
    template,
  );
  const started = Date.now();
  const [run] = await getDb()
    .insert(aiRuns)
    .values({
      sessionId,
      stageId: view.session.currentStage,
      provider: context.provider,
      modelId: context.task.modelId,
      promptVersion: context.task.promptVersion,
      promptHash: hashForLog(prompt),
      status: "running",
    })
    .returning();
  try {
    const output = await generateStructured({
      provider: context.provider,
      apiKey: context.apiKey,
      modelId: context.task.modelId,
      schemaName: "speaking_outline",
      schema: outlineGenerationSchema(map, template),
      system: normalizeTaskConfig(context.task.config).promptConfig
        .baseSystemPrompt,
      prompt,
    });
    const plan = outlineGenerationSchema(map, template).parse(output.value);
    await replaceArtifactsAtomically(
      [
        {
          sessionId,
          stageId: "ai_concept_map",
          type: "speaking_outline",
          data: {
            ...plan,
            generatedSections: plan.sections,
            sourceMapSignature: signature,
            schemaVersion: template ? "macro-micro-v2" : "macro-micro-v1",
            ...(template ? { speakingTemplate: template } : {}),
          },
        },
      ],
      {
        allowWhenCurrentStages: ["ai_concept_map", "sentence_scaffold"],
        assertCurrent: (tx) =>
          assertSource(tx, sessionId, signature, previous?.id, context.task.id, template),
      },
    );
    await saveMessage({
      sessionId,
      stageId: view.session.currentStage,
      role: "assistant",
      kind: "speaking_outline",
      content: { ...plan, ...(template ? { speakingTemplate: template } : {}) },
    });
    await getDb()
      .update(aiRuns)
      .set({
        status: "completed",
        providerResponseId: output.providerResponseId,
        inputTokens: output.usage?.inputTokens,
        outputTokens: output.usage?.outputTokens,
        latencyMs: Date.now() - started,
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, run.id));
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Unknown error")
      .replaceAll(context.apiKey, "[redacted]")
      .replace(/([?&](?:key|api_key)=)[^&\s]+/giu, "$1[redacted]")
      .slice(0, 500);
    await getDb()
      .update(aiRuns)
      .set({
        status: error instanceof ApiError ? "discarded" : "failed",
        errorCode: error instanceof ApiError ? error.code : "PROVIDER_ERROR",
        errorMessage: message,
        latencyMs: Date.now() - started,
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, run.id));
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "AI_PROVIDER_FAILED",
      "暫時無法安排講述段落，已保存的概念圖仍保留，請稍後重試。",
    );
  }
}

export async function saveSpeakingOutline(
  sessionId: string,
  sections: SpeakingSection[],
) {
  const { map, previous, view } = await outlineContext(sessionId);
  const template = view.task.config.speakingTemplate;
  if (!validSpeakingOutline(previous?.data, map, template ?? null))
    throw new ApiError(
      409,
      "OUTLINE_REQUIRED",
      "請先依目前的概念圖建立講述架構。",
    );
  const plan = outlineSchemaForMap(map).parse({ sections });
  const signature = conceptMapSignature(map);
  await replaceArtifactsAtomically(
    [
      {
        sessionId,
        stageId: "ai_concept_map",
        type: "speaking_outline",
        data: {
          ...previous!.data,
          sections: plan.sections,
          editedAt: new Date().toISOString(),
        },
      },
    ],
    {
      allowWhenCurrentStages: ["ai_concept_map", "sentence_scaffold"],
      assertCurrent: (tx) =>
        assertSource(tx, sessionId, signature, previous!.id, view.task.id, template),
    },
  );
  await saveMessage({
    sessionId,
    stageId: view.session.currentStage,
    role: "student",
    kind: "speaking_outline_edit",
    content: { sections: plan.sections, ...(template ? { speakingTemplate: template } : {}) },
  });
}

export async function recordSpeakingNavigation(
  sessionId: string,
  sectionId: string,
  mode: "single" | "macro_micro",
  idempotencyKey: string,
  hintsVisible = false,
) {
  const { map, previous, view } = await outlineContext(sessionId);
  const template = view.task.config.speakingTemplate;
  const plan = validSpeakingOutline(previous?.data, map, template ?? null);
  if (!plan?.sections.some((section) => section.id === sectionId))
    throw new ApiError(400, "INVALID_SECTION", "找不到這個講述段落。");
  const scaffold = view.artifacts.find(
    (item) => item.type === "sentence_scaffold",
  );
  const data = {
    sectionId,
    sectionTitle: plan.sections.find((section) => section.id === sectionId)!
      .titleZh,
    mode,
    outlineId: previous!.id,
    ...(template ? { speakingTemplate: template } : {}),
    hintsVisible:
      hintsVisible &&
      mode === "macro_micro" &&
      view.session.currentStage === "sentence_scaffold" &&
      scaffold?.data.speakingOutlineId === previous!.id,
  };
  await replaceArtifactData({
    sessionId,
    stageId: view.session.currentStage,
    type: "speaking_progress",
    data,
  });
  await saveMessage({
    sessionId,
    stageId: view.session.currentStage,
    role: "student",
    kind: "speaking_navigation",
    content: data,
    idempotencyKey,
  });
}
