import { del, list } from "@/lib/storage/blob-store";
import { eq, like, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  accessCodes,
  artifacts,
  auditLogs,
  rateLimits,
  studentSessions,
  tasks,
} from "@/lib/db/schema";
import { DEFAULT_TASK_CONFIG } from "@/lib/domain/default-task";
import { ApiError } from "@/lib/security/request";
import { deleteDriveFile } from "@/lib/storage/google-drive";

export type ParticipantDeletionResult = {
  sessionId: string;
  studentLabel: string | null;
  driveFilesDeleted: number;
  blobsDeleted: number;
  artifactRowsDeleted: number;
};

/**
 * Deletes everything stored about one participant: Drive recordings, Blob
 * images (including superseded attempts and staging leftovers), and every
 * database row of the session. The access code is kept but disabled, so it
 * cannot start a fresh session.
 *
 * Files are deleted before rows. If a file cannot be deleted the rows stay,
 * so the admin can retry and nothing is left orphaned without a record.
 */
export async function deleteParticipantData(input: {
  sessionId: string;
  reason: "admin_request" | "retention_expired";
}): Promise<ParticipantDeletionResult> {
  const db = getDb();
  const found = (
    await db
      .select({ session: studentSessions, label: accessCodes.label })
      .from(studentSessions)
      .innerJoin(accessCodes, eq(studentSessions.accessCodeId, accessCodes.id))
      .where(eq(studentSessions.id, input.sessionId))
      .limit(1)
  )[0];
  if (!found) {
    throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");
  }

  const rows = await db.query.artifacts.findMany({
    where: eq(artifacts.sessionId, input.sessionId),
  });
  const driveIds = rows.flatMap((row) =>
    row.storageProvider === "google-drive" && row.storageLocator
      ? [row.storageLocator]
      : [],
  );
  const blobUrls = new Set(
    rows.flatMap((row) =>
      (row.storageProvider === "vercel-blob" || row.storageProvider === "local") && row.storageLocator
        ? [row.storageLocator]
        : [],
    ),
  );

  let failures = 0;
  for (const fileId of driveIds) {
    try {
      await deleteDriveFile(fileId);
    } catch {
      failures += 1;
    }
  }
  try {
    let cursor: string | undefined;
    do {
      const page = await list({
        prefix: `student/${input.sessionId}/`,
        cursor,
        limit: 1_000,
      });
      for (const blob of page.blobs) blobUrls.add(blob.url);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    if (blobUrls.size) await del([...blobUrls]);
  } catch {
    failures += 1;
  }
  if (failures) {
    throw new ApiError(
      502,
      "PARTICIPANT_FILES_NOT_DELETED",
      "部分錄音或圖片檔案刪除失敗，資料庫紀錄已保留；請確認錄音與圖片儲存庫後再試一次。",
    );
  }

  await db.transaction(async (tx) => {
    // artifacts, messages, stage attempts and AI runs cascade from the session.
    await tx.delete(studentSessions).where(eq(studentSessions.id, input.sessionId));
    await tx
      .update(accessCodes)
      .set({ disabledAt: sql`coalesce(${accessCodes.disabledAt}, now())` })
      .where(eq(accessCodes.id, found.session.accessCodeId));
    await tx
      .delete(rateLimits)
      .where(like(rateLimits.key, `%:${input.sessionId}`));
    await tx.insert(auditLogs).values({
      actor: "admin",
      action: "session.data_deleted",
      targetType: "task",
      targetId: found.session.taskId,
      // No content or identifiers beyond the anonymous label are kept.
      detail: {
        sessionId: input.sessionId,
        studentLabel: found.label,
        reason: input.reason,
        driveFilesDeleted: driveIds.length,
        blobsDeleted: blobUrls.size,
        artifactRowsDeleted: rows.length,
      },
    });
  });

  return {
    sessionId: input.sessionId,
    studentLabel: found.label,
    driveFilesDeleted: driveIds.length,
    blobsDeleted: blobUrls.size,
    artifactRowsDeleted: rows.length,
  };
}

export type RetentionExpiredSession = {
  sessionId: string;
  studentLabel: string | null;
  taskId: string;
  taskTitle: string;
  retentionDays: number;
  /** Completion time, or last activity for sessions never completed. */
  retainedSince: string;
  expiredAt: string;
};

const retentionDays = sql<number>`coalesce((${tasks.config}->>'retentionDays')::int, ${DEFAULT_TASK_CONFIG.retentionDays})`;
const retainedSince = sql<Date>`coalesce(${studentSessions.completedAt}, ${studentSessions.lastSeenAt})`;

/** Sessions whose task's retention period has passed. Nothing is deleted here. */
export async function listRetentionExpiredSessions(
  now: Date = new Date(),
): Promise<RetentionExpiredSession[]> {
  const rows = await getDb()
    .select({
      sessionId: studentSessions.id,
      studentLabel: accessCodes.label,
      taskId: tasks.id,
      taskTitle: tasks.title,
      retentionDays,
      retainedSince: sql<string>`${retainedSince}::text`,
    })
    .from(studentSessions)
    .innerJoin(tasks, eq(studentSessions.taskId, tasks.id))
    .innerJoin(accessCodes, eq(studentSessions.accessCodeId, accessCodes.id))
    .where(
      lt(
        sql`${retainedSince} + make_interval(days => ${retentionDays})`,
        sql`${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(retainedSince);
  return rows.map((row) => {
    const since = new Date(row.retainedSince);
    const days = Number(row.retentionDays);
    return {
      ...row,
      retentionDays: days,
      retainedSince: since.toISOString(),
      expiredAt: new Date(since.getTime() + days * 86_400_000).toISOString(),
    };
  });
}

/** Deletes the given sessions, but only those that really are past retention. */
export async function purgeRetentionExpired(sessionIds: string[]) {
  const expired = new Set(
    (await listRetentionExpiredSessions()).map((row) => row.sessionId),
  );
  const results: ParticipantDeletionResult[] = [];
  const failed: string[] = [];
  for (const sessionId of sessionIds) {
    if (!expired.has(sessionId)) continue;
    try {
      results.push(
        await deleteParticipantData({ sessionId, reason: "retention_expired" }),
      );
    } catch {
      failed.push(sessionId);
    }
  }
  return { deleted: results.length, failed };
}

