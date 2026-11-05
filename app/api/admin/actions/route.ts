import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addCustomModel,
  archiveTask,
  restoreTask,
  createTaskRevision,
  deleteUnusedTask,
  overrideSessionStage,
  publishTask,
  saveProviderCredential,
  saveTaskDraft,
  testStoredGoogleDrive,
  testStoredProvider,
} from "@/lib/services/admin-service";
import {
  apiErrorResponse,
  ApiError,
  assertSameOrigin,
} from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";
import { STAGE_IDS } from "@/lib/domain/stages";
import { MAX_CODE_BATCH } from "@/lib/domain/access-codes";
import {
  deleteUnusedAccessCodes,
  disableAllTaskCodes,
  generateAccessCodes,
  updateAccessCodes,
} from "@/lib/services/access-code-service";
import { MIN_STAGE_OVERRIDE_REASON_LENGTH } from "@/lib/domain/stage-override";

const providerSchema = z.enum(["openai", "google"]);
const stageInstructionSchema = z.object({
  instruction: z.string().min(5).max(2_000),
  minimumRecordingSeconds: z.number().int().min(1).max(600).optional(),
  maximumRecordingSeconds: z.number().int().min(1).max(600).optional(),
});
const stageConfigSchema = z.object({
  pretest: stageInstructionSchema,
  visualization: stageInstructionSchema,
  self_concept_map: stageInstructionSchema,
  image_analysis: stageInstructionSchema,
  ai_concept_map: stageInstructionSchema,
  sentence_scaffold: stageInstructionSchema,
  posttest: stageInstructionSchema,
});
const promptTextSchema = z.string().min(10).max(20_000);
const promptConfigSchema = z.object({
  baseSystemPrompt: promptTextSchema,
  imageAnalysisTemplate: promptTextSchema,
  conceptExpansionTemplate: promptTextSchema,
  sentenceScaffoldTemplate: promptTextSchema,
  googleTranscriptionSystemPrompt: promptTextSchema,
  openaiTranscriptionPrompt: promptTextSchema,
  transcriptionTemplate: promptTextSchema,
  speechEvaluationSystemPrompt: promptTextSchema,
  speechEvaluationTemplate: promptTextSchema,
});
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save_provider"),
    provider: providerSchema,
    displayName: z.string().min(1).max(80),
    apiKey: z.string().min(8).max(512),
    modelId: z.string().min(1).max(120),
  }),
  z.object({
    action: z.literal("test_provider"),
    provider: providerSchema,
    modelId: z.string().min(1).max(120),
  }),
  z.object({
    action: z.literal("test_drive"),
  }),
  z.object({
    action: z.literal("add_model"),
    provider: providerSchema,
    modelId: z.string().min(1).max(120),
    displayName: z.string().min(1).max(120),
    image: z.boolean(),
    audio: z.boolean(),
  }),
  z.object({
    action: z.literal("save_task"),
    id: z.string().uuid().optional(),
    title: z.string().min(2).max(180),
    slug: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().min(10).max(2_000),
    provider: providerSchema,
    modelId: z.string().min(1).max(120),
    promptVersion: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    retentionDays: z.number().int().min(1).max(3_650),
    stageConfig: stageConfigSchema,
    promptConfig: promptConfigSchema,
  }),
  z.object({
    action: z.literal("publish_task"),
    taskId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("create_task_revision"),
    taskId: z.string().uuid(),
    promptVersion: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  }),
  z.object({
    action: z.literal("archive_task"),
    taskId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("restore_task"),
    taskId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("delete_task"),
    taskId: z.string().uuid(),
    confirmation: z.string().min(4).max(180),
  }),
  z.object({
    action: z.literal("generate_codes"),
    taskId: z.string().uuid(),
    count: z.number().int().min(1).max(MAX_CODE_BATCH),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  }),
  z.object({
    action: z.literal("update_codes"),
    taskId: z.string().uuid(),
    codeIds: z.array(z.string().uuid()).min(1).max(MAX_CODE_BATCH),
    operation: z.enum(["disable", "enable", "set_expiry"]),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  }),
  z.object({
    action: z.literal("disable_task_codes"),
    taskId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("delete_codes"),
    taskId: z.string().uuid(),
    codeIds: z.array(z.string().uuid()).min(1).max(MAX_CODE_BATCH),
  }),
  z.object({
    action: z.literal("override_stage"),
    sessionId: z.string().uuid(),
    stageId: z.enum(STAGE_IDS),
    reason: z
      .string()
      .trim()
      .min(MIN_STAGE_OVERRIDE_REASON_LENGTH)
      .max(500),
  }),
]);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    const body = bodySchema.parse(await request.json());
    let data: unknown = null;

    switch (body.action) {
      case "save_provider":
        data = await saveProviderCredential(body);
        break;
      case "test_provider":
        data = await testStoredProvider(body.provider, body.modelId);
        break;
      case "test_drive":
        data = await testStoredGoogleDrive();
        break;
      case "add_model":
        await addCustomModel(body);
        break;
      case "save_task":
        data = { id: await saveTaskDraft(body) };
        break;
      case "publish_task":
        await publishTask(body.taskId);
        break;
      case "create_task_revision":
        data = await createTaskRevision(body);
        break;
      case "archive_task":
        await archiveTask(body.taskId);
        break;
      case "restore_task":
        await restoreTask(body.taskId);
        break;
      case "delete_task":
        data = await deleteUnusedTask(body);
        break;
      case "generate_codes":
        data = {
          codes: await generateAccessCodes(
            body.taskId,
            body.count,
            body.expiresAt ? new Date(body.expiresAt) : null,
          ),
        };
        break;
      case "update_codes":
        data = await updateAccessCodes({
          taskId: body.taskId,
          codeIds: body.codeIds,
          operation: body.operation,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        });
        break;
      case "disable_task_codes":
        data = await disableAllTaskCodes(body.taskId);
        break;
      case "delete_codes":
        data = await deleteUnusedAccessCodes(body);
        break;
      case "override_stage":
        data = await overrideSessionStage(body);
        break;
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
