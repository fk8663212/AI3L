import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Test doubles -----------------------------------------------------------
// Real code under test: route handler, session/AI/admin services, and SQL
// (PGlite with the real migrations). Faked: AI provider, Vercel Blob, and the
// student cookie.

vi.mock("@/lib/db/client", async () => {
  const { createTestDb } = await import("./test-db");
  const db = await createTestDb();
  return { getDb: () => db };
});

const claims = vi.hoisted(() => ({
  current: null as null | { sessionId: string },
}));
vi.mock("@/lib/security/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/session")>()),
  getStudentClaims: async () =>
    claims.current ? { role: "student", ...claims.current } : null,
}));

const ai = vi.hoisted(() => ({ generateStructured: vi.fn() }));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  generateStructured: ai.generateStructured,
}));

vi.mock("@vercel/blob", async () => {
  const { tinyPng } = await import("./fixtures");
  return {
    put: vi.fn(async (pathname: string) => ({
      url: `https://blob.test/${pathname}?v=${Math.random()}`,
      pathname,
    })),
    del: vi.fn(async () => undefined),
    head: vi.fn(),
    get: vi.fn(async () => ({
      statusCode: 200,
      stream: new Blob([new Uint8Array(await tinyPng())]).stream(),
      blob: { contentType: "image/png", etag: "test" },
    })),
  };
});

import { POST } from "@/app/api/student/actions/route";
import {
  invalidateImageAnalysisAfterSourceDeletion,
  precomputeImageAnalysisAfterUpload,
} from "@/lib/ai/provider-service";
import { getDb } from "@/lib/db/client";
import {
  accessCodes,
  artifacts,
  providerCredentials,
  tasks,
} from "@/lib/db/schema";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import type { StageId } from "@/lib/domain/stages";
import { encryptSecret } from "@/lib/security/crypto";
import { overrideSessionStage } from "@/lib/services/admin-service";
import {
  getSessionView,
  saveRecordingAudio,
  saveUploadedImage,
  startStudentSession,
} from "@/lib/services/session-service";
import {
  conceptMapOutput,
  imageAnalysisOutput,
  sentenceScaffoldOutput,
} from "./fixtures";

// ---- Helpers ----------------------------------------------------------------

function defaultAI() {
  ai.generateStructured.mockImplementation(
    async ({ schemaName }: { schemaName: string }) => ({
      value:
        schemaName === "image_analysis"
          ? imageAnalysisOutput()
          : schemaName === "concept_map"
            ? conceptMapOutput()
            : sentenceScaffoldOutput(),
      providerResponseId: "test-response",
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  );
}

function sessionId(): string {
  if (!claims.current) throw new Error("No student signed in.");
  return claims.current.sessionId;
}

async function newStudent(): Promise<string> {
  const db = getDb();
  const [task] = await db
    .insert(tasks)
    .values({
      slug: `flow-${randomUUID()}`,
      title: "Flow test task",
      description: "A task used by the stage-flow tests.",
      status: "published",
      provider: "google",
      modelId: "gemini-test",
      config: DEFAULT_TASK_CONFIG,
      publishedAt: new Date(),
    })
    .returning();
  const codeHash = randomUUID();
  await db.insert(accessCodes).values({ taskId: task.id, codeHash });
  const session = await startStudentSession(codeHash);
  claims.current = { sessionId: session.id };
  return session.id;
}

async function act(body: Record<string, unknown>) {
  const response = await POST(
    new Request("http://localhost/api/student/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const json = await response.json();
  return {
    status: response.status,
    code: json.error?.code as string | undefined,
    view: json.data as Awaited<ReturnType<typeof getSessionView>> | undefined,
  };
}

const view = () => getSessionView(sessionId());

async function complete() {
  const current = await view();
  return act({
    action: "complete_stage",
    stage: current.session.currentStage,
    stateVersion: current.session.stateVersion,
  });
}

async function expectStage(stage: StageId) {
  expect((await view()).session.currentStage).toBe(stage);
}

const addImage = (stage: "visualization" | "self_concept_map") =>
  saveUploadedImage({
    sessionId: sessionId(),
    stageId: stage,
    storageProvider: "vercel-blob",
    storageLocator: `https://blob.test/${stage}/${randomUUID()}`,
    mimeType: "image/png",
    sizeBytes: 100,
    data: {},
  });

const addAudio = (stage: StageId) =>
  saveRecordingAudio({
    sessionId: sessionId(),
    stageId: stage,
    audio: {
      storageLocator: `drive-${randomUUID()}`,
      mimeType: "audio/webm",
      sizeBytes: 100,
      data: { durationSeconds: 40 },
    },
  });

async function deleteImage(artifactId: string) {
  // Mirrors DELETE /api/student/uploads/image after the Blob delete succeeds.
  const now = new Date();
  await getDb()
    .update(artifacts)
    .set({ status: "deleted", supersededAt: now, updatedAt: now })
    .where(eq(artifacts.id, artifactId));
  await invalidateImageAnalysisAfterSourceDeletion(sessionId());
}

const labels = ["kite", "beach", "sun"];
const sentences = ["I fly a kite.", "The beach is big.", "I feel happy."];

async function activeStageArtifacts(stage: StageId) {
  return getDb().query.artifacts.findMany({
    where: and(
      eq(artifacts.sessionId, sessionId()),
      eq(artifacts.stageId, stage),
      isNull(artifacts.supersededAt),
    ),
  });
}

/** Drives a fresh student up to (but not into) the given stage. */
async function advanceTo(target: StageId) {
  await act({ action: "consent", accepted: true });
  const steps: Array<[StageId, () => Promise<unknown>]> = [
    ["pretest", () => addAudio("pretest")],
    [
      "visualization",
      async () => {
        const image = await addImage("visualization");
        await precomputeImageAnalysisAfterUpload({
          sessionId: sessionId(),
          sourceImageArtifactId: image.id,
        });
        await act({
          action: "save_labels",
          labels,
          idempotencyKey: randomUUID(),
        });
      },
    ],
    ["self_concept_map", () => addImage("self_concept_map")],
    [
      "image_analysis",
      async () => {
        const analysis = (await view()).artifacts.find(
          (item) => item.type === "image_analysis",
        );
        const suggestions = analysis?.data.suggestions as Array<{ id: string }>;
        await act({
          action: "review_vocabulary",
          decisions: suggestions.map((item) => ({
            id: item.id,
            status: "accepted",
          })),
        });
      },
    ],
    [
      "ai_concept_map",
      async () => {
        await act({ action: "run_ai", stage: "ai_concept_map" });
        await act({ action: "review_concepts", rejectedIds: [] });
      },
    ],
    [
      "sentence_scaffold",
      async () => {
        await act({
          action: "save_sentences",
          sentences,
          hintLevel: 0,
          idempotencyKey: randomUUID(),
        });
        await act({ action: "run_ai", stage: "sentence_scaffold" });
        await addAudio("sentence_scaffold");
      },
    ],
    ["posttest", () => addAudio("posttest")],
  ];
  for (const [stage, fulfil] of steps) {
    if (stage === target) return;
    await fulfil();
    const result = await complete();
    expect(result.status, `completing ${stage}: ${result.code}`).toBe(200);
  }
}

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = "flow-test-encryption-key-0123456789";
  await getDb()
    .insert(providerCredentials)
    .values({
      provider: "google",
      displayName: "Test Gemini",
      ...(({ encryptedValue, encryptionIv, encryptionTag }) => ({
        encryptedKey: encryptedValue,
        encryptionIv,
        encryptionTag,
      }))(encryptSecret("test-api-key")),
      keyLastFour: "-key",
      verifiedAt: new Date(),
    });
});

beforeEach(async () => {
  ai.generateStructured.mockReset();
  defaultAI();
  await newStudent();
});

// ---- Tests ------------------------------------------------------------------

describe("student stage flow", () => {
  it("walks all seven stages and marks the session complete", async () => {
    await advanceTo("posttest");
    await addAudio("posttest");
    expect((await complete()).status).toBe(200);
    const final = await view();
    expect(final.session.completed).toBe(true);
    expect(final.stages.every((stage) => stage.status === "completed")).toBe(
      true,
    );
  });

  it("requires consent before any other action", async () => {
    const result = await act({
      action: "save_labels",
      labels,
      idempotencyKey: randomUUID(),
    });
    expect(result.code).toBe("CONSENT_REQUIRED");
  });

  it("rejects completion when the gate is unmet, the stage is wrong, or the version is stale", async () => {
    await act({ action: "consent", accepted: true });
    expect((await complete()).code).toBe("GATE_NOT_MET");

    await addAudio("pretest");
    const current = await view();
    expect(
      (
        await act({
          action: "complete_stage",
          stage: "visualization",
          stateVersion: current.session.stateVersion,
        })
      ).code,
    ).toBe("STAGE_LOCKED");
    expect(
      (
        await act({
          action: "complete_stage",
          stage: "pretest",
          stateVersion: current.session.stateVersion + 5,
        })
      ).code,
    ).toBe("STALE_SESSION");
    await expectStage("pretest");
  });

  it("lets only one of two concurrent completions advance the stage", async () => {
    await act({ action: "consent", accepted: true });
    await addAudio("pretest");
    const current = await view();
    const body = {
      action: "complete_stage",
      stage: "pretest",
      stateVersion: current.session.stateVersion,
    };
    const results = await Promise.all([act(body), act(body)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    await expectStage("visualization");
  });

  it("refuses AI runs outside their stage", async () => {
    await act({ action: "consent", accepted: true });
    const result = await act({ action: "run_ai", stage: "ai_concept_map" });
    expect(result.code).toBe("STAGE_LOCKED");
    expect(ai.generateStructured).not.toHaveBeenCalled();
  });
});

describe("one recording and one image per stage", () => {
  it("rejects a second independent pretest recording", async () => {
    await act({ action: "consent", accepted: true });
    await addAudio("pretest");
    await expect(addAudio("pretest")).rejects.toMatchObject({
      code: "RECORDING_EXISTS",
    });
  });

  it("rejects a second drawing until the first is deleted", async () => {
    await advanceTo("visualization");
    const first = await addImage("visualization");
    await expect(addImage("visualization")).rejects.toMatchObject({
      code: "IMAGE_EXISTS",
    });
    await deleteImage(first.id);
    await expect(addImage("visualization")).resolves.toBeTruthy();
  });
});

describe("AI review stages", () => {
  it("re-opens concept review when the AI concept map is regenerated", async () => {
    await advanceTo("ai_concept_map");
    await act({ action: "run_ai", stage: "ai_concept_map" });
    await act({ action: "review_concepts", rejectedIds: [] });
    await act({ action: "run_ai", stage: "ai_concept_map" });

    const result = await complete();
    expect(result.code).toBe("GATE_NOT_MET");
    await expectStage("ai_concept_map");
  });

  it("requires three saved sentences before generating sentence scaffolds", async () => {
    await advanceTo("sentence_scaffold");
    const result = await act({ action: "run_ai", stage: "sentence_scaffold" });
    expect(result.code).toBe("SENTENCES_REQUIRED");
    expect(ai.generateStructured).not.toHaveBeenCalledWith(
      expect.objectContaining({ schemaName: "sentence_scaffold" }),
    );
  });

  it("discards a slow analysis of a drawing that was replaced meanwhile", async () => {
    await advanceTo("visualization");
    let releaseFirst!: () => void;
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    ai.generateStructured.mockImplementationOnce(async () => {
      await firstRunGate;
      return { value: imageAnalysisOutput(), providerResponseId: "slow" };
    });

    const first = await addImage("visualization");
    const slowRun = precomputeImageAnalysisAfterUpload({
      sessionId: sessionId(),
      sourceImageArtifactId: first.id,
    });
    await vi.waitFor(() =>
      expect(ai.generateStructured).toHaveBeenCalledTimes(1),
    );

    await deleteImage(first.id);
    const second = await addImage("visualization");
    await precomputeImageAnalysisAfterUpload({
      sessionId: sessionId(),
      sourceImageArtifactId: second.id,
    });
    releaseFirst();
    await slowRun;

    const outputs = await activeStageArtifacts("image_analysis");
    const byType = (type: string) => outputs.filter((row) => row.type === type);
    expect(byType("image_analysis")).toHaveLength(1);
    expect(byType("annotated_image")).toHaveLength(1);
    expect(byType("vocabulary_decisions")).toHaveLength(1);
    expect(byType("annotated_image")[0].data.sourceImageArtifactId).toBe(
      second.id,
    );
    const suggestionIds = (
      byType("image_analysis")[0].data.suggestions as Array<{ id: string }>
    ).map((item) => item.id);
    expect(byType("vocabulary_decisions")[0].data.pending).toEqual(
      suggestionIds,
    );
  });
});

describe("admin stage override", () => {
  it("sending a student back makes them redo that stage", async () => {
    await advanceTo("self_concept_map");
    await overrideSessionStage({
      sessionId: sessionId(),
      stageId: "pretest",
      reason: "學生需要重新錄製前測",
    });

    await expectStage("pretest");
    expect(await activeStageArtifacts("pretest")).toHaveLength(0);
    expect((await complete()).code).toBe("GATE_NOT_MET");
    // The recorder must be usable again.
    await expect(addAudio("pretest")).resolves.toBeTruthy();
    // Later-stage work built on the old attempt is cleared as well.
    expect(await activeStageArtifacts("visualization")).toHaveLength(0);
    expect(await activeStageArtifacts("image_analysis")).toHaveLength(0);
  });

  it("skipping forward keeps the work already done", async () => {
    await advanceTo("visualization");
    await overrideSessionStage({
      sessionId: sessionId(),
      stageId: "self_concept_map",
      reason: "學生的手繪圖已由教師另外收取",
    });
    await expectStage("self_concept_map");
    expect(
      (await activeStageArtifacts("pretest")).filter(
        (row) => row.type === "audio",
      ),
    ).toHaveLength(1);
  });
});

describe("posttest concealment", () => {
  it("returns only posttest data until the posttest is submitted", async () => {
    await advanceTo("posttest");
    const during = await view();
    expect(during.concealPriorStages).toBe(true);
    expect(during.artifacts.every((item) => item.stageId === "posttest")).toBe(
      true,
    );
    expect(during.messages.every((item) => item.stageId === "posttest")).toBe(
      true,
    );

    await addAudio("posttest");
    await complete();
    const after = await view();
    expect(after.artifacts.some((item) => item.stageId === "sentence_scaffold")).toBe(
      true,
    );
  });
});
