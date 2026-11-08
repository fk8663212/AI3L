import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/client", async () => {
  const { createTestDb } = await import("./test-db");
  const db = await createTestDb();
  return { getDb: () => db };
});
vi.mock("@/lib/security/session", async (original) => ({
  ...(await original<typeof import("@/lib/security/session")>()),
  getAdminClaims: async () => ({ role: "admin" }),
}));
import { POST } from "@/app/api/admin/actions/route";
import { getDb } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";

const input = {
  action: "save_task",
  title: "Task creation test",
  description: "Synthetic task identifier validation",
  provider: "google",
  modelId: "test-model",
  promptVersion: "1.0.0",
  retentionDays: 180,
  stageConfig: DEFAULT_TASK_CONFIG.stageConfig,
  promptConfig: DEFAULT_TASK_CONFIG.promptConfig,
};
async function save(values: Record<string, unknown>) {
  const response = await POST(
    new Request("http://localhost/api/admin/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, ...values }),
    }),
  );
  return { status: response.status, ...(await response.json()) };
}
const read = (id: string) =>
  getDb().query.tasks.findFirst({ where: eq(tasks.id, id) });

describe("task identifiers", () => {
  it("accepts friedrice exactly as entered", async () => {
    const result = await save({ slug: "friedrice" });
    expect(result.status).toBe(200);
    expect((await read(result.data.id))?.slug).toBe("friedrice");
  });
  it.each([undefined, "", "   "])(
    "automatically generates a new identifier when omitted or blank: %s",
    async (slug) => {
      const a = await save({ slug });
      const b = await save({ slug });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect((await read(a.data.id))?.slug).toMatch(/^task-[0-9a-f]{12}$/);
      expect((await read(a.data.id))?.slug).not.toBe(
        (await read(b.data.id))?.slug,
      );
    },
  );
  it.each(["  Fried Rice_01 ", "ＦＲＩＥＤ＿ＲＩＣＥ＿０２"])(
    "normalizes capitalization, width, whitespace and underscores: %s",
    async (slug) => {
      const result = await save({ slug });
      expect(result.status).toBe(200);
      expect((await read(result.data.id))?.slug).toMatch(/^fried-rice-0[12]$/);
    },
  );
  it.each([
    "炒飯",
    "a",
    "-friedrice",
    "friedrice-",
    "friedrice!",
    "a".repeat(121),
  ])("explains invalid manual identifiers: %s", async (slug) => {
    const result = await save({ slug });
    expect(result.status).toBe(400);
    expect(result.error.code).toBe("INVALID_TASK_SLUG");
    expect(result.error.message).not.toBe("輸入資料格式不正確，請檢查後再試。");
  });
  it("reports a duplicate without creating another task", async () => {
    await save({ slug: "duplicate-friedrice" });
    const result = await save({ slug: "DUPLICATE_FRIEDRICE" });
    expect(result.status).toBe(409);
    expect(result.error.code).toBe("TASK_SLUG_EXISTS");
    expect(result.error.message).toContain("留空");
    expect(
      await getDb().query.tasks.findMany({
        where: eq(tasks.slug, "duplicate-friedrice"),
      }),
    ).toHaveLength(1);
  });
  it("keeps an existing draft identifier when the field is cleared", async () => {
    const id = (await save({ slug: "draft-identifier" })).data.id;
    expect((await save({ id, slug: "" })).status).toBe(200);
    expect((await read(id))?.slug).toBe("draft-identifier");
    expect((await save({ id })).status).toBe(200);
    expect((await read(id))?.slug).toBe("draft-identifier");
  });
});
