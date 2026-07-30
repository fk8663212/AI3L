import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  accessCodes,
  auditLogs,
  providerCredentials,
  providerModels,
  stageAttempts,
  studentSessions,
  tasks,
} from "@/lib/db/schema";
import {
  DEFAULT_TASK,
  DEFAULT_TASK_CONFIG,
  normalizeTaskConfig,
  type TaskConfig,
} from "@/lib/domain/default-task";
import type { AIProviderName } from "@/lib/ai/provider";
import { testProviderConnection } from "@/lib/ai/provider";
import { promptAuditCatalog } from "@/lib/ai/prompt-audit";
import {
  decryptSecret,
  encryptSecret,
  hashAccessCode,
} from "@/lib/security/crypto";
import { ApiError } from "@/lib/security/request";
import { googleDriveStatus } from "@/lib/storage/google-drive";

export const PRESET_MODELS = [
  {
    provider: "google",
    modelId: "gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    capabilities: {
      text: true,
      image: true,
      audio: true,
      structuredOutput: true,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    capabilities: {
      text: true,
      image: true,
      audio: false,
      structuredOutput: true,
    },
  },
] as const;

export async function bootstrapDefaults(): Promise<void> {
  const db = getDb();
  for (const model of PRESET_MODELS) {
    await db
      .insert(providerModels)
      .values({ ...model, isPreset: true })
      .onConflictDoNothing();
  }

  const defaultTask = await db.query.tasks.findFirst({
    where: and(eq(tasks.slug, DEFAULT_TASK.slug), eq(tasks.version, 1)),
  });
  if (!defaultTask) {
    await db.insert(tasks).values({
      ...DEFAULT_TASK,
      familyId: crypto.randomUUID(),
      version: 1,
      status: "draft",
    });
  }

  const taskRows = await db.query.tasks.findMany();
  for (const task of taskRows) {
    if (!task.config.promptConfig) {
      await db
        .update(tasks)
        .set({ config: normalizeTaskConfig(task.config) })
        .where(eq(tasks.id, task.id));
    }
  }
}

export async function adminOverview() {
  const db = getDb();
  const [
    credentialRows,
    modelRows,
    taskRows,
    sessionRows,
    driveStatus,
  ] = await Promise.all([
    db.query.providerCredentials.findMany({
      orderBy: [asc(providerCredentials.provider)],
    }),
    db.query.providerModels.findMany({
      orderBy: [asc(providerModels.provider), asc(providerModels.displayName)],
    }),
    db.query.tasks.findMany({
      orderBy: [desc(tasks.createdAt)],
    }),
    db
      .select({
        id: studentSessions.id,
        taskId: studentSessions.taskId,
        currentStage: studentSessions.currentStage,
        stageStatus: studentSessions.stageStatus,
        startedAt: studentSessions.startedAt,
        completedAt: studentSessions.completedAt,
      })
      .from(studentSessions)
      .orderBy(desc(studentSessions.startedAt))
      .limit(100),
    googleDriveStatus(),
  ]);

  return {
    providers: credentialRows.map((row) => ({
      id: row.id,
      provider: row.provider,
      displayName: row.displayName,
      keyLastFour: row.keyLastFour,
      enabled: row.enabled,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      lastError: row.lastError,
    })),
    models: modelRows,
    tasks: taskRows.map((row) => {
      const config = normalizeTaskConfig(row.config);
      return {
        ...row,
        config,
        promptAudit: promptAuditCatalog(config.promptConfig),
      };
    }),
    sessions: sessionRows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    drive: driveStatus,
    taskDefaults: normalizeTaskConfig(DEFAULT_TASK_CONFIG),
  };
}

export async function saveProviderCredential(input: {
  provider: AIProviderName;
  displayName: string;
  apiKey: string;
  modelId: string;
}) {
  const db = getDb();
  let verifiedAt: Date | null = null;
  let lastError: string | null = null;
  try {
    await testProviderConnection({
      provider: input.provider,
      apiKey: input.apiKey,
      modelId: input.modelId,
    });
    verifiedAt = new Date();
  } catch (error) {
    lastError =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Connection test failed";
  }

  const encrypted = encryptSecret(input.apiKey);
  await db
    .insert(providerCredentials)
    .values({
      provider: input.provider,
      displayName: input.displayName,
      encryptedKey: encrypted.encryptedValue,
      encryptionIv: encrypted.encryptionIv,
      encryptionTag: encrypted.encryptionTag,
      keyLastFour: input.apiKey.slice(-4),
      enabled: true,
      verifiedAt,
      lastError,
    })
    .onConflictDoUpdate({
      target: providerCredentials.provider,
      set: {
        displayName: input.displayName,
        encryptedKey: encrypted.encryptedValue,
        encryptionIv: encrypted.encryptionIv,
        encryptionTag: encrypted.encryptionTag,
        keyLastFour: input.apiKey.slice(-4),
        enabled: true,
        verifiedAt,
        lastError,
        updatedAt: new Date(),
      },
    });
  await audit("provider.credential_saved", "provider", input.provider, {
    verified: Boolean(verifiedAt),
    modelId: input.modelId,
  });

  return { verified: Boolean(verifiedAt), error: lastError };
}

export async function testStoredProvider(provider: AIProviderName, modelId: string) {
  const db = getDb();
  const row = await db.query.providerCredentials.findFirst({
    where: eq(providerCredentials.provider, provider),
  });
  if (!row) throw new ApiError(404, "PROVIDER_NOT_FOUND", "尚未設定此供應商。");

  const apiKey = decryptSecret({
    encryptedValue: row.encryptedKey,
    encryptionIv: row.encryptionIv,
    encryptionTag: row.encryptionTag,
  });
  try {
    await testProviderConnection({ provider, apiKey, modelId });
    await db
      .update(providerCredentials)
      .set({ verifiedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(providerCredentials.id, row.id));
    return { verified: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Connection failed";
    await db
      .update(providerCredentials)
      .set({ verifiedAt: null, lastError: message, updatedAt: new Date() })
      .where(eq(providerCredentials.id, row.id));
    throw new ApiError(502, "PROVIDER_TEST_FAILED", message);
  }
}

export async function addCustomModel(input: {
  provider: AIProviderName;
  modelId: string;
  displayName: string;
  image: boolean;
  audio: boolean;
}) {
  const db = getDb();
  await db
    .insert(providerModels)
    .values({
      provider: input.provider,
      modelId: input.modelId,
      displayName: input.displayName,
      capabilities: {
        text: true,
        image: input.image,
        audio: input.audio,
        structuredOutput: true,
      },
      isPreset: false,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [providerModels.provider, providerModels.modelId],
      set: {
        displayName: input.displayName,
        capabilities: {
          text: true,
          image: input.image,
          audio: input.audio,
          structuredOutput: true,
        },
        enabled: true,
        updatedAt: new Date(),
      },
    });
}

export async function saveTaskDraft(input: {
  id?: string;
  title: string;
  slug: string;
  description: string;
  provider: AIProviderName;
  modelId: string;
  promptVersion: string;
  retentionDays: number;
  stageConfig: TaskConfig["stageConfig"];
  promptConfig: TaskConfig["promptConfig"];
}) {
  const db = getDb();
  const config = normalizeTaskConfig({
    ...DEFAULT_TASK_CONFIG,
    retentionDays: input.retentionDays,
    stageConfig: input.stageConfig,
    promptConfig: input.promptConfig,
  });

  if (input.id) {
    const current = await db.query.tasks.findFirst({
      where: eq(tasks.id, input.id),
    });
    if (!current) throw new ApiError(404, "TASK_NOT_FOUND", "找不到任務。");
    if (current.status !== "draft") {
      throw new ApiError(409, "TASK_IMMUTABLE", "已發布任務不可直接修改。");
    }
    const duplicate = await db.query.tasks.findFirst({
      where: and(
        eq(tasks.slug, input.slug),
        eq(tasks.version, current.version),
      ),
    });
    if (duplicate && duplicate.id !== current.id) {
      throw new ApiError(
        409,
        "TASK_SLUG_EXISTS",
        "此識別名稱與版本已存在，請改用不同的識別名稱。",
      );
    }
    await db
      .update(tasks)
      .set({
        title: input.title,
        slug: input.slug,
        description: input.description,
        provider: input.provider,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        config,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, input.id));
    return input.id;
  }

  const duplicate = await db.query.tasks.findFirst({
    where: and(eq(tasks.slug, input.slug), eq(tasks.version, 1)),
  });
  if (duplicate) {
    throw new ApiError(
      409,
      "TASK_SLUG_EXISTS",
      "此識別名稱已存在；若要修改，請編輯既有草稿或使用新的識別名稱。",
    );
  }

  const inserted = await db
    .insert(tasks)
    .values({
      familyId: crypto.randomUUID(),
      version: 1,
      title: input.title,
      slug: input.slug,
      description: input.description,
      provider: input.provider,
      modelId: input.modelId,
      promptVersion: input.promptVersion,
      config,
      status: "draft",
    })
    .returning({ id: tasks.id });
  return inserted[0].id;
}

export async function publishTask(taskId: string): Promise<void> {
  const db = getDb();
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "找不到任務。");
  const credential = await db.query.providerCredentials.findFirst({
    where: and(
      eq(providerCredentials.provider, task.provider),
      eq(providerCredentials.enabled, true),
    ),
  });
  if (!credential?.verifiedAt) {
    throw new ApiError(
      409,
      "PROVIDER_NOT_VERIFIED",
      "發布前必須完成對應 AI 供應商的連線測試。",
    );
  }
  const model = await db.query.providerModels.findFirst({
    where: and(
      eq(providerModels.provider, task.provider),
      eq(providerModels.modelId, task.modelId),
      eq(providerModels.enabled, true),
    ),
  });
  if (!model?.capabilities.image || !model.capabilities.structuredOutput) {
    throw new ApiError(
      409,
      "MODEL_CAPABILITY_MISMATCH",
      "此研究流程需要支援圖片與結構化輸出的模型。",
    );
  }
  if (!(await googleDriveStatus()).connected) {
    throw new ApiError(
      409,
      "DRIVE_NOT_CONNECTED",
      "發布前必須連接 Google Drive，確保學生錄音可被保存。",
    );
  }
  await db
    .update(tasks)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(tasks.id, taskId));
  await audit("task.published", "task", taskId, {
    provider: task.provider,
    modelId: task.modelId,
  });
}

function newAccessCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `AI3L-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export async function generateAccessCodes(
  taskId: string,
  count: number,
): Promise<Array<{ code: string; label: string }>> {
  const db = getDb();
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task || task.status !== "published") {
    throw new ApiError(409, "TASK_NOT_PUBLISHED", "只能為已發布任務建立代碼。");
  }

  const output: Array<{ code: string; label: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const code = newAccessCode();
    const label = `Student ${String(index + 1).padStart(3, "0")}`;
    await db.insert(accessCodes).values({
      taskId,
      codeHash: hashAccessCode(code),
      label,
    });
    output.push({ code, label });
  }
  await audit("access_codes.generated", "task", taskId, { count });
  return output;
}

export async function overrideSessionStage(input: {
  sessionId: string;
  stageId: typeof studentSessions.$inferSelect.currentStage;
  reason: string;
}) {
  const db = getDb();
  const session = await db.query.studentSessions.findFirst({
    where: eq(studentSessions.id, input.sessionId),
  });
  if (!session) throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");

  await db
    .update(stageAttempts)
    .set({ supersededAt: new Date(), status: "completed" })
    .where(
      and(
        eq(stageAttempts.sessionId, input.sessionId),
        eq(stageAttempts.status, "active"),
      ),
    );
  const attemptRows = await db
    .select({ value: sql<number>`coalesce(max(${stageAttempts.attempt}), 0)` })
    .from(stageAttempts)
    .where(
      and(
        eq(stageAttempts.sessionId, input.sessionId),
        eq(stageAttempts.stageId, input.stageId),
      ),
    );
  const attempt = Number(attemptRows[0]?.value ?? 0) + 1;
  await db.insert(stageAttempts).values({
    sessionId: input.sessionId,
    stageId: input.stageId,
    attempt,
    status: "active",
    overrideReason: input.reason,
  });
  await db
    .update(studentSessions)
    .set({
      currentStage: input.stageId,
      stageStatus: "active",
      stateVersion: session.stateVersion + 1,
      completedAt: null,
      lastSeenAt: new Date(),
    })
    .where(eq(studentSessions.id, input.sessionId));
  await audit("session.stage_overridden", "session", input.sessionId, {
    from: session.currentStage,
    to: input.stageId,
    reason: input.reason,
  });
}

export async function exportResearchData(taskId?: string) {
  const db = getDb();
  const taskRows = taskId
    ? await db.query.tasks.findMany({ where: eq(tasks.id, taskId) })
    : await db.query.tasks.findMany();
  const sessionRows = taskId
    ? await db.query.studentSessions.findMany({
        where: eq(studentSessions.taskId, taskId),
      })
    : await db.query.studentSessions.findMany();
  const ids = new Set(sessionRows.map((row) => row.id));
  const taskIds = new Set(taskRows.map((row) => row.id));
  const [
    codeRows,
    attemptRows,
    messageRows,
    artifactRows,
    aiRunRows,
    auditRows,
  ] = await Promise.all([
    db
      .select({
        id: accessCodes.id,
        taskId: accessCodes.taskId,
        label: accessCodes.label,
        expiresAt: accessCodes.expiresAt,
        disabledAt: accessCodes.disabledAt,
        createdAt: accessCodes.createdAt,
      })
      .from(accessCodes),
    db.query.stageAttempts.findMany(),
    db.query.messages.findMany(),
    db.query.artifacts.findMany(),
    db.query.aiRuns.findMany(),
    db.query.auditLogs.findMany(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    taskId: taskId ?? null,
    tasks: taskRows.map((row) => {
      const config = normalizeTaskConfig(row.config);
      return {
        ...row,
        config,
        promptAudit: promptAuditCatalog(config.promptConfig),
      };
    }),
    accessCodes: codeRows.filter((row) => taskIds.has(row.taskId)),
    sessions: sessionRows,
    stageAttempts: attemptRows.filter((row) => ids.has(row.sessionId)),
    messages: messageRows.filter((row) => ids.has(row.sessionId)),
    artifacts: artifactRows
      .filter((row) => ids.has(row.sessionId))
      .map((row) => ({
        ...row,
        storageLocator:
          row.storageProvider === "google-drive"
            ? row.storageLocator
            : row.storageLocator
              ? "[private-blob]"
              : null,
      })),
    aiRuns: aiRunRows.filter((row) => ids.has(row.sessionId)),
    auditLogs: auditRows.filter(
      (row) =>
        !taskId ||
        (row.targetId &&
          (taskIds.has(row.targetId) || ids.has(row.targetId))),
    ),
  };
}

async function audit(
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown>,
) {
  const db = getDb();
  await db.insert(auditLogs).values({
    actor: "admin",
    action,
    targetType,
    targetId,
    detail,
  });
}
