import { expect, test } from "@playwright/test";

test("student entry keeps the research flow focused", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/AI3L Speaking Lab/);
  await expect(
    page.getByRole("heading", { name: "先畫出想法，再用英語說出來。" }),
  ).toBeVisible();
  await expect(page.getByLabel("學生代碼")).toBeVisible();
  await expect(page.getByRole("button", { name: "進入學習" })).toBeVisible();
  await expect(page.getByText("手繪情境")).toBeVisible();
  await expect(page.getByText("獨立口說")).toBeVisible();

  if (testInfo.project.name === "chromium") {
    await page.screenshot({
      path: testInfo.outputPath("student-entry.png"),
      fullPage: true,
    });
  }
});

test("admin surface is separated from student access", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "研究管理後台" })).toBeVisible();
  await expect(page.getByLabel("管理員密碼")).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "登入管理後台" })).toBeVisible();
});
