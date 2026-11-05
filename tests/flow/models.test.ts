import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { createTestDb } = await import("./test-db");
  const db = await createTestDb();
  return { getDb: () => db };
});

const provider = vi.hoisted(() => ({ testProviderConnection: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  ...provider,
}));

import { getDb } from "@/lib/db/client";
import { providerCredentials, providerModels, tasks } from "@/lib/db/schema";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import { encryptSecret } from "@/lib/security/crypto";
import { addCustomModel } from "@/lib/services/admin-service";
import { deleteModel, setModelEnabled, testModel } from "@/lib/services/model-service";

async function model(provider: "google" | "openai", modelId: string) {
  return getDb().query.providerModels.findFirst({
    where: and(eq(providerModels.provider, provider), eq(providerModels.modelId, modelId)),
  });
}

async function taskOn(modelId: string, status: string) {
  await getDb().insert(tasks).values({
    slug: `model-${randomUUID()}`,
    title: `Task on ${modelId}`,
    description: "A task used by the model-management tests.",
    status,
    provider: "google",
    modelId,
    config: DEFAULT_TASK_CONFIG,
  });
}

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = "model-test-encryption-key-0123456789";
});

describe("model management", () => {
  it("adds and edits a custom model", async () => {
    await addCustomModel({ provider: "google", modelId: "gemini-test-a", displayName: "A", image: true, audio: false });
    await addCustomModel({ provider: "google", modelId: "gemini-test-a", displayName: "A2", image: true, audio: true });
    const row = await model("google", "gemini-test-a");
    expect(row).toMatchObject({ displayName: "A2", enabled: true, isPreset: false });
    expect(row?.capabilities.audio).toBe(true);
  });

  it("will not disable a model a published task runs on, but allows it for drafts", async () => {
    await addCustomModel({ provider: "google", modelId: "gemini-live", displayName: "Live", image: true, audio: true });
    await taskOn("gemini-live", "published");
    await expect(
      setModelEnabled({ provider: "google", modelId: "gemini-live", enabled: false }),
    ).rejects.toMatchObject({ code: "MODEL_IN_USE" });

    await addCustomModel({ provider: "google", modelId: "gemini-draft", displayName: "Draft", image: true, audio: true });
    await taskOn("gemini-draft", "draft");
    await setModelEnabled({ provider: "google", modelId: "gemini-draft", enabled: false });
    expect((await model("google", "gemini-draft"))?.enabled).toBe(false);
    await setModelEnabled({ provider: "google", modelId: "gemini-draft", enabled: true });
    expect((await model("google", "gemini-draft"))?.enabled).toBe(true);
  });

  it("deletes only unused custom models", async () => {
    await addCustomModel({ provider: "openai", modelId: "gpt-unused", displayName: "Unused", image: true, audio: false });
    await deleteModel({ provider: "openai", modelId: "gpt-unused" });
    expect(await model("openai", "gpt-unused")).toBeUndefined();

    await addCustomModel({ provider: "google", modelId: "gemini-archived", displayName: "Old", image: true, audio: true });
    await taskOn("gemini-archived", "archived");
    await expect(deleteModel({ provider: "google", modelId: "gemini-archived" })).rejects.toMatchObject({
      code: "MODEL_IN_USE",
    });

    await getDb().insert(providerModels).values({
      provider: "google",
      modelId: "gemini-preset",
      displayName: "Preset",
      capabilities: { text: true, image: true, audio: true, structuredOutput: true },
      isPreset: true,
    });
    await expect(deleteModel({ provider: "google", modelId: "gemini-preset" })).rejects.toMatchObject({
      code: "MODEL_IS_PRESET",
    });
  });

  it("tests a model without changing the API key's verified status", async () => {
    await expect(testModel({ provider: "openai", modelId: "gpt-x" })).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });

    const verifiedAt = new Date("2026-11-01T00:00:00Z");
    const secret = encryptSecret("test-key");
    await getDb().insert(providerCredentials).values({
      provider: "openai",
      displayName: "OpenAI",
      encryptedKey: secret.encryptedValue,
      encryptionIv: secret.encryptionIv,
      encryptionTag: secret.encryptionTag,
      keyLastFour: "-key",
      verifiedAt,
    });

    await expect(testModel({ provider: "openai", modelId: "gpt-x" })).resolves.toMatchObject({ ok: true });
    expect(provider.testProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", apiKey: "test-key", modelId: "gpt-x" }),
    );

    provider.testProviderConnection.mockRejectedValueOnce(new Error("model not found"));
    await expect(testModel({ provider: "openai", modelId: "gpt-typo" })).rejects.toMatchObject({
      code: "MODEL_TEST_FAILED",
    });
    const credential = await getDb().query.providerCredentials.findFirst({
      where: eq(providerCredentials.provider, "openai"),
    });
    expect(credential?.verifiedAt?.toISOString()).toBe(verifiedAt.toISOString());
  });
});
