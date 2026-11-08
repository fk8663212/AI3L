import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { createTestDb } = await import("./test-db");
  const db = await createTestDb();
  return { getDb: () => db };
});
const login = vi.hoisted(() => ({ sessionId: null as string | null, admin: false }));
vi.mock("@/lib/security/session", async (original) => ({
  ...await original<typeof import("@/lib/security/session")>(),
  getStudentClaims: async () => login.sessionId ? { role: "student", sessionId: login.sessionId } : null,
  getAdminClaims: async () => login.admin ? { role: "admin" } : null,
}));
const background = vi.hoisted(() => ({ jobs: [] as Promise<unknown>[] }));
vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(),
  after: (task: () => unknown) => background.jobs.push(Promise.resolve().then(task)),
}));
const analysis = vi.hoisted(() => ({
  transcribe: vi.fn(async () => ({ value: { language: "en", text: "Hello market", segments: [] } })),
  evaluate: vi.fn(async () => ({ value: { contentUnits: 1, pauseCount: 0, vocabularyHighlights: ["market"], organizationFeedbackZh: "有主要事件", nextStepZh: "加入細節" } })),
}));
vi.mock("@/lib/ai/provider", async (original) => ({
  ...await original<typeof import("@/lib/ai/provider")>(),
  transcribeAudio: analysis.transcribe,
  generateStructured: analysis.evaluate,
}));
const cloud = vi.hoisted(() => ({ call: vi.fn(() => { throw new Error("Local flow must not use cloud storage"); }) }));
vi.mock("@vercel/blob", () => ({ get: cloud.call, put: cloud.call, del: cloud.call, head: cloud.call, list: cloud.call }));

import { POST as upload } from "@/app/api/student/uploads/local/route";
import { POST as finalize } from "@/app/api/student/uploads/finalize/route";
import { POST as uploadImage, DELETE as deleteImage } from "@/app/api/student/uploads/image/route";
import { GET as studentDownload } from "@/app/api/student/artifacts/[id]/route";
import { GET as adminDownload } from "@/app/api/admin/sessions/[sessionId]/artifacts/[artifactId]/route";
import { getDb } from "@/lib/db/client";
import { accessCodes, artifacts, providerCredentials, studentSessions, tasks } from "@/lib/db/schema";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import { recordConsent, startStudentSession } from "@/lib/services/session-service";
import { deleteParticipantData } from "@/lib/services/participant-data-service";
import { listRecordingAnalysisIssues, retryRecordingAnalysis } from "@/lib/services/recording-service";
import { get, list } from "@/lib/storage/blob-store";
import { encryptSecret } from "@/lib/security/crypto";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "ai3l-local-flow-"));
  vi.stubEnv("APP_ENCRYPTION_KEY", "local-flow-test-encryption-0123456789");
  const encrypted = encryptSecret("local-test-key");
  await getDb().insert(providerCredentials).values({
    provider: "google", displayName: "Test provider", encryptedKey: encrypted.encryptedValue,
    encryptionIv: encrypted.encryptionIv, encryptionTag: encrypted.encryptionTag,
    keyLastFour: "-key", verifiedAt: new Date(),
  });
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
beforeEach(() => {
  vi.stubEnv("STORAGE_DRIVER", "local"); vi.stubEnv("LOCAL_STORAGE_PATH", directory);
  login.sessionId = null; login.admin = false; cloud.call.mockClear();
  analysis.transcribe.mockClear(); analysis.evaluate.mockClear();
});

async function student(consent = true) {
  const [task] = await getDb().insert(tasks).values({ slug: "local-" + randomUUID(), title: "Local task", description: "Local integration", status: "published", provider: "google", modelId: "test", config: DEFAULT_TASK_CONFIG, publishedAt: new Date() }).returning();
  const hash = randomUUID();
  await getDb().insert(accessCodes).values({ taskId: task.id, codeHash: hash });
  const session = await startStudentSession(hash);
  login.sessionId = session.id;
  if (consent) await recordConsent(session.id);
  return session.id;
}
function audioRequest(sessionId: string, stage = "pretest", pathname?: string) {
  const form = new FormData();
  form.set("kind", "audio"); form.set("stage", stage);
  form.set("pathname", pathname ?? `student/${sessionId}/${stage}/recording.wav`);
  form.set("file", new File(["local recording"], "recording.wav", { type: "audio/wav" }));
  return new Request("http://localhost/api/student/uploads/local", { method: "POST", body: form });
}
async function finish(url: string, voice?: { voicedSeconds: number; peakLevel: number }) {
  const response = await finalize(new Request("http://localhost/api/student/uploads/finalize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "audio", stage: "pretest", url, durationSeconds: 35, ...(voice ? { voice } : {}) }) }));
  await Promise.all(background.jobs.splice(0));
  return response;
}

describe("real local file lifecycle with the real stage services", () => {
  it("retains silence measurements for local uploads and admin retries without calling speech AI", async () => {
    const id = await student();
    const uploaded = await upload(audioRequest(id));
    const { data } = await uploaded.json();
    const voice = { voicedSeconds: 0.3, peakLevel: 0.004 };
    expect((await finish(data.url, voice)).status).toBe(200);
    const audio = (await getDb().query.artifacts.findMany({ where: eq(artifacts.sessionId, id) })).find(row => row.type === "audio")!;
    expect(audio.data.voice).toEqual(voice);
    expect(audio.data.stagingUrl).toBe(data.url);
    expect(analysis.transcribe).not.toHaveBeenCalled();
    expect(analysis.evaluate).not.toHaveBeenCalled();
    await getDb().update(artifacts).set({ data: { ...audio.data, analysisStatus: "failed" } }).where(eq(artifacts.id, audio.id));
    expect(await retryRecordingAnalysis(audio.id)).toEqual({ status: "ready" });
    expect(analysis.transcribe).not.toHaveBeenCalled();
    expect(analysis.evaluate).not.toHaveBeenCalled();
    expect(cloud.call).not.toHaveBeenCalled();
  });

  it("enforces sign-in, consent, stage and ownership before storing a file", async () => {
    const id = await student(false);
    login.sessionId = null;
    expect((await upload(audioRequest(id))).status).toBe(401);
    login.sessionId = id;
    expect((await upload(audioRequest(id))).status).toBe(409);
    await recordConsent(id);
    expect((await upload(audioRequest(id, "posttest"))).status).toBe(409);
    expect((await upload(audioRequest(id, "pretest", `student/${randomUUID()}/pretest/x.wav`))).status).toBe(400);
    expect((await upload(audioRequest(id, "pretest", `student/${id}/pretest/../x.wav`))).status).toBe(400);
    expect((await list({ prefix: `student/${id}/` })).blobs).toHaveLength(0);
  });

  it("saves, reads, retries analysis and deletes recordings without Blob or Drive", async () => {
    const id = await student();
    const uploaded = await upload(audioRequest(id));
    expect(uploaded.status).toBe(200);
    const { data } = await uploaded.json();
    expect((await finish(data.url)).status).toBe(200);
    // A retry after the staging file was removed returns the saved session.
    expect((await finish(data.url)).status).toBe(200);
    const audio = (await getDb().query.artifacts.findMany({ where: eq(artifacts.sessionId, id) })).find((row) => row.type === "audio")!;
    expect(audio.storageProvider).toBe("local");
    expect(audio.storageLocator).not.toBe(data.url);
    const saved = await get(audio.storageLocator!, { access: "private" });
    expect(await new Response(saved!.stream).text()).toBe("local recording");
    const request = new Request("http://localhost/api");
    const visible = await studentDownload(request, { params: Promise.resolve({ id: audio.id }) });
    expect(visible.status).toBe(200); expect(await visible.text()).toBe("local recording");
    login.sessionId = randomUUID();
    expect((await studentDownload(request, { params: Promise.resolve({ id: audio.id }) })).status).toBe(404);
    login.admin = false;
    const context = { params: Promise.resolve({ sessionId: id, artifactId: audio.id }) };
    expect((await adminDownload(request, context)).status).toBe(401);
    login.admin = true;
    expect((await adminDownload(request, context)).status).toBe(200);
    login.sessionId = id;
    await getDb().update(artifacts).set({ data: { ...audio.data, analysisStatus: "failed" } }).where(eq(artifacts.id, audio.id));
    expect((await listRecordingAnalysisIssues()).some((row) => row.audioArtifactId === audio.id)).toBe(true);
    // An admin can retry saved local audio even after the student moved on.
    await getDb().update(studentSessions).set({ currentStage: "posttest" }).where(eq(studentSessions.id, id));
    expect(await retryRecordingAnalysis(audio.id)).toEqual({ status: "ready" });
    expect(analysis.transcribe).toHaveBeenCalledTimes(2);
    expect((await studentDownload(request, { params: Promise.resolve({ id: audio.id }) })).status).toBe(404);
    await deleteParticipantData({ sessionId: id, reason: "admin_request" });
    expect((await list({ prefix: `student/${id}/` })).blobs).toHaveLength(0);
    expect(cloud.call).not.toHaveBeenCalled();
  });

  it("stores drawings through the server fallback and serves them privately", async () => {
    const id = await student();
    await getDb().update(studentSessions).set({ currentStage: "visualization" }).where(eq(studentSessions.id, id));
    const form = new FormData(); form.set("stage", "visualization");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "drawing.webp", { type: "image/webp" }));
    expect((await uploadImage(new Request("http://localhost/api", { method: "POST", body: form }))).status).toBe(200);
    const image = (await getDb().query.artifacts.findMany({ where: eq(artifacts.sessionId, id) })).find((row) => row.type === "image")!;
    expect(image.storageProvider).toBe("local");
    const response = await studentDownload(new Request("http://localhost/api"), { params: Promise.resolve({ id: image.id }) });
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await deleteImage(new Request("http://localhost/api", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ artifactId: image.id }) }))).status).toBe(200);
    expect((await list({ prefix: `student/${id}/` })).blobs).toHaveLength(0);
    expect((await uploadImage(new Request("http://localhost/api", { method: "POST", body: form }))).status).toBe(200);
    await deleteParticipantData({ sessionId: id, reason: "admin_request" });
    expect((await list({ prefix: `student/${id}/` })).blobs).toHaveLength(0);
    expect(cloud.call).not.toHaveBeenCalled();
  });
});
