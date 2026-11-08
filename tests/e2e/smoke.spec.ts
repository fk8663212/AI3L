import { expect, test } from "@playwright/test";

test("permits the local blob workers used by HEIC conversion", async ({ page }) => {
  await page.goto("/");
  const message = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(new Blob(["onmessage = () => postMessage('worker-ready');"], { type: "text/javascript" }));
    const worker = new Worker(url);
    const cleanup = () => { worker.terminate(); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Blob worker did not start")); }, 5000);
    worker.onmessage = event => { clearTimeout(timer); cleanup(); resolve(String(event.data)); };
    worker.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error("Blob worker was blocked")); };
    worker.postMessage("start");
  }));
  expect(message).toBe("worker-ready");
});

test("student entry keeps the research flow focused", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/AI3L Speaking Lab/);
  await expect(
    page.getByRole("heading", { name: /^先畫出想法，\s*再用英語說出來。$/u }),
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
