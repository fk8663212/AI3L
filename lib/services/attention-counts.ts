import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { artifacts, studentSessions, tasks } from "@/lib/db/schema";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";

/** Matches recording-service: a "pending" analysis this old was cut off. */
const STALLED_ANALYSIS_MS = 10 * 60 * 1000;

/**
 * Light-weight counts for the admin overview. Plain SQL counts with no AI or
 * storage imports, so rendering the dashboard never loads sharp or the AI
 * SDKs, and a failing count cannot take the whole admin page down.
 */
async function safeCount(label: string, query: Promise<Array<{ value: number | string }>>) {
  try {
    const rows = await query;
    return Number(rows[0]?.value ?? 0);
  } catch (error) {
    console.error(`Admin overview count failed: ${label}`, error);
    return 0;
  }
}

export function countRecordingAnalysisIssues(now: Date = new Date()) {
  const status = sql`${artifacts.data}->>'analysisStatus'`;
  const updated = sql`${artifacts.data}->>'analysisUpdatedAt'`;
  const stalledBefore = new Date(now.getTime() - STALLED_ANALYSIS_MS).toISOString();
  return safeCount(
    "recording analysis issues",
    getDb()
      .select({ value: sql<number>`count(*)` })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.type, "audio"),
          inArray(artifacts.storageProvider, ["google-drive", "local"]),
          isNull(artifacts.supersededAt),
          sql`(${status} = 'failed' or (${status} = 'pending' and ${updated} < ${stalledBefore}))`,
        ),
      ),
  );
}

export function countRetentionExpired(now: Date = new Date()) {
  const days = sql`coalesce((${tasks.config}->>'retentionDays')::int, ${DEFAULT_TASK_CONFIG.retentionDays})`;
  const since = sql`coalesce(${studentSessions.completedAt}, ${studentSessions.lastSeenAt})`;
  return safeCount(
    "retention expired",
    getDb()
      .select({ value: sql<number>`count(*)` })
      .from(studentSessions)
      .innerJoin(tasks, eq(studentSessions.taskId, tasks.id))
      .where(sql`${since} + make_interval(days => ${days}) < ${now.toISOString()}::timestamptz`),
  );
}
