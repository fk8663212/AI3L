import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  auditLogs,
  providerCredentials,
  providerModels,
  tasks,
} from "@/lib/db/schema";
import { testProviderConnection, type AIProviderName } from "@/lib/ai/provider";
import { decryptSecret } from "@/lib/security/crypto";
import { ApiError } from "@/lib/security/request";

type ModelKey = { provider: AIProviderName; modelId: string };

async function audit(action: string, model: ModelKey, detail: Record<string, unknown> = {}) {
  await getDb().insert(auditLogs).values({
    actor: "admin",
    action,
    targetType: "model",
    targetId: `${model.provider}:${model.modelId}`,
    detail,
  });
}

async function findModel(model: ModelKey) {
  const row = await getDb().query.providerModels.findFirst({
    where: and(
      eq(providerModels.provider, model.provider),
      eq(providerModels.modelId, model.modelId),
    ),
  });
  if (!row) throw new ApiError(404, "MODEL_NOT_FOUND", "找不到這個模型。");
  return row;
}

async function tasksUsing(model: ModelKey, statuses?: string[]) {
  return getDb()
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(
      and(
        eq(tasks.provider, model.provider),
        eq(tasks.modelId, model.modelId),
        statuses ? inArray(tasks.status, statuses) : undefined,
      ),
    );
}

/**
 * Enables or disables a model for new tasks. A model a published task runs
 * on cannot be disabled: that task keeps calling it, and the admin would see
 * a "disabled" model still in use. Archive or revise the task first.
 */
export async function setModelEnabled(input: ModelKey & { enabled: boolean }) {
  await findModel(input);
  if (!input.enabled) {
    const live = await tasksUsing(input, ["published"]);
    if (live.length) {
      throw new ApiError(
        409,
        "MODEL_IN_USE",
        `仍有 ${live.length} 個已發布任務使用此模型（${live.map((task) => task.title).join("、")}），請先封存或建立新版本後再停用。`,
      );
    }
  }
  await getDb()
    .update(providerModels)
    .set({ enabled: input.enabled, updatedAt: new Date() })
    .where(
      and(
        eq(providerModels.provider, input.provider),
        eq(providerModels.modelId, input.modelId),
      ),
    );
  await audit(input.enabled ? "model.enabled" : "model.disabled", input);
}

/** Deletes a custom model that no task (in any state) refers to. */
export async function deleteModel(input: ModelKey) {
  const row = await findModel(input);
  if (row.isPreset) {
    throw new ApiError(409, "MODEL_IS_PRESET", "內建模型不能刪除，可以改為停用。");
  }
  const used = await tasksUsing(input);
  if (used.length) {
    throw new ApiError(
      409,
      "MODEL_IN_USE",
      `有 ${used.length} 個任務（含草稿或封存）使用此模型，不能刪除；可以改為停用。`,
    );
  }
  await getDb().delete(providerModels).where(eq(providerModels.id, row.id));
  await audit("model.deleted", input);
}

/**
 * Checks that the stored API key can call this model. Unlike re-testing the
 * key itself, a failure here leaves the key's verified status alone, so a
 * mistyped model ID cannot switch AI off for every running task.
 */
export async function testModel(input: ModelKey) {
  const credential = await getDb().query.providerCredentials.findFirst({
    where: eq(providerCredentials.provider, input.provider),
  });
  if (!credential) {
    throw new ApiError(409, "PROVIDER_NOT_CONFIGURED", "請先在上方保存這個供應商的 API Key。");
  }
  const apiKey = decryptSecret({
    encryptedValue: credential.encryptedKey,
    encryptionIv: credential.encryptionIv,
    encryptionTag: credential.encryptionTag,
  });
  const startedAt = Date.now();
  try {
    await testProviderConnection({ provider: input.provider, apiKey, modelId: input.modelId });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "連線失敗";
    throw new ApiError(502, "MODEL_TEST_FAILED", `模型測試失敗：${message}`);
  }
  return { ok: true, latencyMs: Date.now() - startedAt };
}
