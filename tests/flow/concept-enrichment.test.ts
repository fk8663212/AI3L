import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { createTestDb } = await import("./test-db");
  const db = await createTestDb();
  return { getDb: () => db };
});
const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/security/session", async original => ({
  ...await original<typeof import("@/lib/security/session")>(),
  getStudentClaims: async () => auth.id ? { role: "student", sessionId: auth.id } : null,
}));
const ai = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@/lib/ai/provider", async original => ({
  ...await original<typeof import("@/lib/ai/provider")>(), generateStructured: ai.generate,
}));
vi.mock("@/lib/storage/blob-store", async original => ({
  ...await original<typeof import("@/lib/storage/blob-store")>(),
  get: vi.fn(async () => {
    const { tinyPng } = await import("./fixtures");
    return { statusCode: 200, stream: new Blob([new Uint8Array(await tinyPng())]).stream(), blob: { contentType: "image/png" } };
  }),
}));

import { POST } from "@/app/api/student/actions/route";
import { getDb } from "@/lib/db/client";
import { accessCodes, artifacts, providerCredentials, studentSessions, tasks } from "@/lib/db/schema";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import { encryptSecret } from "@/lib/security/crypto";
import { getSessionView, recordConsent, replaceArtifactData, saveUploadedImage, startStudentSession } from "@/lib/services/session-service";
import { jiaoxiEnrichmentMap } from "../fixtures/knowledge-enrichment";

let mapImageId: string;
const description = "分享礁溪旅行的活動與地點；學生先畫出自己記得的內容，再篩選可能遺漏的體驗。";
const current = () => getSessionView(auth.id);
async function act(body: Record<string, unknown>) {
  const response = await POST(new Request("http://localhost/api/student/actions", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: response.status, ...await response.json() };
}
async function review(confirmedEnrichmentIds: string[] = []) {
  const sourceArtifactId = (await current()).artifacts.find(item => item.type === "generated_concept_map")!.id;
  return act({ action: "review_concepts", rejectedIds: [], confirmedEnrichmentIds, sourceArtifactId });
}

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = "knowledge-test-encryption-key-0123456789";
  const secret = encryptSecret("test-key");
  await getDb().insert(providerCredentials).values({ provider: "google", displayName: "Synthetic Gemini", encryptedKey: secret.encryptedValue, encryptionIv: secret.encryptionIv, encryptionTag: secret.encryptionTag, keyLastFour: "-key", verifiedAt: new Date() });
});
beforeEach(async () => {
  const config = structuredClone(DEFAULT_TASK_CONFIG);
  config.promptConfig.conceptExpansionTemplate = "老師自訂提示 {{task.title}}";
  const [task] = await getDb().insert(tasks).values({ slug: `knowledge-${randomUUID()}`, title: "礁溪旅遊", description, status: "published", provider: "google", modelId: "synthetic-test", config, publishedAt: new Date() }).returning();
  const hash = randomUUID();
  await getDb().insert(accessCodes).values({ taskId: task.id, codeHash: hash });
  auth.id = (await startStudentSession(hash)).id;
  await recordConsent(auth.id);
  await getDb().update(studentSessions).set({ currentStage: "self_concept_map" }).where(eq(studentSessions.id, auth.id));
  mapImageId = (await saveUploadedImage({ sessionId: auth.id, stageId: "self_concept_map", storageProvider: "vercel-blob", storageLocator: "https://blob.test/student-map.png", mimeType: "image/png", sizeBytes: 100 })).id;
  await getDb().insert(artifacts).values({ sessionId: auth.id, stageId: "image_analysis", type: "vocabulary_decisions", data: { pending: [], accepted: [{ id: "train", labelEn: "train", labelZh: "火車" }], rejected: [] } });
  await getDb().update(studentSessions).set({ currentStage: "ai_concept_map" }).where(eq(studentSessions.id, auth.id));
  ai.generate.mockReset().mockImplementation(async input => {
    if (input.schemaName === "concept_map") {
      const map = structuredClone(jiaoxiEnrichmentMap);
      map.nodes[2].enrichment!.confirmedByStudent = true;
      return { value: map };
    }
    const map = JSON.parse(input.prompt.split("已確認概念圖：\n")[1]);
    return { value: { sections: [{ id: "experience", titleZh: "這次的旅行", titleEn: "My trip", nodeIds: map.nodes.map((node: { id: string }) => node.id) }] } };
  });
});

describe("knowledge suggestions in the real concept workflow", () => {
  it("attaches the student's drawn map and accepted scene vocabulary, and sends the activity brief", async () => {
    expect((await act({ action: "run_ai", stage: "ai_concept_map" })).status).toBe(200);
    const input = ai.generate.mock.calls[0][0];
    expect(input.prompt).toContain(mapImageId);
    expect(input.prompt).toContain('"attached":true');
    expect(input.prompt).toContain("train");
    expect(input.prompt).toContain(description);
    expect(input.binary).toMatchObject({ mimeType: "image/png" });
    expect(input.schema.safeParse(jiaoxiEnrichmentMap).success).toBe(true);
    const generated = (await current()).artifacts.find(item => item.type === "generated_concept_map")!;
    expect(generated.data).toMatchObject({ enrichmentPolicy: "topic-knowledge-v1", enrichmentContext: { taskTitle: "礁溪旅遊", activityDescription: description } });
    expect((generated.data.nodes as typeof jiaoxiEnrichmentMap.nodes)[2].enrichment).not.toHaveProperty("confirmedByStudent");
  });

  it("does not promote omitted knowledge into later speaking prompts", async () => {
    await act({ action: "run_ai", stage: "ai_concept_map" });
    expect((await review()).status).toBe(200);
    const accepted = (await current()).artifacts.find(item => item.type === "concept_decisions")!.data.accepted as typeof jiaoxiEnrichmentMap;
    expect(accepted.nodes.map(node => node.id)).toEqual(["trip", "jiaoxi"]);
    expect((await act({ action: "build_speaking_outline" })).status).toBe(200);
    expect(ai.generate.mock.calls.at(-1)![0].prompt).not.toContain("hot spring bath");
  });

  it("retains explicitly chosen suggestions through edits and keeps review questions out of the posttest", async () => {
    await act({ action: "run_ai", stage: "ai_concept_map" });
    // A legacy alias must not replace the modern output the student is seeing.
    await getDb().insert(artifacts).values({ sessionId: auth.id, stageId: "ai_concept_map", type: "ai_concept_map", data: jiaoxiEnrichmentMap });
    expect((await review(["hot-spring", "possible-bath"])).status).toBe(200);
    const accepted = (await current()).artifacts.find(item => item.type === "concept_decisions")!.data.accepted as typeof jiaoxiEnrichmentMap;
    const edit = { nodes: accepted.nodes.map(node => ({ ...node, source: "student", labelEn: node.id === "hot-spring" ? "hot spring bathing" : node.labelEn })), edges: accepted.edges };
    expect((await act({ action: "save_concept_map", ...edit })).status).toBe(200);
    const saved = (await current()).artifacts.find(item => item.type === "concept_decisions")!.data.accepted as typeof jiaoxiEnrichmentMap;
    expect(saved.nodes[2]).toMatchObject({ source: "ai", edited: true, enrichment: { confirmedByStudent: true } });
    expect((await act({ action: "build_speaking_outline" })).status).toBe(200);
    await getDb().update(studentSessions).set({ currentStage: "posttest" }).where(eq(studentSessions.id, auth.id));
    const reference = (await current()).posttestReference!;
    expect(reference.map.nodes[2].labelEn).toBe("hot spring bathing");
    expect(reference.outline!.sections[0].nodeIds).toContain("hot-spring");
    expect(JSON.stringify(reference)).not.toContain("questionZh");
    expect(JSON.stringify(reference)).not.toContain("你這次有泡溫泉嗎");
  });

  it("rejects confirmation from a previous map even when a regenerated map reuses IDs", async () => {
    await act({ action: "run_ai", stage: "ai_concept_map" });
    const previous = (await current()).artifacts.find(item => item.type === "generated_concept_map")!;
    await replaceArtifactData({ sessionId: auth.id, stageId: "ai_concept_map", type: "generated_concept_map", data: jiaoxiEnrichmentMap });
    expect((await act({ action: "review_concepts", rejectedIds: [], confirmedEnrichmentIds: ["hot-spring", "possible-bath"], sourceArtifactId: previous.id })).error.code).toBe("CONCEPT_MAP_CHANGED");
    expect((await current()).artifacts.find(item => item.type === "concept_decisions")!.data.pending).toHaveLength(2);
  });
});
