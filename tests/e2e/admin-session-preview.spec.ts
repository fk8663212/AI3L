import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { SignJWT } from "jose";
import { expect, test } from "@playwright/test";

config({ path: ".env.local", override: false });

async function adminToken(): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for admin E2E tests.");
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));
}

test("admin session preview redirects unauthenticated users", async ({ page }) => {
  await page.goto(
    "/admin/sessions/11111111-1111-4111-8111-111111111111",
  );
  await expect(page).toHaveURL(/\/admin\/login$/u);
});

test("admin can search and print a session without student mutations", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    !process.env.AUTH_SECRET || !process.env.DATABASE_URL,
    "Admin session E2E needs AUTH_SECRET and DATABASE_URL.",
  );
  await context.addCookies([
    {
      name: "ai3l_admin",
      value: await adminToken(),
      url: "http://127.0.0.1:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const listResponse = await context.request.get("/api/admin/sessions?page=1");
  expect(listResponse.ok()).toBe(true);
  const listPayload = (await listResponse.json()) as {
    data: {
      items: Array<{ id: string; taskId: string }>;
      pagination: { pageSize: number };
    };
  };
  expect(listPayload.data.pagination.pageSize).toBe(25);
  test.skip(!listPayload.data.items.length, "No session is available to preview.");
  const session = listPayload.data.items[0];

  const filteredResponse = await context.request.get(
    `/api/admin/sessions?page=1&taskId=${session.taskId}`,
  );
  expect(filteredResponse.ok()).toBe(true);
  const wildcardResponse = await context.request.get(
    "/api/admin/sessions?page=1&q=%25_",
  );
  expect(wildcardResponse.ok()).toBe(true);

  const studentMutations: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/student/") &&
      request.method() !== "GET"
    ) {
      studentMutations.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto(`/admin/sessions/${session.id}?mode=student`);
  await expect(
    page.getByText("管理員唯讀預覽：此頁不會修改學生資料。"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "完整學習歷程" })).toBeVisible();
  await expect(page.locator(".session-preview-content form")).toHaveCount(0);

  await page.getByRole("link", { name: "完整學習歷程" }).click();
  await expect(page).toHaveURL(/mode=full/u);
  await expect(
    page.getByRole("heading", { name: "Session 完整學習歷程" }),
  ).toBeVisible();
  await expect(page.getByText("管理員唯讀資料：")).toBeVisible();
  expect(studentMutations).toEqual([]);

  if (testInfo.project.name === "chromium") {
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".session-preview-toolbar")).toBeHidden();
    await page.pdf({
      path: testInfo.outputPath("admin-session-full.pdf"),
      format: "A4",
      printBackground: true,
      margin: {
        top: "14mm",
        right: "14mm",
        bottom: "14mm",
        left: "14mm",
      },
    });
  }
});

test("session print stylesheet renders a long A4 learning record", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "PDF is verified in Chromium.");
  const styles = readFileSync(resolve("app/globals.css"), "utf8");
  const stages = Array.from({ length: 7 }, (_, index) => {
    const stage = index + 1;
    const sentences = Array.from(
      { length: 6 },
      (__, sentenceIndex) =>
        `<p>第 ${sentenceIndex + 1} 筆學習內容：學生描述市場中的人物、物件與事件，並使用完整英文句子說明觀察結果。</p>`,
    ).join("");
    return `
      <section class="learning-stage">
        <header class="learning-stage-header">
          <span>${stage}</span>
          <div>
            <h2>階段 ${stage} 學習歷程</h2>
            <p>用來驗證長內容、中文字型及跨頁排版。</p>
          </div>
        </header>
        <div class="learning-stage-content">
          <div class="learning-record-group">
            <h3>對話與學生輸入</h3>
            <div class="message-row student">
              <div class="message-bubble">${sentences}</div>
            </div>
          </div>
          <div class="learning-record-group">
            <h3>學習產物</h3>
            <article class="learning-artifact">
              <header><div><h4>口說描述性分析</h4><small>2026/7/30 20:30</small></div><span class="tag">ready</span></header>
              <div class="session-evaluation">
                <dl>
                  <div><dt>內容單位</dt><dd>${stage + 2}</dd></div>
                  <div><dt>每分鐘字數</dt><dd>${70 + stage}</dd></div>
                  <div><dt>停頓次數</dt><dd>${stage}</dd></div>
                </dl>
                <p><strong>組織回饋：</strong>內容順序清楚，能描述主要人物與事件。</p>
                <p><strong>下一步：</strong>加入更多時間連接詞與細節。</p>
              </div>
            </article>
          </div>
        </div>
      </section>`;
  }).join("");

  await page.setContent(`<!doctype html>
    <html lang="zh-Hant">
      <head>
        <meta charset="utf-8">
        <style>
          :root { --line:#d8d5cf; --ink:#172033; --ink-soft:#667085; }
          ${styles}
        </style>
      </head>
      <body>
        <main class="session-preview-page">
          <div class="session-preview-content full-mode">
            <header class="learning-record-title">
              <p class="eyebrow">AI3L Speaking Lab</p>
              <h1>Session 完整學習歷程</h1>
              <p>列印版面驗證任務</p>
            </header>
            <section class="session-metadata">
              <div><span>Session ID</span><strong>11111111-1111-4111-8111-111111111111</strong></div>
              <div><span>學生標籤</span><strong>Student 001</strong></div>
              <div><span>目前階段</span><strong>posttest</strong></div>
              <div><span>狀態</span><strong>completed</strong></div>
            </section>
            <div class="learning-stage-list">${stages}</div>
          </div>
        </main>
      </body>
    </html>`);
  await page.setViewportSize({ width: 794, height: 1122 });
  await page.emulateMedia({ media: "print" });
  await page.screenshot({
    path: testInfo.outputPath("session-print-layout.png"),
    fullPage: true,
  });
  const pdfPath = testInfo.outputPath("session-print-fixture.pdf");
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  expect(readFileSync(pdfPath).byteLength).toBeGreaterThan(10_000);
});
