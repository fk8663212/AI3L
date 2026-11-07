import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { expect, test } from "@playwright/test";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import { conceptMapSignature } from "@/lib/domain/speaking-outline";
import type { ConceptMap } from "@/lib/ai/schemas";
loadEnvConfig(process.cwd(), true);
const map: ConceptMap = {
  nodes: [
    {
      id: "gate",
      labelEn: "entrance",
      labelZh: "入口",
      category: "place",
      source: "student",
    },
    {
      id: "stall",
      labelEn: "stall",
      labelZh: "攤位",
      category: "place",
      source: "student",
    },
    {
      id: "vendor",
      labelEn: "vendor",
      labelZh: "攤販",
      category: "person",
      source: "ai",
    },
    {
      id: "bakery",
      labelEn: "bakery",
      labelZh: "糕餅店",
      category: "place",
      source: "student",
    },
    {
      id: "cake",
      labelEn: "pineapple cake",
      labelZh: "鳳梨酥",
      category: "object",
      source: "ai",
    },
    {
      id: "crowd",
      labelEn: "crowd",
      labelZh: "人群",
      category: "person",
      source: "student",
    },
  ],
  edges: [
    {
      id: "works",
      from: "vendor",
      to: "stall",
      relationEn: "works at",
      relationZh: "工作於",
      source: "student",
    },
    {
      id: "sells",
      from: "bakery",
      to: "cake",
      relationEn: "sells",
      relationZh: "販售",
      source: "student",
    },
  ],
};
const sections = [
  { id: "opening", titleZh: "入口", titleEn: "Entrance", nodeIds: ["gate"] },
  {
    id: "stalls",
    titleZh: "攤位",
    titleEn: "Stalls",
    nodeIds: ["stall", "vendor"],
  },
  {
    id: "food",
    titleZh: "特色美食",
    titleEn: "Local snacks",
    nodeIds: ["bakery", "cake"],
  },
  { id: "closing", titleZh: "總結", titleEn: "Closing", nodeIds: ["crowd"] },
];
const originals = [
  "I saw stalls.",
  "I bought pineapple cake.",
  "The market was lively.",
];
const starts = [
  "At the entrance, I …",
  "The vendors here …",
  "One popular snack here is …",
  "Overall, the market …",
];

test.describe("Macro / Micro in the learning workspace", () => {
  let db: Pool;
  let taskId: string;
  let sessionId: string;
  test.beforeEach(async () => {
    test.skip(
      !process.env.DATABASE_URL || !process.env.AUTH_SECRET,
      "Local database and auth settings are required.",
    );
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    taskId = (
      await db.query(
        "insert into tasks(slug,title,description,status,provider,model_id,config,published_at) values($1,'Outline browser test','Synthetic outline only','published','google','synthetic-test',$2,now()) returning id",
        [`outline-browser-${randomUUID()}`, DEFAULT_TASK_CONFIG],
      )
    ).rows[0].id;
    const codeId = (
      await db.query(
        "insert into access_codes(task_id,code_hash,label) values($1,$2,'Outline test') returning id",
        [taskId, randomUUID()],
      )
    ).rows[0].id;
    sessionId = (
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
      schemaVersion: "macro-micro-v1",
    });
    await insert("sentences", "sentence_scaffold", {
      originals,
      sentences: originals,
      hintLevels: [0, 0, 0],
      hintLevel: 0,
    });
    await insert("sentence_scaffold", "sentence_scaffold", {
      speakingOutlineId: outlineId,
      sentences: originals.map((original, index) => ({
        index,
        original,
        question: "在哪裡？",
        keywords: [{ word: "market", translation: "市場" }],
        frame: "I saw …",
        example: { sentence: original, translation: "範例" },
      })),
      transitions: ["First", "Then"],
      paragraphHints: sections.map((section, index) => ({
        sectionId: section.id,
        keywords: [
          {
            word: map.nodes.find((node) => node.id === section.nodeIds.at(-1))!
              .labelEn,
            translation: map.nodes.find(
              (node) => node.id === section.nodeIds.at(-1),
            )!.labelZh,
          },
        ],
        sentenceStart: starts[index],
      })),
    });
  });
  test.afterEach(async () => {
    if (!db) return;
    try {
      if (taskId) {
        await db.query("delete from student_sessions where task_id=$1", [
          taskId,
        ]);
        await db.query("delete from tasks where id=$1", [taskId]);
      }
    } finally {
      await db.end();
    }
  });
  test.beforeEach(async ({ context, page, baseURL }) => {
    const token = await new SignJWT({ role: "student", sessionId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    await context.addCookies([
      {
        name: "ai3l_student",
        value: token,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/learn");
    // Wait for hydration and the initial research interaction to be stored.
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "select count(*)::int as count from artifacts where session_id=$1 and type='speaking_progress' and superseded_at is null",
              [sessionId],
            )
          ).rows[0].count,
        { timeout: 20_000 },
      )
      .toBe(1);
  });
  test("switches paragraph subgraphs and hints together, persists navigation and conceals them in the posttest", async ({
    page,
    context,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("button", { name: /特色美食/ }).click();
    await expect(
      page.getByRole("img", { name: "Micro：特色美食", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".paragraph-hints")).toContainText(
      "pineapple cake",
    );
    await expect(page.locator(".paragraph-hints")).toContainText(
      "One popular snack here is …",
    );
    await page.locator(".micro-workspace").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("macro-micro-food.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: /^2 攤位/ }).click();
    await expect(page.locator(".paragraph-hints")).toContainText("vendor");
    await expect(page.locator(".paragraph-hints")).toContainText(
      "The vendors here …",
    );
    await expect(page.locator(".paragraph-hints")).not.toContainText(
      "pineapple cake",
    );
    await expect
      .poll(
        async () =>
          (
            await db.query(
              "select data->>'sectionId' as id from artifacts where session_id=$1 and type='speaking_progress' and superseded_at is null",
              [sessionId],
            )
          ).rows[0]?.id,
      )
      .toBe("stalls");
    expect(
      (
        await db.query(
          "select data from artifacts where session_id=$1 and type='speaking_progress' and superseded_at is null",
          [sessionId],
        )
      ).rows[0].data.hintsVisible,
    ).toBe(true);
    await page.reload();
    await expect(page.getByRole("button", { name: /^2 攤位/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "單層概念圖", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "我確認後的完整概念圖", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Macro／Micro 雙層圖", exact: true })
      .click();
    await expect(page.locator(".paragraph-hints")).toContainText("vendor");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await db.query(
      "update student_sessions set current_stage='posttest' where id=$1",
      [sessionId],
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Macro／Micro 雙層圖", exact: true }),
    ).toHaveCount(0);
    const response = await context.request.get("/api/student/session");
    expect(
      (await response.json()).data.artifacts.every(
        (item: { stageId: string }) => item.stageId === "posttest",
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
  test("saves renamed/reordered paragraphs and invalidates old hints without losing sentences", async ({
    page,
    context,
  }) => {
    await page.getByRole("button", { name: "調整段落名稱與順序" }).click();
    await page
      .getByRole("textbox", { name: "第 3 段中文名稱", exact: true })
      .fill("我的點心");
    await page
      .getByRole("button", { name: "上移第 3 段", exact: true })
      .click();
    await page
      .getByRole("button", { name: "保存講述順序", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /^2 我的點心/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", {
        name: "每行一句，先不要看提示",
        exact: true,
      }),
    ).toHaveValue(originals.join("\n"));
    await expect(page.locator(".paragraph-hints")).not.toContainText(
      "One popular snack here is …",
    );
    const view = (
      await (await context.request.get("/api/student/session")).json()
    ).data;
    expect(view.gate.code).toBe("AI_OUTPUT_REQUIRED");
    await page.reload();
    await expect(
      page.getByRole("button", { name: /^2 我的點心/ }),
    ).toBeVisible();
  });
});
