import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  accessCodes,
  artifacts,
  auditLogs,
  studentSessions,
} from "@/lib/db/schema";
import {
  measuresFrom,
  summarizePrePost,
  type PrePostRow,
} from "@/lib/domain/pre-post-report";

export async function prePostReport(taskId: string) {
  const db = getDb();
  const sessions = await db
    .select({ session: studentSessions, label: accessCodes.label })
    .from(studentSessions)
    .innerJoin(accessCodes, eq(studentSessions.accessCodeId, accessCodes.id))
    .where(eq(studentSessions.taskId, taskId))
    .orderBy(asc(accessCodes.label));
  const sessionIds = sessions.map((row) => row.session.id);
  const outputs = sessionIds.length
    ? await db
        .select()
        .from(artifacts)
        .where(
          and(
            inArray(artifacts.sessionId, sessionIds),
            inArray(artifacts.stageId, ["pretest", "posttest"]),
            inArray(artifacts.type, ["audio", "transcript", "speech_evaluation"]),
            isNull(artifacts.supersededAt),
          ),
        )
    : [];

  const find = (sessionId: string, stageId: string, type: string) =>
    outputs.find(
      (row) =>
        row.sessionId === sessionId &&
        row.stageId === stageId &&
        row.type === type,
    )?.data;
  const measures = (sessionId: string, stageId: string) =>
    measuresFrom({
      audio: find(sessionId, stageId, "audio"),
      transcript: find(sessionId, stageId, "transcript"),
      evaluation: find(sessionId, stageId, "speech_evaluation"),
    });

  const rows: PrePostRow[] = sessions.map(({ session, label }) => ({
    sessionId: session.id,
    studentLabel: label,
    completed: Boolean(session.completedAt),
    currentStage: session.currentStage,
    pre: measures(session.id, "pretest"),
    post: measures(session.id, "posttest"),
  }));
  return { rows, summary: summarizePrePost(rows) };
}

export const AUDIT_PAGE_SIZE = 50;

export async function listAuditLogs(input: { page?: number; action?: string }) {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const where = input.action ? eq(auditLogs.action, input.action) : undefined;
  const db = getDb();
  const [items, totals, actions] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE),
    db.select({ value: sql<number>`count(*)` }).from(auditLogs).where(where),
    db
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(asc(auditLogs.action)),
  ]);
  const total = Number(totals[0]?.value ?? 0);
  return {
    items: items.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      detail: row.detail,
      createdAt: row.createdAt.toISOString(),
    })),
    actions: actions.map((row) => row.action),
    pagination: {
      page,
      pageSize: AUDIT_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / AUDIT_PAGE_SIZE),
    },
  };
}
