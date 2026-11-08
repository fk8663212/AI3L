import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { expect, test, type BrowserContext } from "@playwright/test";
import { DEFAULT_TASK_CONFIG, normalizeTaskConfig } from "@/lib/domain/default-task";
import { applySpeakingTemplateInstructions, speakingTemplateSelection } from "@/lib/domain/speaking-templates";
import { conceptMapSignature } from "@/lib/domain/speaking-outline";
import { causalMap, causalSections, problemSolutionMap, problemSolutionSections, problemSolutionOriginals, problemSolutionHints } from "../fixtures/problem-solution";

loadEnvConfig(process.cwd(), true);
const template = speakingTemplateSelection("problem_solution")!;
const config = normalizeTaskConfig({
  ...DEFAULT_TASK_CONFIG,
  speakingTemplate: template,
  stageConfig: applySpeakingTemplateInstructions(DEFAULT_TASK_CONFIG.stageConfig, "problem_solution"),
});

test.describe("cause and effect / problem-solution template", () => {
  let db: Pool;
  let slug: string;
  test.beforeEach(async () => {
    test.skip(!process.env.DATABASE_URL || !process.env.AUTH_SECRET, "Local auth and database are required.");
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    slug = `problem-solution-browser-${randomUUID()}`;
  });
  test.afterEach(async () => {
    if (!db) return;
    try {
      const tasks = await db.query("select id from tasks where slug=$1", [slug]);
      for (const task of tasks.rows) {
        await db.query("delete from student_sessions where task_id=$1", [task.id]);
        await db.query("delete from tasks where id=$1", [task.id]);
      }
    } finally { await db.end(); }
  });

  async function signIn(context: BrowserContext, baseURL: string, role: "admin" | "student", sessionId?: string) {
    const token = await new SignJWT({ role, ...(sessionId ? { sessionId } : {}) })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    await context.addCookies([{ name: `ai3l_${role}`, value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  }

  test("teacher saves and reopens the third template without losing custom instructions", async ({ context, page, baseURL }) => {
    await signIn(context, baseURL!, "admin");
    await page.goto("/admin");
    await page.getByRole("button", { name: "研究任務", exact: true }).click();
    await page.getByLabel("任務名稱", { exact: true }).fill(`垃圾分類 ${slug}`);
    await page.getByLabel("唯一識別名稱").fill(slug);
    await page.getByLabel("研究任務摘要").fill("Synthetic problem-solution browser validation only.");
    const custom = "請畫出自己在教室觀察到的回收情境。";
    await page.locator("#instruction-visualization").fill(custom);
    await page.getByLabel("講述架構模板").selectOption("chronological");
    await page.getByLabel("講述架構模板").selectOption("problem_solution");
    await expect(page.locator("#instruction-visualization")).toHaveValue(custom);
    await expect(page.locator("#instruction-ai_concept_map")).toHaveValue(/預期成效與已觀察結果/);
    await expect(page.locator(".speaking-template-description")).toContainText("只有因果資料時不硬加解法");
    await expect(page.locator("#instruction-pretest")).not.toHaveValue(/Because|成因|解決策略|→/);
    await page.getByRole("button", { name: "建立可編輯草稿", exact: true }).click();
    await expect.poll(async () => (await db.query("select config from tasks where slug=$1", [slug])).rows[0]?.config.speakingTemplate).toEqual(template);
    await page.reload();
    await page.getByRole("button", { name: "研究任務", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: slug });
    await expect(row).toContainText("因果／問題解決順序");
    await row.getByRole("button", { name: "編輯草稿", exact: true }).click();
    await expect(page.getByLabel("講述架構模板")).toHaveValue("problem_solution");
    await expect(page.locator("#instruction-visualization")).toHaveValue(custom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });

  for (const example of [
    { organization: "problem_solution", label: "問題與解決", map: problemSolutionMap, sections: problemSolutionSections, hints: problemSolutionHints, originals: problemSolutionOriginals },
    { organization: "causal", label: "原因與影響", map: causalMap, sections: causalSections, hints: problemSolutionHints.slice(0, 2), originals: ["There is mixed waste in our classroom.", "The labels are unclear.", "Unclear labels contribute to mixed waste."] },
  ]) {
    test(`student switches ${example.organization} subgraphs and hints, saves edits and has no posttest cues`, async ({ context, page, baseURL }, testInfo) => {
      const { map, sections, hints, originals, organization } = example;
      const taskId = (await db.query(
        "insert into tasks(slug,title,description,status,provider,model_id,config,published_at) values($1,'Classroom sorting','Synthetic problem analysis only','published','google','synthetic-test',$2,now()) returning id",
        [slug, config],
      )).rows[0].id;
      const codeId = (await db.query("insert into access_codes(task_id,code_hash,label) values($1,$2,'Problem analysis test') returning id", [taskId, randomUUID()])).rows[0].id;
      const sessionId = (await db.query("insert into student_sessions(task_id,access_code_id,current_stage,consented_at,consent_version) values($1,$2,'sentence_scaffold',now(),'test') returning id", [taskId, codeId])).rows[0].id;
      await db.query("insert into stage_attempts(session_id,stage_id) values($1,'sentence_scaffold')", [sessionId]);
      async function insert(type: string, stage: string, data: unknown) {
        return (await db.query("insert into artifacts(session_id,stage_id,type,data) values($1,$2,$3,$4) returning id", [sessionId, stage, type, data])).rows[0].id;
      }
      await insert("concept_decisions", "ai_concept_map", { accepted: map, pending: [], rejectedIds: [] });
      const outlineId = await insert("speaking_outline", "ai_concept_map", {
        sections, generatedSections: sections, sourceMapSignature: conceptMapSignature(map),
        speakingTemplate: template, schemaVersion: "macro-micro-v2", organization,
        informationGaps: ["請補充成因的觀察依據。"],
      });
      await insert("sentences", "sentence_scaffold", { originals, sentences: originals, hintLevels: [0, 0, 0], hintLevel: 0 });
      await insert("sentence_scaffold", "sentence_scaffold", {
        speakingOutlineId: outlineId, speakingTemplate: template,
        sentences: originals.map((original, index) => ({ index, original, question: "你觀察到什麼？", keywords: [{ word: "labels", translation: "標示" }], frame: "One observation is …", example: { sentence: original, translation: "固定測試句" } })),
        transitions: ["Because", "As a result"], paragraphHints: hints,
      });
      await signIn(context, baseURL!, "student", sessionId);
      await page.goto("/learn");
      await expect(page.locator(".speaking-outline")).toContainText(`因果／問題解決順序 · ${example.label}`);
      await expect(page.getByRole("note", { name: "待補充提醒" })).toContainText("請補充成因的觀察依據。");
      await page.getByRole("button", { name: /2 標示與成因/ }).click();
      const causeGraph = page.getByRole("img", { name: "Micro：標示與成因", exact: true });
      await expect(causeGraph).toContainText("unclear labels");
      await expect(causeGraph).toContainText("contributes to");
      await expect(causeGraph.locator(".concept-node")).toHaveCount(2);
      const boxes = await causeGraph.locator(".concept-node").evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }));
      expect(boxes[0].left < boxes[1].right && boxes[0].right > boxes[1].left && boxes[0].top < boxes[1].bottom && boxes[0].bottom > boxes[1].top).toBe(false);
      await expect(page.locator(".paragraph-hints")).toContainText("Because the labels are unclear, …");
      if (organization === "problem_solution") {
        await page.getByRole("button", { name: /3 改善標示的提案/ }).click();
        await expect(page.getByRole("img", { name: "Micro：改善標示的提案", exact: true })).toContainText("could be placed on");
        await expect(page.locator(".paragraph-hints")).toContainText("To solve this problem, we could …");
        await page.getByRole("button", { name: /4 預期分類改善/ }).click();
        await expect(page.getByRole("img", { name: "Micro：預期分類改善", exact: true })).toContainText("may improve");
        await expect(page.locator(".paragraph-hints")).toContainText("This could help …");
        await expect(page.locator(".paragraph-hints")).not.toContainText("Because the labels");
      } else {
        await expect(page.locator(".macro-sequence > li")).toHaveCount(2);
        await expect(page.getByRole("button", { name: /改善標示的提案/ })).toHaveCount(0);
      }
      await page.locator(".micro-workspace").scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`${organization}.png`), fullPage: true });
      await page.getByRole("button", { name: "單層概念圖", exact: true }).click();
      await expect(page.getByRole("img", { name: "我確認後的完整概念圖", exact: true })).toBeVisible();
      await expect(page.locator(".paragraph-hints")).toHaveCount(0);
      await page.getByRole("button", { name: "Macro／Micro 雙層圖", exact: true }).click();
      await page.getByRole("button", { name: "調整段落名稱與順序" }).click();
      await page.getByRole("textbox", { name: "第 2 段中文名稱", exact: true }).fill("我確認的成因");
      await page.getByRole("button", { name: "上移第 2 段", exact: true }).click();
      await page.getByRole("button", { name: "保存講述順序", exact: true }).click();
      await expect(page.getByRole("button", { name: /1 我確認的成因/ })).toBeVisible();
      await expect(page.locator(".paragraph-hints")).not.toContainText("Because the labels are unclear");
      const saved = (await db.query("select data from artifacts where session_id=$1 and type='speaking_outline' and superseded_at is null", [sessionId])).rows[0].data;
      expect(saved.speakingTemplate).toEqual(template);
      expect(saved.organization).toBe(organization);
      expect(saved.sections[0].titleZh).toBe("我確認的成因");
      expect((await db.query("select data from artifacts where session_id=$1 and type='sentences' and superseded_at is null", [sessionId])).rows[0].data.originals).toEqual(originals);
      await page.reload();
      await expect(page.getByRole("button", { name: /1 我確認的成因/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await signIn(context, baseURL!, "admin");
      const writes: string[] = [];
      const teacherPage = await context.newPage();
      teacherPage.on("request", request => { if (request.url().includes("/api/student/") && request.method() !== "GET") writes.push(request.url()); });
      await teacherPage.goto(`/admin/sessions/${sessionId}?mode=full`);
      await expect(teacherPage.locator(".speaking-outline").first()).toContainText(`因果／問題解決順序 · ${example.label}`);
      expect(writes).toEqual([]);
      await teacherPage.close();
      await db.query("update student_sessions set current_stage='posttest' where id=$1", [sessionId]);
      await page.goto("/learn");
      await expect(page.locator(".speaking-outline")).toHaveCount(0);
      await expect(page.getByText("請補充成因的觀察依據。", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Because the labels are unclear, …", { exact: true })).toHaveCount(0);
      const response = await page.request.post("/api/student/actions", { data: { action: "build_speaking_outline" } });
      expect(response.status()).toBe(409);
    });
  }
});
