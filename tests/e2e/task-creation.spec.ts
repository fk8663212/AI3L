import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { expect, test } from "@playwright/test";

loadEnvConfig(process.cwd(), true);
test.describe("teacher task creation", () => {
  let db: Pool;
  let title: string;
  test.beforeEach(async ({ context, page, baseURL }) => {
    test.skip(
      !process.env.DATABASE_URL || !process.env.AUTH_SECRET,
      "Local database and auth are required.",
    );
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    title = `炒飯流程表單測試 ${randomUUID()}`;
    const token = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    await context.addCookies([
      {
        name: "ai3l_admin",
        value: token,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/admin");
    await page.getByRole("button", { name: "研究任務", exact: true }).click();
    await page.getByLabel("任務名稱", { exact: true }).fill(title);
  });
  test.afterEach(async () => {
    if (!db) return;
    try {
      await db.query("delete from tasks where title=$1", [title]);
    } finally {
      await db.end();
    }
  });

  test("creates a task without asking the teacher to invent an identifier", async ({
    page,
  }) => {
    await expect(page.getByLabel("唯一識別名稱")).toHaveValue("");
    await page
      .getByLabel("研究任務摘要")
      .fill("用英文說明炒飯的製作過程與觀察。 ");
    await page.getByLabel("講述架構模板").selectOption("chronological");
    const response = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/actions") &&
        response.request().postDataJSON()?.action === "save_task",
    );
    await page
      .getByRole("button", { name: "建立可編輯草稿", exact: true })
      .click();
    expect((await response).ok()).toBe(true);
    await expect
      .poll(
        async () =>
          (await db.query("select slug from tasks where title=$1", [title]))
            .rows[0]?.slug,
      )
      .toMatch(/^task-[0-9a-f]{12}$/);
    const saved = (
      await db.query("select slug from tasks where title=$1", [title])
    ).rows[0];
    await expect(
      page.getByRole("row").filter({ hasText: title }),
    ).toContainText(saved.slug);
  });

  test("accepts simple identifiers, identifies a short summary, and explains an invalid custom identifier", async ({
    page,
  }) => {
    const slug = page.getByLabel("唯一識別名稱");
    const customSlug = `friedrice-${randomUUID()}`;
    await slug.fill(customSlug);
    await page.getByLabel("研究任務摘要").fill("炒飯流程");
    await page
      .getByRole("button", { name: "建立可編輯草稿", exact: true })
      .click();
    await expect(page.locator("#task-description-error")).toContainText(
      "研究任務摘要",
    );
    await expect(page.locator("#task-description-error")).toContainText("10");
    await expect(slug).not.toHaveAttribute("aria-invalid", "true");
    expect(
      (
        await db.query(
          "select count(*)::int as count from tasks where title=$1",
          [title],
        )
      ).rows[0].count,
    ).toBe(0);

    await page
      .getByLabel("研究任務摘要")
      .fill("用英文說明炒飯的製作過程與觀察。");
    await slug.fill("炒飯");
    await page
      .getByRole("button", { name: "建立可編輯草稿", exact: true })
      .click();
    await expect(page.locator("#task-slug-error")).toContainText("中文請填在");
    await slug.fill(`  ${customSlug.toUpperCase()} `);
    await page.getByLabel("研究任務摘要").focus();
    await expect(slug).toHaveValue(customSlug);
    await expect(slug).not.toHaveAttribute("aria-invalid", "true");
    expect(
      await page
        .locator("#task-prompt-version")
        .evaluate((input) =>
          new RegExp((input as HTMLInputElement).pattern, "v").test(
            (input as HTMLInputElement).value,
          ),
        ),
    ).toBe(true);

    // Leave the user's desired identifier free; create only an isolated auto-ID task.
    await slug.fill("");
    const response = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/actions") &&
        response.request().postDataJSON()?.action === "save_task",
    );
    await page
      .getByRole("button", { name: "建立可編輯草稿", exact: true })
      .click();
    expect((await response).ok()).toBe(true);
    await expect
      .poll(
        async () =>
          (await db.query("select slug from tasks where title=$1", [title]))
            .rows[0]?.slug,
      )
      .toMatch(/^task-[0-9a-f]{12}$/);
  });
});
