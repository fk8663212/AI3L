import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { createTestDb } = await import("./test-db");
  const db = await createTestDb();
  return { getDb: () => db };
});

import { getDb } from "@/lib/db/client";
import { accessCodes, tasks } from "@/lib/db/schema";
import { accessCodeStatus } from "@/lib/domain/access-codes";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import { hashAccessCode } from "@/lib/security/crypto";
import {
  deleteUnusedAccessCodes,
  disableAllTaskCodes,
  generateAccessCodes,
  listAccessCodes,
  studentCodeActive,
  updateAccessCodes,
} from "@/lib/services/access-code-service";
import { startStudentSession } from "@/lib/services/session-service";

let taskId: string;

async function newTask() {
  const [task] = await getDb()
    .insert(tasks)
    .values({
      slug: `codes-${randomUUID()}`,
      title: "Code test task",
      description: "A task used by the access-code tests.",
      status: "published",
      provider: "google",
      modelId: "gemini-test",
      config: DEFAULT_TASK_CONFIG,
      publishedAt: new Date(),
    })
    .returning();
  return task.id;
}

const signIn = (code: string) => startStudentSession(hashAccessCode(code));
const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

beforeAll(() => {
  process.env.ACCESS_CODE_PEPPER = "flow-test-pepper-0123456789abcdef";
});

beforeEach(async () => {
  taskId = await newTask();
});

describe("accessCodeStatus", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  it("is active with no expiry, expired at or after the deadline, disabled first", () => {
    expect(accessCodeStatus({ disabledAt: null, expiresAt: null }, now)).toBe("active");
    expect(
      accessCodeStatus({ disabledAt: null, expiresAt: "2026-11-05T12:00:00Z" }, now),
    ).toBe("expired");
    expect(
      accessCodeStatus({ disabledAt: now, expiresAt: "2027-01-01T00:00:00Z" }, now),
    ).toBe("disabled");
  });
});

describe("generating codes", () => {
  it("stores the expiry and continues label numbering across batches", async () => {
    const expiresAt = inOneDay();
    await generateAccessCodes(taskId, 2);
    const second = await generateAccessCodes(taskId, 2, expiresAt);
    expect(second.map((item) => item.label)).toEqual(["Student 003", "Student 004"]);

    const listed = await listAccessCodes(taskId);
    expect(listed).toHaveLength(4);
    expect(listed.filter((item) => item.expiresAt === expiresAt.toISOString())).toHaveLength(2);
  });

  it("rejects an expiry in the past", async () => {
    await expect(
      generateAccessCodes(taskId, 1, new Date(Date.now() - 1000)),
    ).rejects.toMatchObject({ code: "EXPIRY_IN_PAST" });
  });
});

describe("code validity", () => {
  it("blocks sign-in and revokes an existing session when a code is disabled, and restores it on enable", async () => {
    const [{ code }] = await generateAccessCodes(taskId, 1);
    const session = await signIn(code);
    const [row] = await listAccessCodes(taskId);
    expect(await studentCodeActive(session.id)).toBe(true);

    await updateAccessCodes({ taskId, codeIds: [row.id], operation: "disable" });
    expect(await studentCodeActive(session.id)).toBe(false);
    await expect(signIn(code)).rejects.toMatchObject({ code: "INVALID_CODE" });

    await updateAccessCodes({ taskId, codeIds: [row.id], operation: "enable" });
    expect(await studentCodeActive(session.id)).toBe(true);
    // Same code resumes the same session.
    expect((await signIn(code)).id).toBe(session.id);
  });

  it("revokes access once a code expires", async () => {
    const [{ code }] = await generateAccessCodes(taskId, 1, inOneDay());
    const session = await signIn(code);
    await getDb()
      .update(accessCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accessCodes.taskId, taskId));
    expect(await studentCodeActive(session.id)).toBe(false);
    await expect(signIn(code)).rejects.toMatchObject({ code: "INVALID_CODE" });
  });

  it("sets or clears the expiry of selected codes only", async () => {
    await generateAccessCodes(taskId, 2);
    const [first, second] = await listAccessCodes(taskId);
    const expiresAt = inOneDay();
    await updateAccessCodes({
      taskId,
      codeIds: [first.id],
      operation: "set_expiry",
      expiresAt,
    });
    let listed = await listAccessCodes(taskId);
    expect(listed.find((item) => item.id === first.id)?.expiresAt).toBe(expiresAt.toISOString());
    expect(listed.find((item) => item.id === second.id)?.expiresAt).toBeNull();

    await updateAccessCodes({ taskId, codeIds: [first.id], operation: "set_expiry", expiresAt: null });
    listed = await listAccessCodes(taskId);
    expect(listed.every((item) => item.expiresAt === null)).toBe(true);
  });

  it("disables every code of the task at once", async () => {
    await generateAccessCodes(taskId, 3);
    expect(await disableAllTaskCodes(taskId)).toEqual({ updated: 3 });
    expect((await listAccessCodes(taskId)).every((item) => item.status === "disabled")).toBe(true);
  });

  it("does not touch codes of another task", async () => {
    await generateAccessCodes(taskId, 1);
    const otherTask = await newTask();
    await generateAccessCodes(otherTask, 1);
    const [other] = await listAccessCodes(otherTask);
    expect(
      await updateAccessCodes({ taskId, codeIds: [other.id], operation: "disable" }),
    ).toEqual({ updated: 0 });
    expect((await listAccessCodes(otherTask))[0].status).toBe("active");
  });
});

describe("deleting codes", () => {
  it("deletes unused codes and keeps codes a student has used", async () => {
    const generated = await generateAccessCodes(taskId, 3);
    await signIn(generated[0].code);
    const ids = (await listAccessCodes(taskId)).map((item) => item.id);

    expect(await deleteUnusedAccessCodes({ taskId, codeIds: ids })).toEqual({
      deleted: 2,
      skipped: 1,
    });
    const remaining = await listAccessCodes(taskId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].session).not.toBeNull();
  });

  it("deletes a single unused code", async () => {
    await generateAccessCodes(taskId, 2);
    const [first] = await listAccessCodes(taskId);
    expect(await deleteUnusedAccessCodes({ taskId, codeIds: [first.id] })).toEqual({
      deleted: 1,
      skipped: 0,
    });
    expect(await listAccessCodes(taskId)).toHaveLength(1);
  });
});
