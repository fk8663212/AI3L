import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, notExists } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  accessCodes,
  auditLogs,
  studentSessions,
  tasks,
} from "@/lib/db/schema";
import { accessCodeStatus, type AccessCodeStatus } from "@/lib/domain/access-codes";
import type { StageId } from "@/lib/domain/stages";
import { hashAccessCode } from "@/lib/security/crypto";
import { ApiError } from "@/lib/security/request";

export type AccessCodeListItem = {
  id: string;
  label: string | null;
  status: AccessCodeStatus;
  expiresAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  session: {
    id: string;
    currentStage: StageId;
    completed: boolean;
  } | null;
};

function newAccessCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `AI3L-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

function assertFuture(expiresAt: Date | null) {
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new ApiError(400, "EXPIRY_IN_PAST", "有效期限必須晚於現在。");
  }
}

async function audit(action: string, targetId: string, detail: Record<string, unknown>) {
  await getDb().insert(auditLogs).values({
    actor: "admin",
    action,
    targetType: "task",
    targetId,
    detail,
  });
}

export async function generateAccessCodes(
  taskId: string,
  count: number,
  expiresAt: Date | null = null,
): Promise<Array<{ code: string; label: string }>> {
  const db = getDb();
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task || task.status !== "published") {
    throw new ApiError(409, "TASK_NOT_PUBLISHED", "只能為已發布任務建立代碼。");
  }
  assertFuture(expiresAt);

  // Continue after the highest existing "Student NNN" label. Counting rows
  // would reuse a label once codes have been deleted.
  const labels = await db
    .select({ label: accessCodes.label })
    .from(accessCodes)
    .where(eq(accessCodes.taskId, taskId));
  const offset = labels.reduce((max, row) => {
    const match = /^Student (\d+)$/u.exec(row.label ?? "");
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  const output = Array.from({ length: count }, (_, index) => ({
    code: newAccessCode(),
    label: `Student ${String(offset + index + 1).padStart(3, "0")}`,
  }));
  await db.insert(accessCodes).values(
    output.map((item) => ({
      taskId,
      codeHash: hashAccessCode(item.code),
      label: item.label,
      expiresAt,
    })),
  );
  await audit("access_codes.generated", taskId, {
    count,
    expiresAt: expiresAt?.toISOString() ?? null,
  });
  return output;
}

export async function listAccessCodes(taskId: string): Promise<AccessCodeListItem[]> {
  const now = new Date();
  const rows = await getDb()
    .select({ code: accessCodes, session: studentSessions })
    .from(accessCodes)
    .leftJoin(studentSessions, eq(studentSessions.accessCodeId, accessCodes.id))
    .where(eq(accessCodes.taskId, taskId))
    .orderBy(asc(accessCodes.createdAt), asc(accessCodes.label));
  return rows.map(({ code, session }) => ({
    id: code.id,
    label: code.label,
    status: accessCodeStatus(code, now),
    expiresAt: code.expiresAt?.toISOString() ?? null,
    disabledAt: code.disabledAt?.toISOString() ?? null,
    createdAt: code.createdAt.toISOString(),
    session: session
      ? {
          id: session.id,
          currentStage: session.currentStage,
          completed: Boolean(session.completedAt),
        }
      : null,
  }));
}

export async function updateAccessCodes(input: {
  taskId: string;
  codeIds: string[];
  operation: "disable" | "enable" | "set_expiry";
  expiresAt?: Date | null;
}) {
  const now = new Date();
  const set =
    input.operation === "disable"
      ? { disabledAt: now }
      : input.operation === "enable"
        ? { disabledAt: null }
        : { expiresAt: input.expiresAt ?? null };
  if (input.operation === "set_expiry") assertFuture(input.expiresAt ?? null);

  const updated = await getDb()
    .update(accessCodes)
    .set(set)
    .where(
      and(
        eq(accessCodes.taskId, input.taskId),
        inArray(accessCodes.id, input.codeIds),
        // Keep the original disable time when disabling again.
        input.operation === "disable" ? isNull(accessCodes.disabledAt) : undefined,
      ),
    )
    .returning({ id: accessCodes.id });
  await audit(`access_codes.${input.operation}`, input.taskId, {
    requested: input.codeIds.length,
    updated: updated.length,
    expiresAt:
      input.operation === "set_expiry"
        ? (input.expiresAt?.toISOString() ?? null)
        : undefined,
  });
  return { updated: updated.length };
}

/** Ends a study: every still-active code of the task stops working at once. */
export async function disableAllTaskCodes(taskId: string) {
  const updated = await getDb()
    .update(accessCodes)
    .set({ disabledAt: new Date() })
    .where(and(eq(accessCodes.taskId, taskId), isNull(accessCodes.disabledAt)))
    .returning({ id: accessCodes.id });
  await audit("access_codes.disable_all", taskId, { updated: updated.length });
  return { updated: updated.length };
}

/**
 * Deletes codes no student has used. A used code is tied to a session and its
 * research data, so it is skipped (disable it instead) rather than deleted.
 */
export async function deleteUnusedAccessCodes(input: {
  taskId: string;
  codeIds: string[];
}) {
  const deleted = await getDb()
    .delete(accessCodes)
    .where(
      and(
        eq(accessCodes.taskId, input.taskId),
        inArray(accessCodes.id, input.codeIds),
        notExists(
          getDb()
            .select({ id: studentSessions.id })
            .from(studentSessions)
            .where(eq(studentSessions.accessCodeId, accessCodes.id)),
        ),
      ),
    )
    .returning({ id: accessCodes.id });
  const skipped = input.codeIds.length - deleted.length;
  await audit("access_codes.deleted", input.taskId, {
    requested: input.codeIds.length,
    deleted: deleted.length,
    skipped,
  });
  return { deleted: deleted.length, skipped };
}

/**
 * A signed-in student keeps access only while their code is still active and
 * their task is still published (not archived).
 */
export async function studentCodeActive(sessionId: string): Promise<boolean> {
  const rows = await getDb()
    .select({
      disabledAt: accessCodes.disabledAt,
      expiresAt: accessCodes.expiresAt,
      taskStatus: tasks.status,
    })
    .from(studentSessions)
    .innerJoin(accessCodes, eq(studentSessions.accessCodeId, accessCodes.id))
    .innerJoin(tasks, eq(studentSessions.taskId, tasks.id))
    .where(eq(studentSessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  return Boolean(
    row && row.taskStatus === "published" && accessCodeStatus(row) === "active",
  );
}
