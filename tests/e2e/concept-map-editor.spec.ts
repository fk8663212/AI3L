import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { expect, test } from "@playwright/test";
import { DEFAULT_TASK_CONFIG, normalizeTaskConfig } from "@/lib/domain/default-task";
import { conceptMapSignature } from "@/lib/domain/speaking-outline";
import { speakingTemplateSelection } from "@/lib/domain/speaking-templates";
import { problemSolutionMap, problemSolutionSections } from "../fixtures/problem-solution";

loadEnvConfig(process.cwd(), true);

test("edits the Cytoscape map, preserves percentage positions and invalidates content-based outlines", async ({ context, page, baseURL }, testInfo) => {
  test.skip(!process.env.DATABASE_URL || !process.env.AUTH_SECRET, "Local database and auth are required.");
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  let taskId: string | undefined;
  try {
    const template = speakingTemplateSelection("problem_solution")!;
    const config = normalizeTaskConfig({ ...DEFAULT_TASK_CONFIG, speakingTemplate: template });
    const positions = [[50, 20], [50, 50], [50, 80], [20, 50], [80, 50], [80, 80]];
    const map = { ...problemSolutionMap, nodes: problemSolutionMap.nodes.map((node, index) => ({ ...node, x: positions[index][0], y: positions[index][1] })) };
    taskId = (await db.query("insert into tasks(slug,title,description,status,provider,model_id,config,published_at) values($1,'Canvas editor test','Synthetic editor integration only','published','google','synthetic-test',$2,now()) returning id", [`canvas-editor-${randomUUID()}`, config])).rows[0].id;
    const codeId = (await db.query("insert into access_codes(task_id,code_hash,label) values($1,$2,'Canvas editor test') returning id", [taskId, randomUUID()])).rows[0].id;
    const sessionId = (await db.query("insert into student_sessions(task_id,access_code_id,current_stage,consented_at,consent_version) values($1,$2,'ai_concept_map',now(),'test') returning id", [taskId, codeId])).rows[0].id;
    await db.query("insert into stage_attempts(session_id,stage_id) values($1,'ai_concept_map')", [sessionId]);
    for (const [type, data] of [
      ["generated_concept_map", map],
      ["concept_decisions", { accepted: map, pending: [], rejectedIds: [] }],
      ["speaking_outline", { sections: problemSolutionSections, generatedSections: problemSolutionSections, sourceMapSignature: conceptMapSignature(map), speakingTemplate: template, schemaVersion: "macro-micro-v2", organization: "problem_solution", informationGaps: [] }],
    ]) await db.query("insert into artifacts(session_id,stage_id,type,data) values($1,'ai_concept_map',$2,$3)", [sessionId, type, data]);
    const token = await new SignJWT({ role: "student", sessionId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    await context.addCookies([{ name: "ai3l_student", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/learn");
    const editor = page.locator(".concept-editor");
    const graph = editor.getByRole("application", { name: "可編輯的概念圖" });
    await expect(graph).toHaveAttribute("aria-busy", "false");
    await graph.scrollIntoViewIfNeeded();
    async function point(x: number, y: number) {
      const box = (await graph.locator(".concept-map-plane").boundingBox())!;
      return { x: box.x + box.width * x / 100, y: box.y + box.height * y / 100 };
    }
    const classroom = await point(50, 20);
    await page.mouse.click(classroom.x, classroom.y);
    const english = editor.getByLabel("英文", { exact: true });
    await expect(english).toHaveValue("classroom");
    await english.fill("study room");
    await editor.getByRole("button", { name: "復原", exact: true }).click();
    await expect(english).toHaveValue("classroom");
    await editor.getByRole("button", { name: "重做", exact: true }).click();
    await expect(english).toHaveValue("study room");
    await editor.getByLabel("中文", { exact: true }).fill("自習教室");
    await editor.getByRole("button", { name: "連到…", exact: true }).click();
    await graph.scrollIntoViewIfNeeded();
    const labels = await point(50, 80);
    await page.mouse.click(labels.x, labels.y);
    await editor.getByLabel("關係（英文）", { exact: true }).fill("is in");
    await editor.getByLabel("關係（中文）", { exact: true }).fill("位於");
    await editor.getByRole("button", { name: "反轉方向", exact: true }).click();
    await graph.scrollIntoViewIfNeeded();
    const start = await point(50, 20);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 30, start.y, { steps: 12 });
    await page.mouse.up();
    await editor.getByRole("button", { name: "保存我的概念圖", exact: true }).click();
    await expect.poll(async () => (await db.query("select data from artifacts where session_id=$1 and type='concept_decisions' and superseded_at is null", [sessionId])).rows[0]?.data.accepted.nodes.find((node: { id: string }) => node.id === "classroom")?.labelEn).toBe("study room");
    const saved = (await db.query("select data from artifacts where session_id=$1 and type='concept_decisions' and superseded_at is null", [sessionId])).rows[0].data.accepted;
    const moved = saved.nodes.find((node: { id: string }) => node.id === "classroom");
    expect(moved.x).toBeGreaterThan(51);
    expect(moved.x).toBeLessThan(60);
    expect(moved.y).toBeCloseTo(20, 0);
    expect(saved.edges).toContainEqual(expect.objectContaining({ from: "unclear-labels", to: "classroom", relationEn: "is in" }));
    expect((await (await page.request.get("/api/student/session")).json()).data.gate.code).toBe("OUTLINE_REQUIRED");
    await page.reload();
    await expect(graph).toHaveAttribute("aria-busy", "false");
    const adminToken = await new SignJWT({ role: "admin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    await context.addCookies([{ name: "ai3l_admin", value: adminToken, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    const teacherPage = await context.newPage();
    await teacherPage.goto(`/admin/sessions/${sessionId}?mode=full`);
    const savedPlane = teacherPage.locator(".concept-map-plane").filter({ hasText: "study room" }).first();
    await expect(savedPlane).toBeVisible();
    const offset = await savedPlane.evaluate((plane, x) => {
      const node = Array.from(plane.querySelectorAll(".concept-node")).find(node => node.textContent?.includes("study room"))!;
      const drawing = plane.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return Math.abs(box.x + box.width / 2 - (drawing.x + drawing.width * x / 100));
    }, moved.x);
    expect(offset).toBeLessThan(1);
    await teacherPage.close();
    await graph.scrollIntoViewIfNeeded();
    await graph.screenshot({ path: testInfo.outputPath("cytoscape-editor.png") });
  } finally {
    if (taskId) {
      await db.query("delete from student_sessions where task_id=$1", [taskId]);
      await db.query("delete from tasks where id=$1", [taskId]);
    }
    await db.end();
  }
});
