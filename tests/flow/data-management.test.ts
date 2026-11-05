import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { createTestDb } = await import("./test-db");
  const db = await createTestDb();
  return { getDb: () => db };
});

const drive = vi.hoisted(() => ({
  deleteDriveFile: vi.fn(async () => undefined),
  getDriveFileStream: vi.fn(async () => ({
    stream: new Blob([new Uint8Array([1, 2, 3])]).stream(),
    name: "pretest.webm",
    mimeType: "audio/webm",
    size: "3",
  })),
}));
vi.mock("@/lib/storage/google-drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/google-drive")>()),
  ...drive,
}));

const voice = vi.hoisted(() => ({ analyzeRecording: vi.fn() }));
vi.mock("@/lib/ai/voice-service", () => voice);

const blob = vi.hoisted(() => ({
  list: vi.fn(async () => ({ blobs: [] as Array<{ url: string }>, hasMore: false })),
  del: vi.fn(async () => undefined),
}));
vi.mock("@vercel/blob", () => ({ ...blob, put: vi.fn(), get: vi.fn(), head: vi.fn() }));

import { POST as studentLogout } from "@/app/api/student/logout/route";
import { getDb } from "@/lib/db/client";
import {
  artifacts,
  auditLogs,
  messages,
  studentSessions,
  tasks,
} from "@/lib/db/schema";
import { selectOrphanBlobs } from "@/lib/domain/blob-cleanup";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import {
  measuresFrom,
  prePostCsv,
  summarizePrePost,
  type PrePostRow,
} from "@/lib/domain/pre-post-report";
import { withRecordingAnalysisStatus } from "@/lib/domain/recordings";
import { hashAccessCode } from "@/lib/security/crypto";
import { generateAccessCodes, studentCodeActive } from "@/lib/services/access-code-service";
import { archiveTask, restoreTask } from "@/lib/services/admin-service";
import {
  deleteParticipantData,
  listRetentionExpiredSessions,
  purgeRetentionExpired,
} from "@/lib/services/participant-data-service";
import {
  listRecordingAnalysisIssues,
  retryRecordingAnalysis,
} from "@/lib/services/recording-service";
import { listAuditLogs, prePostReport } from "@/lib/services/report-service";
import { getSessionView, startStudentSession } from "@/lib/services/session-service";

const DAY = 86_400_000;

async function newTask(config = DEFAULT_TASK_CONFIG) {
  const [task] = await getDb()
    .insert(tasks)
    .values({
      slug: `data-${randomUUID()}`,
      title: "Data task",
      description: "A task used by the data-management tests.",
      status: "published",
      provider: "google",
      modelId: "gemini-test",
      config,
      publishedAt: new Date(),
    })
    .returning();
  return task.id;
}

async function newSession(taskId: string) {
  const [{ code, label }] = await generateAccessCodes(taskId, 1);
  const session = await startStudentSession(hashAccessCode(code));
  return { sessionId: session.id, code, label };
}

async function addArtifact(
  sessionId: string,
  values: Partial<typeof artifacts.$inferInsert> & { stageId: typeof artifacts.$inferInsert.stageId; type: string },
) {
  const [row] = await getDb()
    .insert(artifacts)
    .values({ sessionId, status: "ready", data: {}, ...values })
    .returning();
  return row;
}

beforeAll(() => {
  process.env.ACCESS_CODE_PEPPER = "flow-test-pepper-0123456789abcdef";
});

let taskId: string;
beforeEach(async () => {
  vi.clearAllMocks();
  taskId = await newTask();
});

describe("student sign-out", () => {
  it("clears the student cookie", async () => {
    const response = await studentLogout(
      new Request("http://localhost/api/student/logout", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/ai3l_student=;.*Max-Age=0/u);
  });

  it("shows the student label in the session view", async () => {
    const { sessionId, label } = await newSession(taskId);
    expect((await getSessionView(sessionId)).session.studentLabel).toBe(label);
  });
});

describe("recording analysis retry", () => {
  it("lists failed and stalled analyses but not ones still running", async () => {
    const { sessionId } = await newSession(taskId);
    const failed = await addArtifact(sessionId, {
      stageId: "pretest",
      type: "audio",
      storageProvider: "google-drive",
      storageLocator: "drive-failed",
      data: withRecordingAnalysisStatus({}, "failed", new Date()),
    });
    const stalled = await addArtifact(sessionId, {
      stageId: "posttest",
      type: "audio",
      storageProvider: "google-drive",
      storageLocator: "drive-stalled",
      data: withRecordingAnalysisStatus({}, "pending", new Date(Date.now() - 30 * 60_000)),
    });
    await addArtifact(sessionId, {
      stageId: "sentence_scaffold",
      type: "audio",
      storageProvider: "google-drive",
      storageLocator: "drive-running",
      data: withRecordingAnalysisStatus({}, "pending", new Date()),
    });

    const issues = (await listRecordingAnalysisIssues()).filter(
      (item) => item.sessionId === sessionId,
    );
    expect(Object.fromEntries(issues.map((item) => [item.audioArtifactId, item.status]))).toEqual({
      [failed.id]: "failed",
      [stalled.id]: "stalled",
    });
  });

  it("re-reads the audio from Drive and saves the analysis", async () => {
    const { sessionId } = await newSession(taskId);
    const audio = await addArtifact(sessionId, {
      stageId: "pretest",
      type: "audio",
      storageProvider: "google-drive",
      storageLocator: "drive-file",
      mimeType: "audio/webm",
      data: withRecordingAnalysisStatus({ durationSeconds: 42 }, "failed", new Date()),
    });
    voice.analyzeRecording.mockResolvedValueOnce({
      transcript: { language: "en", text: "I fly a kite", segments: [] },
      evaluation: { wordsPerMinute: 60, contentUnits: 3, pauseCount: 1 },
    });

    expect(await retryRecordingAnalysis(audio.id)).toEqual({ status: "ready" });
    expect(drive.getDriveFileStream).toHaveBeenCalledWith("drive-file");
    expect(voice.analyzeRecording).toHaveBeenCalledWith(
      expect.objectContaining({ audioArtifactId: audio.id, durationSeconds: 42 }),
    );
    const saved = await getDb().query.artifacts.findMany({
      where: eq(artifacts.sessionId, sessionId),
    });
    expect(saved.find((row) => row.id === audio.id)?.data.analysisStatus).toBe("ready");
    expect(saved.some((row) => row.type === "transcript")).toBe(true);
  });

  it("marks the recording failed again when the retry fails", async () => {
    const { sessionId } = await newSession(taskId);
    const audio = await addArtifact(sessionId, {
      stageId: "pretest",
      type: "audio",
      storageProvider: "google-drive",
      storageLocator: "drive-file",
      data: withRecordingAnalysisStatus({}, "failed", new Date()),
    });
    voice.analyzeRecording.mockRejectedValueOnce(new Error("provider down"));
    await expect(retryRecordingAnalysis(audio.id)).rejects.toMatchObject({
      code: "ANALYSIS_RETRY_FAILED",
    });
    const row = await getDb().query.artifacts.findFirst({ where: eq(artifacts.id, audio.id) });
    expect(row?.data.analysisStatus).toBe("failed");
  });
});

describe("participant data deletion", () => {
  it("deletes files, rows and disables the code", async () => {
    const { sessionId, code } = await newSession(taskId);
    await addArtifact(sessionId, {
      stageId: "pretest",
      type: "audio",
      storageProvider: "google-drive",
      storageLocator: "drive-audio",
    });
    await addArtifact(sessionId, {
      stageId: "visualization",
      type: "image",
      storageProvider: "vercel-blob",
      storageLocator: "https://blob.test/drawing.webp",
      supersededAt: new Date(),
    });
    await getDb().insert(messages).values({
      sessionId,
      stageId: "pretest",
      role: "student",
      content: { text: "hi" },
    });
    blob.list.mockResolvedValueOnce({
      blobs: [{ url: "https://blob.test/staging.webm" }],
      hasMore: false,
    });

    const result = await deleteParticipantData({ sessionId, reason: "admin_request" });
    expect(result).toMatchObject({ driveFilesDeleted: 1, blobsDeleted: 2, artifactRowsDeleted: 2 });
    expect(drive.deleteDriveFile).toHaveBeenCalledWith("drive-audio");
    expect(blob.del).toHaveBeenCalledWith(
      expect.arrayContaining(["https://blob.test/drawing.webp", "https://blob.test/staging.webm"]),
    );

    const db = getDb();
    expect(await db.query.studentSessions.findFirst({ where: eq(studentSessions.id, sessionId) })).toBeUndefined();
    expect(await db.query.artifacts.findMany({ where: eq(artifacts.sessionId, sessionId) })).toHaveLength(0);
    expect(await db.query.messages.findMany({ where: eq(messages.sessionId, sessionId) })).toHaveLength(0);
    // The code cannot start a fresh session.
    await expect(startStudentSession(hashAccessCode(code))).rejects.toMatchObject({
      code: "INVALID_CODE",
    });
    const logs = await db.query.auditLogs.findMany({ where: eq(auditLogs.action, "session.data_deleted") });
    expect(logs.some((log) => log.detail.sessionId === sessionId)).toBe(true);
  });

  it("keeps every row when a Drive file cannot be deleted", async () => {
    const { sessionId } = await newSession(taskId);
    await addArtifact(sessionId, {
      stageId: "pretest",
      type: "audio",
      storageProvider: "google-drive",
      storageLocator: "drive-audio",
    });
    drive.deleteDriveFile.mockRejectedValueOnce(new Error("drive offline"));
    await expect(
      deleteParticipantData({ sessionId, reason: "admin_request" }),
    ).rejects.toMatchObject({ code: "PARTICIPANT_FILES_NOT_DELETED" });
    expect(
      await getDb().query.artifacts.findMany({ where: eq(artifacts.sessionId, sessionId) }),
    ).toHaveLength(1);
  });
});

describe("retention", () => {
  async function backdate(sessionId: string, completedDaysAgo: number) {
    await getDb()
      .update(studentSessions)
      .set({ completedAt: new Date(Date.now() - completedDaysAgo * DAY) })
      .where(eq(studentSessions.id, sessionId));
  }

  it("lists sessions past their task's retention and purges only those", async () => {
    const old = await newSession(taskId);
    const recent = await newSession(taskId);
    await backdate(old.sessionId, 200);
    await backdate(recent.sessionId, 10);
    const shortTask = await newTask({ ...DEFAULT_TASK_CONFIG, retentionDays: 7 });
    const short = await newSession(shortTask);
    await backdate(short.sessionId, 10);

    const expired = (await listRetentionExpiredSessions()).map((row) => row.sessionId);
    expect(expired).toEqual(expect.arrayContaining([old.sessionId, short.sessionId]));
    expect(expired).not.toContain(recent.sessionId);

    const result = await purgeRetentionExpired([old.sessionId, recent.sessionId]);
    expect(result).toEqual({ deleted: 1, failed: [] });
    expect(
      await getDb().query.studentSessions.findFirst({ where: eq(studentSessions.id, recent.sessionId) }),
    ).toBeTruthy();
  });
});

describe("task archive", () => {
  it("stops sign-in and current sessions, and restore brings them back", async () => {
    const { sessionId, code } = await newSession(taskId);
    await archiveTask(taskId);
    expect(await studentCodeActive(sessionId)).toBe(false);
    await expect(startStudentSession(hashAccessCode(code))).rejects.toMatchObject({
      code: "INVALID_CODE",
    });
    await expect(archiveTask(taskId)).rejects.toMatchObject({ code: "TASK_NOT_PUBLISHED" });

    await restoreTask(taskId);
    expect(await studentCodeActive(sessionId)).toBe(true);
  });
});

describe("pre/post report", () => {
  it("pairs pre- and posttest measures per student", async () => {
    const a = await newSession(taskId);
    const b = await newSession(taskId);
    for (const [session, pre, post] of [
      [a, 40, 70],
      [b, 60, 80],
    ] as const) {
      await addArtifact(session.sessionId, { stageId: "pretest", type: "speech_evaluation", data: { wordsPerMinute: pre, contentUnits: 2, pauseCount: 3 } });
      await addArtifact(session.sessionId, { stageId: "posttest", type: "speech_evaluation", data: { wordsPerMinute: post, contentUnits: 4, pauseCount: 1 } });
      await addArtifact(session.sessionId, { stageId: "pretest", type: "transcript", data: { text: "one two three" } });
    }
    const report = await prePostReport(taskId);
    expect(report.rows).toHaveLength(2);
    expect(report.summary.wordsPerMinute).toEqual({ pairs: 2, preMean: 50, postMean: 75, meanChange: 25 });
    expect(report.summary.wordCount.pairs).toBe(0); // no posttest transcript
    expect(report.rows[0].pre.wordCount).toBe(3);
  });

  it("builds CSV with escaping and formula protection", () => {
    const empty = measuresFrom({});
    const rows: PrePostRow[] = [
      {
        sessionId: "s1",
        studentLabel: '=HYPERLINK("x")',
        completed: true,
        currentStage: "posttest",
        pre: { ...empty, wordsPerMinute: 40 },
        post: { ...empty, wordsPerMinute: 55.5 },
      },
    ];
    const [header, line] = prePostCsv(rows).split("\r\n");
    expect(header.startsWith("student_label,session_id,completed")).toBe(true);
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain("40,55.5,15.5");
    expect(summarizePrePost(rows).wordsPerMinute.meanChange).toBe(15.5);
  });
});

describe("audit log", () => {
  it("pages newest first and filters by action", async () => {
    await getDb().insert(auditLogs).values(
      Array.from({ length: 3 }, (_, index) => ({
        actor: "admin",
        action: "test.audit_filter",
        targetType: "task",
        targetId: taskId,
        detail: { index },
      })),
    );
    const filtered = await listAuditLogs({ action: "test.audit_filter" });
    expect(filtered.pagination.total).toBe(3);
    expect(filtered.actions).toContain("test.audit_filter");
    expect(filtered.items.every((item) => item.action === "test.audit_filter")).toBe(true);
  });
});

describe("orphan blob cleanup", () => {
  it("deletes only old, unreferenced blobs", () => {
    const now = new Date("2026-11-05T00:00:00Z");
    const old = new Date(now.getTime() - 2 * DAY);
    const fresh = new Date(now.getTime() - 60_000);
    const blobs = [
      { url: "https://b/kept", uploadedAt: old },
      { url: "https://b/orphan", uploadedAt: old },
      { url: "https://b/fresh", uploadedAt: fresh },
    ];
    expect(
      selectOrphanBlobs(blobs, new Set(["https://b/kept"]), now).map((item) => item.url),
    ).toEqual(["https://b/orphan"]);
  });
});
