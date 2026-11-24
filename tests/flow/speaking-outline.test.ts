import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/client", async () => {
  const { createTestDb } = await import("./test-db");
  const db = await createTestDb();
  return { getDb: () => db };
});
const auth = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/lib/security/session", async (original) => ({
  ...(await original<typeof import("@/lib/security/session")>()),
  getStudentClaims: async () =>
    auth.id ? { role: "student", sessionId: auth.id } : null,
}));
const ai = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@/lib/ai/provider", async (original) => ({
  ...(await original<typeof import("@/lib/ai/provider")>()),
  generateStructured: ai.generate,
}));
import { POST } from "@/app/api/student/actions/route";
import { getDb } from "@/lib/db/client";
import {
  accessCodes,
  artifacts,
  messages,
  providerCredentials,
  studentSessions,
  tasks,
} from "@/lib/db/schema";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import {
  getSessionView,
  recordConsent,
  replaceArtifactData,
  saveRecordingAudio,
  startStudentSession,
} from "@/lib/services/session-service";
import { exportResearchData } from "@/lib/services/admin-service";
import {
  saveTaskDraft,
  createTaskRevision,
} from "@/lib/services/admin-service";
import { speakingTemplateSelection } from "@/lib/domain/speaking-templates";
import { encryptSecret } from "@/lib/security/crypto";
import { conceptMapOutput, sentenceScaffoldOutput } from "./fixtures";
import { causalMap, causalSections, problemSolutionMap, problemSolutionSections, problemSolutionOriginals, problemSolutionHints } from "../fixtures/problem-solution";
const map = conceptMapOutput();
const sections = [
  {
    id: "story",
    titleZh: "先說我的活動",
    titleEn: "My activity",
    nodeIds: [map.nodes[0].id],
  },
  {
    id: "details",
    titleZh: "再說環境",
    titleEn: "The setting",
    nodeIds: [map.nodes[1].id, map.nodes[2].id],
  },
];
let taskId: string;
async function act(body: Record<string, unknown>) {
  const response = await POST(
    new Request("http://localhost/api/student/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, ...(await response.json()) };
}
const current = () => getSessionView(auth.id!);
beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = "macro-micro-test-encryption-0123456789";
  const secret = encryptSecret("test-api-key");
  await getDb().insert(providerCredentials).values({
    provider: "google",
    displayName: "Test Gemini",
    encryptedKey: secret.encryptedValue,
    encryptionIv: secret.encryptionIv,
    encryptionTag: secret.encryptionTag,
    keyLastFour: "-key",
    verifiedAt: new Date(),
  });
});
beforeEach(async () => {
  ai.generate.mockReset().mockImplementation(async (input) => ({
    value:
      input.schemaName === "speaking_outline"
        ? { sections }
        : {
            ...sentenceScaffoldOutput(),
            paragraphHints: sections.map((section) => ({
              sectionId: section.id,
              keywords: [{ word: "kite", translation: "風箏" }],
              sentenceStart: `For ${section.titleEn}, I …`,
            })),
          },
  }));
  const [task] = await getDb()
    .insert(tasks)
    .values({
      slug: "outline-" + randomUUID(),
      title: "Beach story",
      description: "Outline integration test",
      provider: "google",
      modelId: "test-model",
      status: "published",
      config: DEFAULT_TASK_CONFIG,
      publishedAt: new Date(),
    })
    .returning();
  taskId = task.id;
  const hash = randomUUID();
  await getDb().insert(accessCodes).values({ taskId, codeHash: hash });
  const student = await startStudentSession(hash);
  auth.id = student.id;
  await recordConsent(student.id);
  await getDb()
    .update(studentSessions)
    .set({ currentStage: "ai_concept_map" })
    .where(eq(studentSessions.id, student.id));
  await replaceArtifactData({
    sessionId: student.id,
    stageId: "ai_concept_map",
    type: "generated_concept_map",
    data: map,
  });
  await replaceArtifactData({
    sessionId: student.id,
    stageId: "ai_concept_map",
    type: "concept_decisions",
    data: { accepted: map, pending: [], rejectedIds: [] },
  });
});

describe("Macro / Micro in the real student flow", () => {
  it.each(["chronological", "problem_solution"] as const)("saves %s, preserves it for older clients and revisions, and locks published settings", async (templateId) => {
    const input = {
      title: "Windmill activity",
      slug: "windmill-" + randomUUID(),
      description: "A synthetic procedural task",
      provider: "google" as const,
      modelId: "test-model",
      promptVersion: "1.0.0",
      retentionDays: 180,
      stageConfig: DEFAULT_TASK_CONFIG.stageConfig,
      promptConfig: DEFAULT_TASK_CONFIG.promptConfig,
    };
    const id = await saveTaskDraft({
      ...input,
      speakingTemplateId: templateId,
    });
    await saveTaskDraft({ ...input, id }); // Compatibility with an older API client.
    const task = await getDb().query.tasks.findFirst({
      where: eq(tasks.id, id),
    });
    expect(task?.config.speakingTemplate).toEqual(
      speakingTemplateSelection(templateId),
    );
    expect(JSON.stringify(task?.config.promptConfig)).not.toContain("大稻埕");
    await getDb()
      .update(tasks)
      .set({ status: "published" })
      .where(eq(tasks.id, id));
    await expect(
      saveTaskDraft({ ...input, id, speakingTemplateId: "spatial" }),
    ).rejects.toMatchObject({ code: "TASK_IMMUTABLE" });
    const revision = await createTaskRevision({
      taskId: id,
      promptVersion: "2.0.0",
    });
    expect(
      (
        await getDb().query.tasks.findFirst({
          where: eq(tasks.id, revision.id),
        })
      )?.config.speakingTemplate,
    ).toEqual(speakingTemplateSelection(templateId));
  });

  it.each([
    { organization: "problem_solution", map: problemSolutionMap, sections: problemSolutionSections, hints: problemSolutionHints },
    { organization: "causal", map: causalMap, sections: causalSections, hints: problemSolutionHints.slice(0, 2) },
  ])("builds, edits, exports and links $organization hints without reusing a stale scaffold", async ({ organization, map, sections, hints }) => {
    const template = speakingTemplateSelection("problem_solution")!;
    const originals = organization === "causal"
      ? ["There is mixed waste in our classroom.", "The labels are unclear.", "Unclear labels contribute to mixed waste."]
      : problemSolutionOriginals;
    await getDb().update(tasks).set({ config: { ...DEFAULT_TASK_CONFIG, speakingTemplate: template } }).where(eq(tasks.id, taskId));
    await replaceArtifactData({ sessionId: auth.id!, stageId: "ai_concept_map", type: "concept_decisions", data: { accepted: map, pending: [], rejectedIds: [] } });
    ai.generate.mockImplementation(async (input) => ({
      value: input.schemaName === "speaking_outline"
        ? { sections, organization, informationGaps: ["請確認成因的觀察依據。"] }
        : {
            ...sentenceScaffoldOutput(),
            sentences: originals.map((original, index) => ({ index, original, question: "你觀察到什麼？", keywords: [{ word: "labels", translation: "標示" }], frame: "One observation is …", example: { sentence: original, translation: "固定測試句" } })),
            transitions: ["Because", "As a result"],
            paragraphHints: hints,
          },
    }));
    expect((await current()).gate.code).toBe("OUTLINE_REQUIRED");
    expect((await act({ action: "build_speaking_outline" })).status).toBe(200);
    expect(ai.generate.mock.calls[0][0].prompt).toContain("不是因果證據");
    const initial = (await current()).artifacts.find(item => item.type === "speaking_outline")!;
    expect(initial.data).toMatchObject({ speakingTemplate: template, organization, informationGaps: ["請確認成因的觀察依據。"], schemaVersion: "macro-micro-v2" });
    const edited = [{ ...sections[0], titleZh: "我觀察到的問題" }, ...sections.slice(1)];
    expect((await act({ action: "save_speaking_outline", sections: edited })).status).toBe(200);
    const outline = (await current()).artifacts.find(item => item.type === "speaking_outline")!;
    expect(outline.data.generatedSections).toEqual(sections);
    expect(outline.data.organization).toBe(organization);
    expect((await act({ action: "complete_stage", stage: "ai_concept_map", stateVersion: (await current()).session.stateVersion })).status).toBe(200);
    expect((await act({ action: "run_ai", stage: "sentence_scaffold" })).error.code).toBe("SENTENCES_REQUIRED");
    await act({ action: "save_sentences", phase: "draft", sentences: originals, hintLevel: 0, idempotencyKey: randomUUID() });
    expect((await act({ action: "run_ai", stage: "sentence_scaffold" })).status).toBe(200);
    expect(ai.generate.mock.calls.at(-1)![0].prompt).toContain("已有觀察證據的結果才用");
    const scaffold = (await current()).artifacts.find(item => item.type === "sentence_scaffold")!;
    expect(scaffold.data).toMatchObject({ speakingOutlineId: outline.id, speakingTemplate: template, paragraphHints: hints });
    expect(JSON.stringify(await exportResearchData(taskId))).toContain(organization);
    expect((await act({ action: "save_speaking_outline", sections: [...edited].reverse() })).status).toBe(200);
    expect((await current()).gate.code).toBe("AI_OUTPUT_REQUIRED");
    expect((await current()).artifacts.find(item => item.type === "sentences")?.data.originals).toEqual(originals);
    await getDb().update(studentSessions).set({ currentStage: "posttest" }).where(eq(studentSessions.id, auth.id!));
    expect((await current()).artifacts.some(item => ["speaking_outline", "sentence_scaffold"].includes(item.type))).toBe(false);
    expect((await act({ action: "build_speaking_outline" })).error.code).toBe("STAGE_LOCKED");
  });

  it("builds and exports a procedural outline, requires it before hints, and conceals it in the posttest", async () => {
    const template = speakingTemplateSelection("chronological")!;
    await getDb()
      .update(tasks)
      .set({ config: { ...DEFAULT_TASK_CONFIG, speakingTemplate: template } })
      .where(eq(tasks.id, taskId));
    expect((await current()).gate.code).toBe("OUTLINE_REQUIRED");
    ai.generate.mockImplementationOnce(async () => ({
      value: {
        sections,
        organization: "procedural",
        informationGaps: ["請補充最後的測試結果。"],
      },
    }));
    expect((await act({ action: "build_speaking_outline" })).status).toBe(200);
    const outline = (await current()).artifacts.find(
      (item) => item.type === "speaking_outline",
    )!;
    expect(outline.data.speakingTemplate).toEqual(template);
    expect(outline.data.schemaVersion).toBe("macro-micro-v2");
    expect(outline.data.informationGaps).toEqual(["請補充最後的測試結果。"]);
    expect((await current()).task.config.speakingTemplate).toEqual(template);
    expect(
      (
        await act({
          action: "save_speaking_outline",
          sections: [...sections].reverse(),
        })
      ).status,
    ).toBe(200);
    const editedOutline = (await current()).artifacts.find(
      (item) => item.type === "speaking_outline",
    )!;
    expect(ai.generate.mock.calls[0][0].prompt).toContain("核心操作／步驟");
    expect(
      (
        await act({
          action: "complete_stage",
          stage: "ai_concept_map",
          stateVersion: (await current()).session.stateVersion,
        })
      ).status,
    ).toBe(200);
    await act({
      action: "save_sentences",
      phase: "draft",
      sentences: [
        "I prepare the paper.",
        "I make the blades.",
        "I test the windmill.",
      ],
      hintLevel: 0,
      idempotencyKey: randomUUID(),
    });
    expect(
      (await act({ action: "run_ai", stage: "sentence_scaffold" })).status,
    ).toBe(200);
    expect(ai.generate.mock.calls.at(-1)![0].prompt).toContain("First、Next");
    const scaffold = (await current()).artifacts.find(
      (item) => item.type === "sentence_scaffold",
    )!;
    expect(scaffold.data.speakingTemplate).toEqual(template);
    expect(scaffold.data.speakingOutlineId).toBe(editedOutline.id);
    expect(JSON.stringify(await exportResearchData(taskId))).toContain(
      "procedural",
    );
    await getDb()
      .update(studentSessions)
      .set({ currentStage: "posttest" })
      .where(eq(studentSessions.id, auth.id!));
    expect(
      (await current()).artifacts.some(
        (item) =>
          item.type === "speaking_outline" || item.type === "sentence_scaffold",
      ),
    ).toBe(false);
  });

  it("rejects legacy outlines for a template task before requesting language hints", async () => {
    await act({ action: "build_speaking_outline" });
    await getDb()
      .update(tasks)
      .set({
        config: {
          ...DEFAULT_TASK_CONFIG,
          speakingTemplate: speakingTemplateSelection("chronological"),
        },
      })
      .where(eq(tasks.id, taskId));
    await getDb()
      .update(studentSessions)
      .set({ currentStage: "sentence_scaffold" })
      .where(eq(studentSessions.id, auth.id!));
    await act({
      action: "save_sentences",
      phase: "draft",
      sentences: ["I prepare paper.", "I fold it.", "I test it."],
      hintLevel: 0,
      idempotencyKey: randomUUID(),
    });
    expect(
      (await act({ action: "run_ai", stage: "sentence_scaffold" })).error.code,
    ).toBe("OUTLINE_REQUIRED");
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect((await current()).gate.code).toBe("OUTLINE_REQUIRED");
  });

  it("discards an outline if the task template changes during generation", async () => {
    const template = speakingTemplateSelection("chronological")!;
    await getDb()
      .update(tasks)
      .set({ config: { ...DEFAULT_TASK_CONFIG, speakingTemplate: template } })
      .where(eq(tasks.id, taskId));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ai.generate.mockImplementationOnce(async () => {
      await gate;
      return {
        value: { sections, organization: "procedural", informationGaps: [] },
      };
    });
    const pending = act({ action: "build_speaking_outline" });
    await vi.waitFor(() => expect(ai.generate).toHaveBeenCalledTimes(1));
    await getDb()
      .update(tasks)
      .set({
        config: {
          ...DEFAULT_TASK_CONFIG,
          speakingTemplate: speakingTemplateSelection("spatial"),
        },
      })
      .where(eq(tasks.id, taskId));
    release();
    expect((await pending).error.code).toBe("OUTLINE_CHANGED");
    expect(
      (await current()).artifacts.some(
        (item) => item.type === "speaking_outline",
      ),
    ).toBe(false);
  });

  it("builds from approved concepts, saves edits, links language hints and exports research records", async () => {
    expect((await act({ action: "build_speaking_outline" })).status).toBe(200);
    expect(ai.generate.mock.calls[0][0].prompt).toContain(map.nodes[0].id);
    expect(ai.generate.mock.calls[0][0].prompt).not.toContain("入口 → 攤位");
    const edited = [{ ...sections[1], titleZh: "我選擇先說環境" }, sections[0]];
    expect(
      (await act({ action: "save_speaking_outline", sections: edited })).status,
    ).toBe(200);
    const outline = (await current()).artifacts.find(
      (item) => item.type === "speaking_outline",
    )!;
    expect(outline.data.sections).toEqual(edited);
    expect(outline.data.generatedSections).toEqual(sections);
    expect(
      (
        await act({
          action: "complete_stage",
          stage: "ai_concept_map",
          stateVersion: (await current()).session.stateVersion,
        })
      ).status,
    ).toBe(200);
    expect(
      (await act({ action: "run_ai", stage: "sentence_scaffold" })).error.code,
    ).toBe("SENTENCES_REQUIRED");
    await act({
      action: "save_sentences",
      phase: "draft",
      sentences: ["I fly a kite.", "I see wind.", "The beach is big."],
      hintLevel: 0,
      idempotencyKey: randomUUID(),
    });
    expect(
      (await act({ action: "run_ai", stage: "sentence_scaffold" })).status,
    ).toBe(200);
    expect(ai.generate.mock.calls.at(-1)![0].prompt).toContain(
      "我選擇先說環境",
    );
    const scaffold = (await current()).artifacts.find(
      (item) => item.type === "sentence_scaffold",
    )!;
    expect(scaffold.data.speakingOutlineId).toBe(outline.id);
    expect((scaffold.data.paragraphHints as unknown[]).length).toBe(2);
    const nav = {
      action: "speaking_navigation",
      sectionId: "details",
      mode: "macro_micro",
      hintsVisible: true,
      idempotencyKey: randomUUID(),
    };
    expect((await act(nav)).status).toBe(200);
    expect((await act(nav)).status).toBe(200);
    expect(
      (await current()).artifacts.find(
        (item) => item.type === "speaking_progress",
      )?.data.hintsVisible,
    ).toBe(true);
    const logs = await getDb().query.messages.findMany({
      where: and(
        eq(messages.sessionId, auth.id!),
        eq(messages.kind, "speaking_navigation"),
      ),
    });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(await exportResearchData(taskId))).toContain(
      "speaking_outline",
    );
    expect(
      (await act({ action: "save_speaking_outline", sections })).status,
    ).toBe(200);
    expect((await current()).gate.code).toBe("AI_OUTPUT_REQUIRED");
  });

  it("discards hints if the student edits the outline while AI is running", async () => {
    await act({ action: "build_speaking_outline" });
    await getDb()
      .update(studentSessions)
      .set({ currentStage: "sentence_scaffold" })
      .where(eq(studentSessions.id, auth.id!));
    await act({
      action: "save_sentences",
      phase: "draft",
      sentences: ["I fly a kite.", "I see wind.", "The beach is big."],
      hintLevel: 0,
      idempotencyKey: randomUUID(),
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ai.generate.mockImplementationOnce(async () => {
      await gate;
      return {
        value: {
          ...sentenceScaffoldOutput(),
          paragraphHints: sections.map((section) => ({
            sectionId: section.id,
            keywords: [{ word: "kite", translation: "風箏" }],
            sentenceStart: "I …",
          })),
        },
      };
    });
    const pending = act({ action: "run_ai", stage: "sentence_scaffold" });
    await vi.waitFor(() => expect(ai.generate).toHaveBeenCalledTimes(2));
    await act({
      action: "save_speaking_outline",
      sections: [...sections].reverse(),
    });
    release();
    expect((await pending).error.code).toBe("OUTLINE_CHANGED");
    expect(
      (await current()).artifacts.some(
        (item) => item.type === "sentence_scaffold",
      ),
    ).toBe(false);
    expect(
      (await current()).artifacts.find((item) => item.type === "sentences")
        ?.data.originals,
    ).toHaveLength(3);
  });

  it("requires the correct stage, review and consent before generating", async () => {
    await getDb()
      .update(studentSessions)
      .set({ currentStage: "pretest" })
      .where(eq(studentSessions.id, auth.id!));
    expect((await act({ action: "build_speaking_outline" })).status).toBe(409);
    await getDb()
      .update(studentSessions)
      .set({ currentStage: "ai_concept_map" })
      .where(eq(studentSessions.id, auth.id!));
    await replaceArtifactData({
      sessionId: auth.id!,
      stageId: "ai_concept_map",
      type: "concept_decisions",
      data: { accepted: map, pending: ["unreviewed"] },
    });
    expect((await act({ action: "build_speaking_outline" })).error.code).toBe(
      "REVIEW_REQUIRED",
    );
    await getDb()
      .update(studentSessions)
      .set({ consentedAt: null })
      .where(eq(studentSessions.id, auth.id!));
    expect((await act({ action: "build_speaking_outline" })).error.code).toBe(
      "CONSENT_REQUIRED",
    );
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("rejects fabricated concepts and keeps the last valid plan after an invalid edit", async () => {
    await act({ action: "build_speaking_outline" });
    const original = (await current()).artifacts.find(
      (item) => item.type === "speaking_outline",
    )!.id;
    expect(
      (
        await act({
          action: "save_speaking_outline",
          sections: [{ ...sections[0], nodeIds: ["foreign-node"] }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await current()).artifacts.find(
        (item) => item.type === "speaking_outline",
      )!.id,
    ).toBe(original);
    expect(
      (
        await act({
          action: "speaking_navigation",
          sectionId: "foreign-section",
          mode: "macro_micro",
          hintsVisible: true,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(400);
  });

  it("exposes only the final confirmed map and edited sections in the posttest, and rejects content writes", async () => {
    await act({ action: "build_speaking_outline" });
    const edited = [...sections].reverse().map((section, index) => ({ ...section, titleZh: `最後順序 ${index + 1}` }));
    await act({ action: "save_speaking_outline", sections: edited });
    await getDb().insert(artifacts).values({ sessionId: auth.id!, stageId: "sentence_scaffold", type: "sentence_scaffold", data: { secret: "NEVER_REVEAL_SENTENCE_START" } });
    await getDb()
      .update(studentSessions)
      .set({ currentStage: "posttest" })
      .where(eq(studentSessions.id, auth.id!));
    expect(
      (await current()).artifacts.some(
        (item) => item.type === "speaking_outline",
      ),
    ).toBe(false);
    const reference = (await current()).posttestReference!;
    expect(reference.map).toEqual(map);
    expect(reference.outline?.sections).toEqual(edited);
    expect(JSON.stringify(await current())).not.toContain("NEVER_REVEAL_SENTENCE_START");
    expect(reference).not.toHaveProperty("paragraphHints");
    expect((await act({ action: "build_speaking_outline" })).status).toBe(409);
    expect(
      (await act({ action: "save_speaking_outline", sections })).status,
    ).toBe(409);
    expect(
      (
        await act({
          action: "speaking_navigation",
          sectionId: "story",
          mode: "macro_micro",
          hintsVisible: true,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
    ai.generate.mockClear();
    const firstKey = randomUUID();
    const browse = (sectionId: string, idempotencyKey = randomUUID()) => act({
      action: "posttest_reference_navigation", sectionId, mode: "macro_micro", idempotencyKey,
      hintsVisible: true,
    });
    expect((await browse("story", firstKey)).status).toBe(200);
    expect((await browse("details")).status).toBe(200);
    expect((await browse("story", firstKey)).status).toBe(200);
    expect((await browse("foreign-section")).status).toBe(400);
    const progress = (await current()).artifacts.find(item => item.type === "posttest_reference_progress")!;
    expect(progress.data).toMatchObject({ sectionId: "details", hintsVisible: false, mapReferenceVisible: true, mapArtifactId: reference.mapArtifactId, outlineArtifactId: reference.outlineArtifactId });
    expect((await current()).messages.filter(item => item.kind === "posttest_reference_navigation")).toHaveLength(2);
    expect(ai.generate).not.toHaveBeenCalled();
    await getDb().update(studentSessions).set({ completedAt: new Date() }).where(eq(studentSessions.id, auth.id!));
    expect((await browse("story")).error.code).toBe("SESSION_COMPLETED");
    auth.id = null;
    expect((await act({ action: "build_speaking_outline" })).status).toBe(401);
  });

  it("falls back to the confirmed single map for a stale outline, without generating new content", async () => {
    expect((await act({ action: "posttest_reference_navigation", mode: "single", idempotencyKey: randomUUID() })).error.code).toBe("STAGE_LOCKED");
    await act({ action: "build_speaking_outline" });
    await getDb().update(studentSessions).set({ currentStage: "posttest" }).where(eq(studentSessions.id, auth.id!));
    const decisions = await getDb().query.artifacts.findFirst({ where: and(eq(artifacts.sessionId, auth.id!), eq(artifacts.type, "concept_decisions"), isNull(artifacts.supersededAt)) });
    const changed = { ...map, nodes: map.nodes.map((node, index) => index ? node : { ...node, labelEn: "final edited concept" }) };
    await getDb().update(artifacts).set({ data: { ...decisions!.data, accepted: changed } }).where(eq(artifacts.id, decisions!.id));
    ai.generate.mockClear();
    expect((await current()).posttestReference).toMatchObject({ map: changed, outline: null, outlineArtifactId: null });
    expect((await act({ action: "posttest_reference_navigation", mode: "single", idempotencyKey: randomUUID() })).status).toBe(200);
    expect((await act({ action: "posttest_reference_navigation", mode: "macro_micro", sectionId: "story", idempotencyKey: randomUUID() })).status).toBe(400);
    await getDb().update(artifacts).set({ data: { ...decisions!.data, accepted: changed, pending: [{ id: "not-reviewed" }] } }).where(eq(artifacts.id, decisions!.id));
    expect((await current()).posttestReference).toBeNull();
    expect((await act({ action: "posttest_reference_navigation", mode: "single", idempotencyKey: randomUUID() })).error.code).toBe("REFERENCE_UNAVAILABLE");
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("freezes the recording reference in the saved audio and research export", async () => {
    await act({ action: "build_speaking_outline" });
    await getDb().update(studentSessions).set({ currentStage: "posttest" }).where(eq(studentSessions.id, auth.id!));
    const reference = (await current()).posttestReference;
    const audio = await saveRecordingAudio({ sessionId: auth.id!, stageId: "posttest", audio: {
      storageProvider: "local", storageLocator: "local://test/posttest-reference.webm", mimeType: "audio/webm", sizeBytes: 100,
      data: { durationSeconds: 35, posttestSupport: { reference: "untrusted client value" } },
    } });
    expect(audio.data.posttestSupport).toEqual({ policyVersion: "concept-map-only-v1", reference });
    const decisions = await getDb().query.artifacts.findFirst({ where: and(eq(artifacts.id, reference!.mapArtifactId)) });
    await getDb().update(artifacts).set({ data: { ...decisions!.data, accepted: { ...map, nodes: [] } } }).where(eq(artifacts.id, decisions!.id));
    expect((await current()).posttestReference).toEqual(reference);
    expect((await exportResearchData(taskId)).artifacts.find(item => item.id === audio.id)!.data.posttestSupport).toEqual(audio.data.posttestSupport);
  });

  it("keeps the reference condition of older saved posttests unchanged", async () => {
    await act({ action: "build_speaking_outline" });
    await getDb().update(studentSessions).set({ currentStage: "posttest" }).where(eq(studentSessions.id, auth.id!));
    await getDb().insert(artifacts).values({ sessionId: auth.id!, stageId: "posttest", type: "audio", data: { durationSeconds: 30 } });
    expect((await current()).posttestReference).toBeNull();
    expect((await current()).artifacts.find(item => item.type === "audio")!.data).not.toHaveProperty("posttestSupport");
    expect((await act({ action: "posttest_reference_navigation", mode: "single", idempotencyKey: randomUUID() })).error.code).toBe("REFERENCE_UNAVAILABLE");
  });

  it("discards an AI outline when its source map changes during generation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ai.generate.mockImplementationOnce(async () => {
      await gate;
      return { value: { sections } };
    });
    const pending = act({ action: "build_speaking_outline" });
    await vi.waitFor(() => expect(ai.generate).toHaveBeenCalledTimes(1));
    await replaceArtifactData({
      sessionId: auth.id!,
      stageId: "ai_concept_map",
      type: "concept_decisions",
      data: {
        accepted: {
          ...map,
          nodes: map.nodes.map((node) => ({ ...node, labelEn: "changed" })),
        },
        pending: [],
      },
    });
    release();
    expect((await pending).error.code).toBe("OUTLINE_CHANGED");
    expect(
      await getDb().query.artifacts.findMany({
        where: and(
          eq(artifacts.sessionId, auth.id!),
          eq(artifacts.type, "speaking_outline"),
          isNull(artifacts.supersededAt),
        ),
      }),
    ).toHaveLength(0);
  });
});
