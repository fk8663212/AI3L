import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { expect, test } from "@playwright/test";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import { speakingTemplateSelection } from "@/lib/domain/speaking-templates";
import { conceptMapSignature } from "@/lib/domain/speaking-outline";
import { problemSolutionMap, problemSolutionSections } from "../fixtures/problem-solution";

loadEnvConfig(process.cwd(), true);
const finalMap = {
  ...problemSolutionMap,
  nodes: problemSolutionMap.nodes.map(node => node.id === "bins" ? { ...node, labelEn: "final recycling bins" } : node),
};
const finalSections = [...problemSolutionSections].reverse().map((section, index) => ({
  ...section, titleZh: index ? section.titleZh : "我最後確認的總結",
}));

test.describe("concept map reference during the final recording", () => {
  let db: Pool;
  let taskId: string | undefined;
  let sessionId: string;
  let mapId: string;
  test.beforeEach(async ({ context, page, baseURL }) => {
    test.skip(!process.env.DATABASE_URL || !process.env.AUTH_SECRET, "Local database and auth are required.");
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    taskId = undefined;
    const template = speakingTemplateSelection("problem_solution")!;
    const config = structuredClone(DEFAULT_TASK_CONFIG);
    config.speakingTemplate = template;
    config.stageConfig.posttest.minimumRecordingSeconds = 1;
    config.stageConfig.posttest.maximumRecordingSeconds = 15;
    taskId = (await db.query("insert into tasks(slug,title,description,status,provider,model_id,config,published_at) values($1,'Final map reference test','Synthetic posttest reference only','published','google','synthetic-test',$2,now()) returning id", [`posttest-reference-${randomUUID()}`, config])).rows[0].id;
    const codeId = (await db.query("insert into access_codes(task_id,code_hash,label) values($1,$2,'Final map reference test') returning id", [taskId, randomUUID()])).rows[0].id;
    sessionId = (await db.query("insert into student_sessions(task_id,access_code_id,current_stage,consented_at,consent_version) values($1,$2,'posttest',now(),'test') returning id", [taskId, codeId])).rows[0].id;
    await db.query("insert into stage_attempts(session_id,stage_id) values($1,'posttest')", [sessionId]);
    mapId = (await db.query("insert into artifacts(session_id,stage_id,type,data) values($1,'ai_concept_map','concept_decisions',$2) returning id", [sessionId, { accepted: finalMap, pending: [], rejectedIds: ["discarded-ai-node"] }])).rows[0].id;
    for (const [stage, type, data] of [
      ["ai_concept_map", "speaking_outline", { sections: finalSections, generatedSections: problemSolutionSections, sourceMapSignature: conceptMapSignature(finalMap), speakingTemplate: template, schemaVersion: "macro-micro-v2", organization: "problem_solution", informationGaps: [] }],
      ["ai_concept_map", "generated_concept_map", { nodes: [{ id: "discarded-ai-node", labelEn: "DO_NOT_SHOW_REJECTED", labelZh: "已拒絕概念", category: "other", source: "ai", x: 50, y: 50 }], edges: [] }],
      ["sentence_scaffold", "sentences", { originals: ["DO_NOT_SHOW_PRIOR_SENTENCE"] }],
      ["sentence_scaffold", "sentence_scaffold", { paragraphHints: finalSections.map(section => ({ sectionId: section.id, keywords: [{ word: "DO_NOT_SHOW_HINT_WORD", translation: "隱藏關鍵詞" }], sentenceStart: "DO_NOT_SHOW_SENTENCE_START" })) }],
    ]) await db.query("insert into artifacts(session_id,stage_id,type,data) values($1,$2,$3,$4)", [sessionId, stage, type, data]);
    const token = await new SignJWT({ role: "student", sessionId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    await context.addCookies([{ name: "ai3l_student", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    // A real encoder with synthetic sound, never uploaded or sent to AI.
    await page.addInitScript(() => {
      const state = window as unknown as { posttestMicStarts: number };
      state.posttestMicStarts = 0;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
        state.posttestMicStarts += 1;
        const audio = new AudioContext();
        await audio.resume();
        const source = audio.createOscillator();
        const gain = audio.createGain();
        gain.gain.value = 0.15;
        const destination = audio.createMediaStreamDestination();
        source.connect(gain).connect(destination);
        source.start();
        return destination.stream;
      } });
    });
    await page.route("**/api/student/uploads/**", route => route.abort());
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

  test("keeps the final edited Macro/Micro map available while recording, with no language hints or edit controls", async ({ page }, testInfo) => {
    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: "最後一次口說錄音", exact: true })).toBeVisible();
    const reference = page.getByRole("region", { name: "最後錄音的概念圖參考" });
    await expect(reference).toBeVisible();
    const sequence = reference.getByRole("list", { name: "Macro 講述順序" });
    await expect(sequence.getByRole("button").first()).toContainText("我最後確認的總結");
    await expect(page.locator(".paragraph-hints, .outline-editor, .cy-editor")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /重新安排段落|建立 Macro／Micro|保存講述順序/ })).toHaveCount(0);
    const payload = (await (await page.request.get("/api/student/session")).json()).data;
    expect(payload.posttestReference.mapArtifactId).toBe(mapId);
    expect(payload.posttestReference.outline.sections).toEqual(finalSections);
    expect(JSON.stringify(payload)).not.toMatch(/DO_NOT_SHOW_/);
    expect(payload.artifacts.every((item: { stageId: string }) => item.stageId === "posttest")).toBe(true);

    await sequence.getByRole("button").nth(1).click();
    await expect.poll(async () => (await db.query("select data from artifacts where session_id=$1 and type='posttest_reference_progress' and superseded_at is null", [sessionId])).rows[0]?.data.sectionId).toBe(finalSections[1].id);
    await page.reload();
    await expect(sequence.getByRole("button").nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "開始錄音", exact: true }).click();
    await expect(page.locator(".recording-time")).toHaveText("00:01");
    await sequence.getByRole("button").first().click();
    await expect(reference.getByRole("img", { name: "Micro：我最後確認的總結", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "停止錄音", exact: true })).toBeVisible();
    await reference.getByRole("button", { name: "單層概念圖", exact: true }).click();
    await expect(reference.getByRole("img", { name: "我確認後的完整概念圖", exact: true })).toContainText("final recycling bins");
    await reference.getByRole("button", { name: "Macro／Micro 雙層圖", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { posttestMicStarts: number }).posttestMicStarts)).toBe(1);
    await page.getByRole("button", { name: "停止錄音", exact: true }).click();
    await expect(page.locator("audio")).toBeVisible();
    await expect.poll(() => page.locator("audio").evaluate(audio => (audio as HTMLAudioElement).duration)).toBeGreaterThan(1);
    await expect(page.getByRole("button", { name: "保存錄音", exact: true })).toBeEnabled();
    const navigation = (await db.query("select content from messages where session_id=$1 and kind='posttest_reference_navigation'", [sessionId])).rows;
    expect(navigation.length).toBeGreaterThan(1);
    expect(navigation.every(row => row.content.hintsVisible === false && row.content.mapReferenceVisible === true)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    const recorder = page.locator(".posttest-recorder .stage-panel");
    expect(await recorder.evaluate(panel => {
      const box = panel.getBoundingClientRect();
      return Array.from(panel.querySelectorAll("select, audio, button")).some(element => {
        const child = element.getBoundingClientRect();
        return child.left < box.left - 1 || child.right > box.right + 1;
      });
    })).toBe(false);
    const graph = reference.getByRole("img", { name: "Micro：我最後確認的總結", exact: true });
    await graph.scrollIntoViewIfNeeded();
    if (testInfo.project.name === "chromium") {
      await expect(page.locator("audio")).toBeInViewport();
      await expect(graph).toBeInViewport();
    }
    await page.screenshot({ path: testInfo.outputPath("posttest-map-reference.png"), fullPage: true });
  });

  test("uses only the final single map when the saved outline is stale and never regenerates it", async ({ page }) => {
    const changed = { ...finalMap, nodes: finalMap.nodes.map((node, index) => index ? node : { ...node, labelEn: "changed final concept" }) };
    await db.query("update artifacts set data=$2 where id=$1", [mapId, { accepted: changed, pending: [], rejectedIds: [] }]);
    await page.goto("/learn");
    const reference = page.getByRole("region", { name: "最後錄音的概念圖參考" });
    await expect(reference.getByRole("img", { name: "我確認後的完整概念圖", exact: true })).toContainText("changed final concept");
    await expect(reference.locator(".speaking-outline")).toHaveCount(0);
    await expect(page.locator(".paragraph-hints")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "開始錄音", exact: true })).toBeEnabled();
    await expect.poll(async () => (await db.query("select data from artifacts where session_id=$1 and type='posttest_reference_progress' and superseded_at is null", [sessionId])).rows[0]?.data.mode).toBe("single");
    const response = await page.request.post("/api/student/actions", { data: { action: "build_speaking_outline" } });
    expect(response.status()).toBe(409);
    expect((await db.query("select count(*)::int as count from ai_runs where session_id=$1", [sessionId])).rows[0].count).toBe(0);
  });
});
