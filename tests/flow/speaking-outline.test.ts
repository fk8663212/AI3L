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
  startStudentSession,
} from "@/lib/services/session-service";
import { exportResearchData } from "@/lib/services/admin-service";
import { encryptSecret } from "@/lib/security/crypto";
import { conceptMapOutput, sentenceScaffoldOutput } from "./fixtures";
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
  await getDb()
    .insert(providerCredentials)
    .values({
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
  ai.generate
    .mockReset()
    .mockImplementation(async (input) => ({
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

  it("hides the plan and all hints in the posttest and rejects writes there", async () => {
    await act({ action: "build_speaking_outline" });
    await getDb()
      .update(studentSessions)
      .set({ currentStage: "posttest" })
      .where(eq(studentSessions.id, auth.id!));
    expect(
      (await current()).artifacts.some(
        (item) => item.type === "speaking_outline",
      ),
    ).toBe(false);
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
    auth.id = null;
    expect((await act({ action: "build_speaking_outline" })).status).toBe(401);
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
