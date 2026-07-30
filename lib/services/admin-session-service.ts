import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  accessCodes,
  artifacts,
  messages,
  studentSessions,
  tasks,
  type ArtifactRow,
  type MessageRow,
} from "@/lib/db/schema";
import {
  ADMIN_SESSION_PAGE_SIZE,
  adminSessionTotalPages,
  escapeLikeLiteral,
  normalizeAdminSessionPage,
} from "@/lib/domain/admin-sessions";
import { STAGES, type StageId } from "@/lib/domain/stages";
import { ApiError } from "@/lib/security/request";

export type AdminSessionViewMode = "student" | "full";

export type AdminSessionListItem = {
  id: string;
  studentLabel: string | null;
  taskId: string;
  taskTitle: string;
  currentStage: StageId;
  stageStatus: string;
  startedAt: string;
  completedAt: string | null;
};

export type AdminSessionListPage = {
  items: AdminSessionListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type AdminSessionMeta = {
  id: string;
  studentLabel: string | null;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  provider: string;
  modelId: string;
  currentStage: StageId;
  stageStatus: string;
  stateVersion: number;
  consentVersion: string | null;
  consentedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  lastSeenAt: string;
};

export type AdminLearningRecordMessage = {
  id: string;
  stageId: StageId;
  role: string;
  kind: string;
  content: Record<string, unknown>;
  hiddenUntilComplete: boolean;
  createdAt: string;
};

export type AdminLearningRecordArtifact = {
  id: string;
  stageId: StageId;
  type: string;
  status: string;
  data: Record<string, unknown>;
  mimeType: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminSessionLearningRecord = {
  session: AdminSessionMeta;
  stages: Array<{
    id: StageId;
    order: number;
    title: string;
    description: string;
    messages: AdminLearningRecordMessage[];
    artifacts: AdminLearningRecordArtifact[];
  }>;
};

type ListAdminSessionsInput = {
  q?: string;
  taskId?: string;
  page?: number;
};

function adminArtifactUrl(sessionId: string, artifactId: string): string {
  return `/api/admin/sessions/${sessionId}/artifacts/${artifactId}`;
}

export async function listAdminSessions(
  input: ListAdminSessionsInput = {},
): Promise<AdminSessionListPage> {
  const db = getDb();
  const page = normalizeAdminSessionPage(input.page ?? 1);
  const query = input.q?.trim() ?? "";
  const filters: SQL[] = [];

  if (query) {
    const pattern = `%${escapeLikeLiteral(query)}%`;
    filters.push(
      sql`(
        ${studentSessions.id}::text ILIKE ${pattern} ESCAPE E'\\\\'
        OR ${accessCodes.label} ILIKE ${pattern} ESCAPE E'\\\\'
      )`,
    );
  }
  if (input.taskId) {
    filters.push(eq(studentSessions.taskId, input.taskId));
  }

  const where = filters.length ? and(...filters) : undefined;
  const baseCount = db
    .select({ total: sql<number>`count(*)` })
    .from(studentSessions)
    .innerJoin(accessCodes, eq(studentSessions.accessCodeId, accessCodes.id))
    .innerJoin(tasks, eq(studentSessions.taskId, tasks.id))
    .where(where);
  const baseItems = db
    .select({
      id: studentSessions.id,
      studentLabel: accessCodes.label,
      taskId: tasks.id,
      taskTitle: tasks.title,
      currentStage: studentSessions.currentStage,
      stageStatus: studentSessions.stageStatus,
      startedAt: studentSessions.startedAt,
      completedAt: studentSessions.completedAt,
    })
    .from(studentSessions)
    .innerJoin(accessCodes, eq(studentSessions.accessCodeId, accessCodes.id))
    .innerJoin(tasks, eq(studentSessions.taskId, tasks.id))
    .where(where)
    .orderBy(desc(studentSessions.startedAt))
    .limit(ADMIN_SESSION_PAGE_SIZE)
    .offset((page - 1) * ADMIN_SESSION_PAGE_SIZE);

  const [countRows, rows] = await Promise.all([baseCount, baseItems]);
  const total = Number(countRows[0]?.total ?? 0);

  return {
    items: rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    pagination: {
      page,
      pageSize: ADMIN_SESSION_PAGE_SIZE,
      total,
      totalPages: adminSessionTotalPages(total),
    },
  };
}

export async function getAdminSessionMeta(
  sessionId: string,
): Promise<AdminSessionMeta> {
  const db = getDb();
  const rows = await db
    .select({
      id: studentSessions.id,
      studentLabel: accessCodes.label,
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskDescription: tasks.description,
      provider: tasks.provider,
      modelId: tasks.modelId,
      currentStage: studentSessions.currentStage,
      stageStatus: studentSessions.stageStatus,
      stateVersion: studentSessions.stateVersion,
      consentVersion: studentSessions.consentVersion,
      consentedAt: studentSessions.consentedAt,
      startedAt: studentSessions.startedAt,
      completedAt: studentSessions.completedAt,
      lastSeenAt: studentSessions.lastSeenAt,
    })
    .from(studentSessions)
    .innerJoin(accessCodes, eq(studentSessions.accessCodeId, accessCodes.id))
    .innerJoin(tasks, eq(studentSessions.taskId, tasks.id))
    .where(eq(studentSessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");
  }

  return {
    ...row,
    consentedAt: row.consentedAt?.toISOString() ?? null,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

export async function getAdminSessionLearningRecord(
  sessionId: string,
): Promise<AdminSessionLearningRecord> {
  const db = getDb();
  const [session, messageRows, artifactRows] = await Promise.all([
    getAdminSessionMeta(sessionId),
    db.query.messages.findMany({
      where: eq(messages.sessionId, sessionId),
      orderBy: [asc(messages.createdAt)],
    }),
    db.query.artifacts.findMany({
      where: eq(artifacts.sessionId, sessionId),
      orderBy: [asc(artifacts.createdAt)],
    }),
  ]);

  return buildAdminSessionLearningRecord(session, messageRows, artifactRows);
}

export function buildAdminSessionLearningRecord(
  session: AdminSessionMeta,
  messageRows: MessageRow[],
  artifactRows: ArtifactRow[],
): AdminSessionLearningRecord {
  return {
    session,
    stages: STAGES.map((stage) => ({
      id: stage.id,
      order: stage.order,
      title: stage.title,
      description: stage.description,
      messages: messageRows
        .filter((message) => message.stageId === stage.id)
        .map((message) => ({
          id: message.id,
          stageId: message.stageId,
          role: message.role,
          kind: message.kind,
          content: message.content,
          hiddenUntilComplete: message.hiddenUntilComplete,
          createdAt: message.createdAt.toISOString(),
        })),
      artifacts: artifactRows
        .filter((artifact) => artifact.stageId === stage.id)
        .map((artifact) => ({
          id: artifact.id,
          stageId: artifact.stageId,
          type: artifact.type,
          status: artifact.status,
          data: artifact.data,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          downloadUrl: artifact.storageLocator
            ? adminArtifactUrl(session.id, artifact.id)
            : null,
          supersededAt: artifact.supersededAt?.toISOString() ?? null,
          createdAt: artifact.createdAt.toISOString(),
          updatedAt: artifact.updatedAt.toISOString(),
        })),
    })),
  };
}
