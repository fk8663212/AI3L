import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { createTestDb } = await import("./test-db");
  const db = await createTestDb();
  return { getDb: () => db };
});

import { getDb } from "@/lib/db/client";
import { artifacts, studentSessions, tasks } from "@/lib/db/schema";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import { withRecordingAnalysisStatus } from "@/lib/domain/recordings";
import { hashAccessCode } from "@/lib/security/crypto";
import { generateAccessCodes } from "@/lib/services/access-code-service";
import { adminOverview, bootstrapDefaults } from "@/lib/services/admin-service";
import { startStudentSession } from "@/lib/services/session-service";

beforeAll(() => {
  process.env.ACCESS_CODE_PEPPER = "overview-test-pepper-0123456789abcdef";
  process.env.APP_ENCRYPTION_KEY = "overview-test-encryption-key-012345";
});

describe("admin overview", () => {
  it("renders on an empty database", async () => {
    await bootstrapDefaults();
    const overview = await adminOverview();
    expect(overview.attention).toEqual({ recordingIssues: 0, retentionExpired: 0 });
    expect(overview.progress.completed).toBe(0);
    expect(overview.models.length).toBeGreaterThan(0);
  });

  it("counts students per stage, analyses needing attention and expired sessions", async () => {
    const [task] = await getDb()
      .insert(tasks)
      .values({
        slug: `overview-${randomUUID()}`,
        title: "Overview task",
        description: "A task used by the overview test.",
        status: "published",
        provider: "google",
        modelId: "gemini-3.6-flash",
        config: DEFAULT_TASK_CONFIG,
        publishedAt: new Date(),
      })
      .returning();
    const codes = await generateAccessCodes(task.id, 2);
    const first = await startStudentSession(hashAccessCode(codes[0].code));
    const second = await startStudentSession(hashAccessCode(codes[1].code));

    await getDb().insert(artifacts).values({
      sessionId: first.id,
      stageId: "pretest",
      type: "audio",
      status: "ready",
      storageProvider: "google-drive",
      storageLocator: "drive-id",
      data: withRecordingAnalysisStatus({}, "failed", new Date()),
    });
    await getDb()
      .update(studentSessions)
      .set({ currentStage: "posttest", completedAt: new Date(Date.now() - 400 * 86_400_000) })
      .where(eq(studentSessions.id, second.id));

    const overview = await adminOverview();
    expect(overview.attention).toEqual({ recordingIssues: 1, retentionExpired: 1 });
    expect(overview.progress.stageCounts.pretest).toBe(1);
    expect(overview.progress.completed).toBe(1);
    expect(overview.accessCodeCount).toBe(2);
  });
});
