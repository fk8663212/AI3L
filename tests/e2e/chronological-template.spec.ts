import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { expect, test, type BrowserContext } from "@playwright/test";
import {
  DEFAULT_TASK_CONFIG,
  normalizeTaskConfig,
} from "@/lib/domain/default-task";
import {
  applySpeakingTemplateInstructions,
  speakingTemplateSelection,
} from "@/lib/domain/speaking-templates";
import { conceptMapSignature } from "@/lib/domain/speaking-outline";
import type { ConceptMap } from "@/lib/ai/schemas";

loadEnvConfig(process.cwd(), true);
const template = speakingTemplateSelection("chronological")!;
const config = normalizeTaskConfig({
  ...DEFAULT_TASK_CONFIG,
  speakingTemplate: template,
  stageConfig: applySpeakingTemplateInstructions(
    DEFAULT_TASK_CONFIG.stageConfig,
    "chronological",
  ),
});
const map: ConceptMap = {
  nodes: [
    {
      id: "paper",
      labelEn: "paper",
      labelZh: "紙張",
      category: "object",
      source: "student",
    },
    {
      id: "scissors",
      labelEn: "scissors",
      labelZh: "剪刀",
      category: "object",
      source: "student",
    },
    {
      id: "blade",
      labelEn: "blade",
      labelZh: "葉片",
      category: "object",
      source: "student",
    },
    {
      id: "axle",
      labelEn: "axle",
      labelZh: "軸心",
      category: "object",
      source: "ai",
    },
    {
      id: "assembly",
      labelEn: "assembly",
      labelZh: "組裝",
      category: "event",
      source: "student",
    },
    {
      id: "windmill",
      labelEn: "windmill",
      labelZh: "風車",
      category: "object",
      source: "student",
    },
    {
      id: "spinning",
      labelEn: "spinning",
      labelZh: "轉動",
      category: "event",
      source: "student",
    },
  ],
  edges: [
    {
      id: "fold",
      from: "paper",
      to: "blade",
      relationEn: "fold into",
      relationZh: "折成",
      source: "student",
    },
    {
      id: "attach",
      from: "blade",
      to: "axle",
      relationEn: "attach to",
      relationZh: "連接",
      source: "student",
    },
    {
      id: "produce",
      from: "assembly",
      to: "windmill",
      relationEn: "produces",
      relationZh: "製作出",
      source: "student",
    },
    {
      id: "test",
      from: "windmill",
      to: "spinning",
      relationEn: "test for",
      relationZh: "測試是否",
      source: "student",
    },
  ],
};
const sections = [
  {
    id: "prepare",
    titleZh: "材料準備",
    titleEn: "Preparation",
    nodeIds: ["paper", "scissors"],
  },
  {
    id: "assemble",
    titleZh: "組裝步驟",
    titleEn: "Assembly",
    nodeIds: ["paper", "blade", "axle"],
  },
  {
    id: "test",
    titleZh: "轉動測試",
    titleEn: "Testing",
    nodeIds: ["windmill", "spinning"],
  },
  {
    id: "finish",
    titleZh: "完成檢驗",
    titleEn: "Final check",
    nodeIds: ["assembly", "windmill"],
  },
];
const originals = [
  "I prepare the paper.",
  "I attach the blade to the axle.",
  "I test the windmill.",
];
const starters = [
  "First, we prepare …",
  "Next, we attach …",
  "Then, we test …",
  "Finally, we check …",
];

test.describe("chronological speaking template", () => {
  let db: Pool;
  let slug: string;
  test.beforeEach(async () => {
    test.skip(
      !process.env.DATABASE_URL || !process.env.AUTH_SECRET,
      "Local auth and database are required.",
    );
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    slug = `chronological-browser-${randomUUID()}`;
  });
  test.afterEach(async () => {
    if (!db) return;
    try {
      const tasks = await db.query("select id from tasks where slug=$1", [
        slug,
      ]);
      for (const task of tasks.rows) {
        await db.query("delete from student_sessions where task_id=$1", [
          task.id,
        ]);
        await db.query("delete from tasks where id=$1", [task.id]);
      }
    } finally {
      await db.end();
    }
  });
  async function signIn(
    context: BrowserContext,
    baseURL: string,
    role: "admin" | "student",
    sessionId?: string,
  ) {
    const token = await new SignJWT({
      role,
      ...(sessionId ? { sessionId } : {}),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    await context.addCookies([
      {
        name: `ai3l_${role}`,
        value: token,
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }

  test("teacher selects, saves and reopens the temporal template while custom instructions survive", async ({
    context,
    page,
    baseURL,
  }) => {
    await signIn(context, baseURL!, "admin");
    await page.goto("/admin");
    await page.getByRole("button", { name: "研究任務", exact: true }).click();
    await page.getByLabel("任務名稱", { exact: true }).fill(`風車流程 ${slug}`);
    await page.getByLabel("唯一識別名稱").fill(slug);
    await page
      .getByLabel("研究任務摘要")
      .fill("Synthetic chronological browser validation only.");
    const custom = "請畫出你在實作課親手完成的作品。";
    await page.locator("#instruction-visualization").fill(custom);
    await page.getByLabel("講述架構模板").selectOption("chronological");
    await expect(page.locator("#instruction-visualization")).toHaveValue(
      custom,
    );
    await expect(page.locator("#instruction-ai_concept_map")).toHaveValue(
      /時間／流程/,
    );
    await expect(page.locator("#instruction-pretest")).not.toHaveValue(
      /大稻埕|First|Next|→/,
    );
    await page
      .getByRole("button", { name: "建立可編輯草稿", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await db.query("select config from tasks where slug=$1", [slug]))
            .rows[0]?.config.speakingTemplate,
      )
      .toEqual(template);
    await page.reload();
    await page.getByRole("button", { name: "研究任務", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: slug });
    await expect(row).toContainText("時間／流程順序");
    await row.getByRole("button", { name: "編輯草稿", exact: true }).click();
    await expect(page.getByLabel("講述架構模板")).toHaveValue("chronological");
    await expect(page.locator("#instruction-visualization")).toHaveValue(
      custom,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });

  test("student switches temporal subgraphs and sentence starts, preserves edits and sees no hints in the posttest", async ({
    context,
    page,
    baseURL,
  }, testInfo) => {
    const taskId = (
      await db.query(
        "insert into tasks(slug,title,description,status,provider,model_id,config,published_at) values($1,'Windmill procedure','Synthetic chronology only','published','google','synthetic-test',$2,now()) returning id",
        [slug, config],
      )
    ).rows[0].id;
    const codeId = (
      await db.query(
        "insert into access_codes(task_id,code_hash,label) values($1,$2,'Procedure test') returning id",
        [taskId, randomUUID()],
      )
    ).rows[0].id;
    const sessionId = (
      await db.query(
        "insert into student_sessions(task_id,access_code_id,current_stage,consented_at,consent_version) values($1,$2,'sentence_scaffold',now(),'test') returning id",
        [taskId, codeId],
      )
    ).rows[0].id;
    await db.query(
      "insert into stage_attempts(session_id,stage_id) values($1,'sentence_scaffold')",
      [sessionId],
    );
    const insert = async (type: string, stage: string, data: unknown) =>
      (
        await db.query(
          "insert into artifacts(session_id,stage_id,type,data) values($1,$2,$3,$4) returning id",
          [sessionId, stage, type, data],
        )
      ).rows[0].id;
    await insert("concept_decisions", "ai_concept_map", {
      accepted: map,
      pending: [],
      rejectedIds: [],
    });
    const outlineId = await insert("speaking_outline", "ai_concept_map", {
      sections,
      generatedSections: sections,
      sourceMapSignature: conceptMapSignature(map),
      speakingTemplate: template,
      schemaVersion: "macro-micro-v2",
      organization: "procedural",
      informationGaps: ["請確認測試時的條件。"],
    });
    await insert("sentences", "sentence_scaffold", {
      originals,
      sentences: originals,
      hintLevels: [0, 0, 0],
      hintLevel: 0,
    });
    await insert("sentence_scaffold", "sentence_scaffold", {
      speakingOutlineId: outlineId,
      speakingTemplate: template,
      sentences: originals.map((original, index) => ({
        index,
        original,
        question: "做了什麼？",
        keywords: [{ word: "paper", translation: "紙張" }],
        frame: "I …",
        example: { sentence: original, translation: "範例" },
      })),
      transitions: ["First", "Next", "Finally"],
      paragraphHints: sections.map((section, index) => ({
        sectionId: section.id,
        keywords: [
          {
            word: index === 1 ? "axle" : "windmill",
            translation: index === 1 ? "軸心" : "風車",
          },
        ],
        sentenceStart: starters[index],
      })),
    });
    await signIn(context, baseURL!, "student", sessionId);
    await page.goto("/learn");
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "select count(*)::int as count from artifacts where session_id=$1 and type='speaking_progress'",
              [sessionId],
            )
          ).rows[0].count,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    await expect(page.locator(".speaking-outline")).toContainText(
      "時間／流程順序 · 實作步驟",
    );
    await expect(page.getByRole("note", { name: "待補充提醒" })).toContainText(
      "請確認測試時的條件。",
    );
    await page.getByRole("button", { name: /2 組裝步驟/ }).click();
    await expect(
      page.getByRole("img", { name: "Micro：組裝步驟", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".paragraph-hints")).toContainText("axle");
    await expect(page.locator(".paragraph-hints")).toContainText(
      "Next, we attach …",
    );
    await page.locator(".micro-workspace").scrollIntoViewIfNeeded();
    await expect(
      page
        .getByRole("img", { name: "Micro：組裝步驟", exact: true })
        .locator(".concept-node")
        .filter({ hasText: "軸心" }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("chronological-assembly.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: /4 完成檢驗/ }).click();
    await expect(page.locator(".paragraph-hints")).toContainText(
      "Finally, we check …",
    );
    await expect(page.locator(".paragraph-hints")).not.toContainText(
      "Next, we attach",
    );
    await page.getByRole("button", { name: "調整段落名稱與順序" }).click();
    await page
      .getByRole("textbox", { name: "第 2 段中文名稱", exact: true })
      .fill("我的組裝過程");
    await page
      .getByRole("button", { name: "上移第 2 段", exact: true })
      .click();
    await page
      .getByRole("button", { name: "保存講述順序", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /1 我的組裝過程/ }),
    ).toBeVisible();
    await expect(page.locator(".paragraph-hints")).not.toContainText(
      "Finally, we check",
    );
    const saved = (
      await db.query(
        "select data from artifacts where session_id=$1 and type='speaking_outline' and superseded_at is null",
        [sessionId],
      )
    ).rows[0].data;
    expect(saved.speakingTemplate).toEqual(template);
    expect(saved.sections[0].titleZh).toBe("我的組裝過程");
    await signIn(context, baseURL!, "admin");
    const studentWrites: string[] = [];
    const teacherPage = await context.newPage();
    teacherPage.on("request", (request) => {
      if (request.url().includes("/api/student/") && request.method() !== "GET")
        studentWrites.push(request.url());
    });
    await teacherPage.goto(`/admin/sessions/${sessionId}?mode=full`);
    await expect(
      teacherPage.getByRole("heading", { name: "Session 完整學習歷程" }),
    ).toBeVisible();
    await expect(
      teacherPage.locator(".speaking-outline").first(),
    ).toContainText("時間／流程順序");
    expect(studentWrites).toEqual([]);
    await teacherPage.close();
    await db.query(
      "update student_sessions set current_stage='posttest' where id=$1",
      [sessionId],
    );
    await page.goto("/learn");
    await expect(page.locator(".speaking-outline")).toHaveCount(0);
    await expect(
      page.getByText("Next, we attach …", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("請確認測試時的條件。", { exact: true }),
    ).toHaveCount(0);
  });
});
