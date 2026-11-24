import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { expect, test } from "@playwright/test";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import { jiaoxiEnrichmentMap as map } from "../fixtures/knowledge-enrichment";

loadEnvConfig(process.cwd(), true);

test.describe("reviewing activity-based background suggestions", () => {
  let db: Pool;
  let taskId: string | undefined;
  let sessionId: string;
  test.beforeEach(async ({ context, baseURL }) => {
    test.skip(!process.env.DATABASE_URL || !process.env.AUTH_SECRET, "Local database and auth are required.");
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    taskId = undefined;
    taskId = (await db.query("insert into tasks(slug,title,description,status,provider,model_id,config,published_at) values($1,'礁溪旅遊','Synthetic enrichment review only','published','google','synthetic-test',$2,now()) returning id", [`knowledge-browser-${randomUUID()}`, DEFAULT_TASK_CONFIG])).rows[0].id;
    const code = (await db.query("insert into access_codes(task_id,code_hash,label) values($1,$2,'Knowledge review test') returning id", [taskId, randomUUID()])).rows[0].id;
    sessionId = (await db.query("insert into student_sessions(task_id,access_code_id,current_stage,consented_at,consent_version) values($1,$2,'ai_concept_map',now(),'test') returning id", [taskId, code])).rows[0].id;
    await db.query("insert into stage_attempts(session_id,stage_id) values($1,'ai_concept_map')", [sessionId]);
    await db.query("insert into artifacts(session_id,stage_id,type,data) values($1,'ai_concept_map','generated_concept_map',$2)", [sessionId, { ...map, enrichmentPolicy: "topic-knowledge-v1" }]);
    await db.query("insert into artifacts(session_id,stage_id,type,data) values($1,'ai_concept_map','concept_decisions',$2)", [sessionId, { accepted: { nodes: [], edges: [] }, pending: ["hot-spring", "possible-bath"], rejectedIds: [] }]);
    const token = await new SignJWT({ role: "student", sessionId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    await context.addCookies([{ name: "ai3l_student", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  });
  test.afterEach(async () => {
    if (!db) return;
    try {
      if (taskId) {
        await db.query("delete from student_sessions where task_id=$1", [taskId]);
        await db.query("delete from tasks where id=$1", [taskId]);
      }
    } finally { await db.end(); }
  });

  test("labels unconfirmed background knowledge and saves only the student's explicit choices", async ({ page }, testInfo) => {
    await page.goto("/learn");
    const node = page.locator(".review-item").filter({ hasText: "你這次有泡溫泉嗎？" });
    const edge = page.locator(".review-item").filter({ hasText: "泡溫泉符合這次在礁溪的活動嗎？" });
    await expect(node).toContainText("AI 背景知識補述");
    await expect(page.getByRole("button", { name: "還有 2 項沒有決定", exact: true })).toBeDisabled();
    await node.getByRole("button", { name: "保留", exact: true }).click();
    await edge.getByRole("button", { name: "保留", exact: true }).click();
    const submitted = page.waitForRequest(request => request.url().includes("/api/student/actions") && request.postDataJSON()?.action === "review_concepts");
    await page.getByRole("button", { name: "確認概念圖", exact: true }).click();
    expect((await submitted).postDataJSON().confirmedEnrichmentIds.sort()).toEqual(["hot-spring", "possible-bath"].sort());
    await expect(page.getByText("概念圖已確認。", { exact: true })).toBeVisible();
    const preview = page.getByRole("img", { name: "擴充概念圖（預覽你的選擇）", exact: true });
    await expect(preview).toContainText("學生保留");
    const accepted = (await db.query("select data from artifacts where session_id=$1 and type='concept_decisions' and superseded_at is null", [sessionId])).rows[0].data.accepted;
    expect(accepted.nodes.find((item: { id: string }) => item.id === "hot-spring")).toMatchObject({ source: "ai", enrichment: { confirmedByStudent: true } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("knowledge-review.png"), fullPage: true });
  });

  test("removing a possible experience removes its relation and keeps it out of the final map", async ({ page }) => {
    await page.goto("/learn");
    const node = page.locator(".review-item").filter({ hasText: "你這次有泡溫泉嗎？" });
    await node.getByRole("button", { name: "移除", exact: true }).click();
    await page.getByRole("button", { name: "確認概念圖", exact: true }).click();
    await expect(page.getByText("概念圖已確認。", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "擴充概念圖（預覽你的選擇）", exact: true })).not.toContainText("hot spring bath");
    const data = (await db.query("select data from artifacts where session_id=$1 and type='concept_decisions' and superseded_at is null", [sessionId])).rows[0].data;
    expect(data.accepted.nodes.map((item: { id: string }) => item.id)).toEqual(["trip", "jiaoxi"]);
    expect(data.accepted.edges.map((item: { id: string }) => item.id)).toEqual(["destination"]);
  });

  test("regeneration asks for fresh choices even when the model reuses item IDs", async ({ page, context }) => {
    await page.goto("/learn");
    for (const item of await page.locator(".review-item").all()) await item.getByRole("button", { name: "保留", exact: true }).click();
    await page.getByRole("button", { name: "確認概念圖", exact: true }).click();
    await expect(page.getByText("概念圖已確認。", { exact: true })).toBeVisible();
    await page.route("**/api/student/actions", async route => {
      if (route.request().postDataJSON()?.action !== "run_ai") return route.continue();
      // Replace just this isolated fixture; never call a real AI service here.
      await db.query("update artifacts set superseded_at=now() where session_id=$1 and type in ('generated_concept_map','concept_decisions') and superseded_at is null", [sessionId]);
      const regenerated = structuredClone(map);
      regenerated.nodes[2].labelEn = "new hot spring suggestion";
      await db.query("insert into artifacts(session_id,stage_id,type,data) values($1,'ai_concept_map','generated_concept_map',$2)", [sessionId, { ...regenerated, enrichmentPolicy: "topic-knowledge-v1" }]);
      await db.query("insert into artifacts(session_id,stage_id,type,data) values($1,'ai_concept_map','concept_decisions',$2)", [sessionId, { accepted: { nodes: [], edges: [] }, pending: ["hot-spring", "possible-bath"], rejectedIds: [] }]);
      const data = (await (await context.request.get("/api/student/session")).json()).data;
      return route.fulfill({ json: { ok: true, data } });
    });
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "重新生成概念圖與補述", exact: true }).click();
    await expect(page.locator(".review-item").first()).toContainText("new hot spring suggestion");
    await expect(page.getByRole("button", { name: "還有 2 項沒有決定", exact: true })).toBeDisabled();
    await expect(page.locator('.review-item button[aria-pressed="true"]')).toHaveCount(0);
    expect((await db.query("select count(*)::int as count from ai_runs where session_id=$1", [sessionId])).rows[0].count).toBe(0);
  });
});
