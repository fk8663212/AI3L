import { describe, expect, it } from "vitest";
import type { ArtifactRow, MessageRow } from "@/lib/db/schema";
import {
  ADMIN_SESSION_PAGE_SIZE,
  adminSessionTotalPages,
  escapeLikeLiteral,
  normalizeAdminSessionPage,
} from "@/lib/domain/admin-sessions";
import {
  buildAdminSessionLearningRecord,
  type AdminSessionMeta,
} from "@/lib/services/admin-session-service";

const sessionId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-07-30T12:00:00.000Z");

const session: AdminSessionMeta = {
  id: sessionId,
  studentLabel: "Student 001",
  taskId: "22222222-2222-4222-8222-222222222222",
  taskTitle: "Speaking task",
  taskDescription: "A sufficiently descriptive task.",
  provider: "openai",
  modelId: "test-model",
  currentStage: "posttest",
  stageStatus: "active",
  stateVersion: 7,
  consentVersion: "1.0",
  consentedAt: now.toISOString(),
  startedAt: now.toISOString(),
  completedAt: null,
  lastSeenAt: now.toISOString(),
};

describe("admin session list helpers", () => {
  it("treats SQL wildcard characters as literal search text", () => {
    expect(escapeLikeLiteral("A%_\\B")).toBe("A\\%\\_\\\\B");
  });

  it("normalizes pages and calculates fixed-size pagination", () => {
    expect(normalizeAdminSessionPage(0)).toBe(1);
    expect(normalizeAdminSessionPage(3)).toBe(3);
    expect(adminSessionTotalPages(0)).toBe(0);
    expect(adminSessionTotalPages(ADMIN_SESSION_PAGE_SIZE + 1)).toBe(2);
  });
});

describe("admin learning record", () => {
  it("includes hidden messages and superseded artifacts without technical runs", () => {
    const messages: MessageRow[] = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        sessionId,
        stageId: "pretest",
        role: "assistant",
        kind: "text",
        content: { text: "Hidden research feedback" },
        idempotencyKey: null,
        hiddenUntilComplete: true,
        createdAt: now,
      },
    ];
    const artifacts: ArtifactRow[] = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        sessionId,
        stageId: "pretest",
        type: "transcript",
        status: "ready",
        data: { language: "en", text: "Hello", segments: [] },
        storageProvider: null,
        storageLocator: null,
        mimeType: null,
        sizeBytes: null,
        sha256: null,
        supersededAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        sessionId,
        stageId: "pretest",
        type: "audio",
        status: "ready",
        data: { durationSeconds: 12 },
        storageProvider: "google-drive",
        storageLocator: "drive-file-id",
        mimeType: "audio/webm",
        sizeBytes: 1024,
        sha256: null,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const record = buildAdminSessionLearningRecord(
      session,
      messages,
      artifacts,
    );
    const pretest = record.stages.find((stage) => stage.id === "pretest")!;

    expect(record.stages).toHaveLength(7);
    expect(pretest.messages[0].hiddenUntilComplete).toBe(true);
    expect(pretest.artifacts[0].supersededAt).toBe(now.toISOString());
    expect(pretest.artifacts[1].downloadUrl).toBe(
      `/api/admin/sessions/${sessionId}/artifacts/55555555-5555-4555-8555-555555555555`,
    );
    expect(record).not.toHaveProperty("aiRuns");
    expect(record).not.toHaveProperty("auditLogs");
  });
});
