import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  accessCodes,
  artifacts,
  messages,
  stageAttempts,
  studentSessions,
  tasks,
  type ArtifactRow,
} from "@/lib/db/schema";
import {
  evaluateStageGate,
  nextStage,
  STAGES,
  type GateEvidence,
  type StageId,
} from "@/lib/domain/stages";
import {
  normalizeTaskConfig,
  type TaskConfig,
} from "@/lib/domain/default-task";
import { withRecordingAnalysisStatus } from "@/lib/domain/recordings";
import { ApiError } from "@/lib/security/request";

export type ArtifactView = {
  id: string;
  stageId: StageId;
  type: string;
  status: string;
  data: Record<string, unknown>;
  mimeType: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
  createdAt: string;
};

export type SessionView = {
  session: {
    id: string;
    currentStage: StageId;
    stageStatus: string;
    stateVersion: number;
    consented: boolean;
    completed: boolean;
  };
  task: {
    id: string;
    title: string;
    description: string;
    provider: string;
    modelId: string;
    config: Omit<TaskConfig, "promptConfig">;
  };
  stages: Array<{
    id: StageId;
    order: number;
    shortLabel: string;
    title: string;
    description: string;
    status: "locked" | "active" | "completed";
  }>;
  messages: Array<{
    id: string;
    stageId: StageId;
    role: string;
    kind: string;
    content: Record<string, unknown>;
    createdAt: string;
  }>;
  artifacts: ArtifactView[];
  gate: ReturnType<typeof evaluateStageGate>;
  concealPriorStages: boolean;
};

function arrayLength(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return Array.isArray(value) ? value.length : 0;
}

function latestArtifact(
  rows: ArtifactRow[],
  stage: StageId,
  type: string,
): ArtifactRow | undefined {
  return rows.find(
    (row) =>
      row.stageId === stage && row.type === type && row.supersededAt === null,
  );
}

export function evidenceForStage(
  rows: ArtifactRow[],
  stage: StageId,
): GateEvidence {
  const stageRows = rows.filter(
    (row) => row.stageId === stage && row.supersededAt === null,
  );
  const labels = latestArtifact(rows, "visualization", "self_labels");
  const vocabularyDecisions = latestArtifact(
    rows,
    "image_analysis",
    "vocabulary_decisions",
  );
  const conceptDecisions = latestArtifact(
    rows,
    "ai_concept_map",
    "concept_decisions",
  );
  const sentences = latestArtifact(
    rows,
    "sentence_scaffold",
    "sentences",
  );

  return {
    audioCount: stageRows.filter(
      (row) => row.type === "audio" && row.status === "ready",
    ).length,
    imageCount: stageRows.filter(
      (row) => row.type === "image" && row.status === "ready",
    ).length,
    selfLabelCount: labels ? arrayLength(labels.data, "labels") : 0,
    pendingVocabularyDecisions: vocabularyDecisions
      ? arrayLength(vocabularyDecisions.data, "pending")
      : Number.MAX_SAFE_INTEGER,
    pendingConceptDecisions: conceptDecisions
      ? arrayLength(conceptDecisions.data, "pending")
      : Number.MAX_SAFE_INTEGER,
    sentenceCount: sentences ? arrayLength(sentences.data, "sentences") : 0,
    aiOutputReady: stageRows.some(
      (row) =>
        [
          "image_analysis",
          "generated_concept_map",
          "ai_concept_map",
          "sentence_scaffold",
        ].includes(row.type) && row.status === "ready",
    ),
    annotatedImageReady: stageRows.some(
      (row) => row.type === "annotated_image" && row.status === "ready",
    ),
  };
}

export async function startStudentSession(codeHash: string) {
  const db = getDb();
  const record = await db
    .select({ code: accessCodes, task: tasks })
    .from(accessCodes)
    .innerJoin(tasks, eq(accessCodes.taskId, tasks.id))
    .where(
      and(
        eq(accessCodes.codeHash, codeHash),
        isNull(accessCodes.disabledAt),
        eq(tasks.status, "published"),
      ),
    )
    .limit(1);

  const found = record[0];
  if (
    !found ||
    (found.code.expiresAt && found.code.expiresAt.getTime() < Date.now())
  ) {
    throw new ApiError(401, "INVALID_CODE", "代碼不存在、已停用或已過期。");
  }

  const existing = await db.query.studentSessions.findFirst({
    where: eq(studentSessions.accessCodeId, found.code.id),
  });
  if (existing) return existing;

  const insertedRows = await db
    .insert(studentSessions)
    .values({
      taskId: found.task.id,
      accessCodeId: found.code.id,
      currentStage: "pretest",
      stageStatus: "active",
    })
    .onConflictDoNothing({ target: studentSessions.accessCodeId })
    .returning();
  const session =
    insertedRows[0] ??
    (await db.query.studentSessions.findFirst({
      where: eq(studentSessions.accessCodeId, found.code.id),
    }));
  if (!session) {
    throw new ApiError(409, "SESSION_START_CONFLICT", "工作階段建立衝突，請重試。");
  }

  if (insertedRows[0]) {
    await db.insert(stageAttempts).values({
      sessionId: session.id,
      stageId: "pretest",
      attempt: 1,
      status: "active",
    });
  }

  return session;
}

export async function recordConsent(sessionId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  // Keep the first consent timestamp; a repeated consent only touches lastSeenAt.
  const updated = await db
    .update(studentSessions)
    .set({
      consentedAt: sql`coalesce(${studentSessions.consentedAt}, ${now.toISOString()}::timestamptz)`,
      consentVersion: sql`coalesce(${studentSessions.consentVersion}, '1.0')`,
      lastSeenAt: now,
    })
    .where(eq(studentSessions.id, sessionId))
    .returning({ id: studentSessions.id });
  if (!updated[0]) {
    throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");
  }
}

export async function getSessionUploadAuthorization(sessionId: string) {
  const db = getDb();
  const rows = await db
    .select({
      currentStage: studentSessions.currentStage,
      consentedAt: studentSessions.consentedAt,
    })
    .from(studentSessions)
    .where(eq(studentSessions.id, sessionId))
    .limit(1);
  const session = rows[0];
  if (!session) {
    throw new ApiError(404, "SESSION_NOT_FOUND", "找不到學生工作階段。");
  }
  return {
    currentStage: session.currentStage,
    consented: Boolean(session.consentedAt),
  };
}

export async function getSessionView(
  sessionId: string,
  options?: {
    artifactUrl?: (artifactId: string) => string;
  },
): Promise<SessionView> {
  const db = getDb();
  const joined = await db
    .select({ session: studentSessions, task: tasks })
    .from(studentSessions)
    .innerJoin(tasks, eq(studentSessions.taskId, tasks.id))
    .where(eq(studentSessions.id, sessionId))
    .limit(1);
  const found = joined[0];
  if (!found) throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");

  const [messageRows, artifactRows] = await Promise.all([
    db.query.messages.findMany({
      where: eq(messages.sessionId, sessionId),
      orderBy: [asc(messages.createdAt)],
    }),
    db.query.artifacts.findMany({
      where: eq(artifacts.sessionId, sessionId),
      orderBy: [desc(artifacts.createdAt)],
    }),
  ]);

  const currentIndex = STAGES.findIndex(
    (stage) => stage.id === found.session.currentStage,
  );
  const concealPriorStages =
    found.session.currentStage === "posttest" && !found.session.completedAt;
  // During the posttest, prior hints are withheld from the response itself,
  // not just hidden in the UI, so they cannot be read from the network tab.
  const visibleStageIds = new Set<StageId>(
    concealPriorStages
      ? [found.session.currentStage]
      : STAGES.slice(0, currentIndex + 1).map((stage) => stage.id),
  );
  const evidence = evidenceForStage(
    artifactRows,
    found.session.currentStage,
  );
  const normalizedConfig = normalizeTaskConfig(found.task.config);

  return {
    session: {
      id: found.session.id,
      currentStage: found.session.currentStage,
      stageStatus: found.session.stageStatus,
      stateVersion: found.session.stateVersion,
      consented: Boolean(found.session.consentedAt),
      completed: Boolean(found.session.completedAt),
    },
    task: {
      id: found.task.id,
      title: found.task.title,
      description: found.task.description,
      provider: found.task.provider,
      modelId: found.task.modelId,
      config: {
        locale: normalizedConfig.locale,
        targetLanguage: normalizedConfig.targetLanguage,
        consentText: normalizedConfig.consentText,
        retentionDays: normalizedConfig.retentionDays,
        stageConfig: normalizedConfig.stageConfig,
      },
    },
    stages: STAGES.map((stage, index) => ({
      ...stage,
      status:
        index < currentIndex || found.session.completedAt
          ? ("completed" as const)
          : index === currentIndex
            ? ("active" as const)
            : ("locked" as const),
    })),
    messages: messageRows
      .filter(
        (message) =>
          visibleStageIds.has(message.stageId) &&
          (!message.hiddenUntilComplete || Boolean(found.session.completedAt)),
      )
      .map((message) => ({
        id: message.id,
        stageId: message.stageId,
        role: message.role,
        kind: message.kind,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
    artifacts: artifactRows
      .filter(
        (artifact) =>
          visibleStageIds.has(artifact.stageId) &&
          artifact.supersededAt === null &&
          (!["transcript", "speech_evaluation"].includes(artifact.type) ||
            Boolean(found.session.completedAt)),
      )
      .map((artifact) => ({
        id: artifact.id,
        stageId: artifact.stageId,
        type: artifact.type,
        status: artifact.status,
        data: artifact.data,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        downloadUrl: artifact.storageLocator
          ? (options?.artifactUrl?.(artifact.id) ??
            `/api/student/artifacts/${artifact.id}`)
          : null,
        createdAt: artifact.createdAt.toISOString(),
      })),
    gate: evaluateStageGate(found.session.currentStage, evidence),
    concealPriorStages,
  };
}

type ArtifactWriteInput = {
  sessionId: string;
  stageId: StageId;
  type: string;
  status?: string;
  data?: Record<string, unknown>;
  storageProvider?: string;
  storageLocator?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
};

type ArtifactWriteOptions = {
  allowWhenCurrentStage?: StageId;
};

type DbTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

async function assertArtifactWritable(
  tx: DbTransaction,
  input: ArtifactWriteInput,
  options?: ArtifactWriteOptions,
) {
  // Row lock: concurrent writers for one session serialize here, so a stage
  // change cannot slip between the check and the write.
  const rows = await tx
    .select({ currentStage: studentSessions.currentStage })
    .from(studentSessions)
    .where(eq(studentSessions.id, input.sessionId))
    .limit(1)
    .for("update");
  const session = rows[0];
  if (!session) throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");
  if (
    session.currentStage !== input.stageId &&
    session.currentStage !== options?.allowWhenCurrentStage
  ) {
    throw new ApiError(409, "STAGE_LOCKED", "此階段目前不可操作。");
  }
}

async function insertArtifact(tx: DbTransaction, input: ArtifactWriteInput) {
  return (
    await tx
      .insert(artifacts)
      .values({
        sessionId: input.sessionId,
        stageId: input.stageId,
        type: input.type,
        status: input.status ?? "ready",
        data: input.data ?? {},
        storageProvider: input.storageProvider,
        storageLocator: input.storageLocator,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
      })
      .returning()
  )[0];
}

export async function saveArtifact(
  input: ArtifactWriteInput,
  options?: ArtifactWriteOptions,
) {
  return getDb().transaction(async (tx) => {
    await assertArtifactWritable(tx, input, options);
    return insertArtifact(tx, input);
  });
}

export async function saveRecordingAudio(input: {
  sessionId: string;
  stageId: StageId;
  audio: {
    storageLocator: string;
    mimeType: string;
    sizeBytes: number;
    data: Record<string, unknown>;
  };
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(studentSessions)
      .where(eq(studentSessions.id, input.sessionId))
      .limit(1);
    const session = rows[0];
    if (!session) {
      throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");
    }
    if (session.currentStage !== input.stageId) {
      throw new ApiError(409, "STAGE_LOCKED", "此階段目前不可操作。");
    }

    const inserted = await tx
      .insert(artifacts)
      .values({
        sessionId: input.sessionId,
        stageId: input.stageId,
        type: "audio",
        status: "ready",
        data: withRecordingAnalysisStatus(input.audio.data, "pending", new Date()),
        storageProvider: "google-drive",
        storageLocator: input.audio.storageLocator,
        mimeType: input.audio.mimeType,
        sizeBytes: input.audio.sizeBytes,
      })
      .returning();
    return inserted[0];
  });
}

export async function saveRecordingAnalysis(input: {
  sessionId: string;
  stageId: StageId;
  audioArtifactId: string;
  transcript: Record<string, unknown>;
  evaluation: Record<string, unknown>;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const audioRows = await tx
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.id, input.audioArtifactId),
          eq(artifacts.sessionId, input.sessionId),
          eq(artifacts.stageId, input.stageId),
          eq(artifacts.type, "audio"),
          isNull(artifacts.supersededAt),
        ),
      )
      .limit(1);
    const audio = audioRows[0];
    if (!audio) {
      throw new ApiError(404, "AUDIO_ARTIFACT_NOT_FOUND", "找不到已保存的錄音。");
    }
    if (audio.data.analysisStatus === "ready") return;

    const completedAt = new Date();
    await tx
      .update(artifacts)
      .set({ supersededAt: completedAt, updatedAt: completedAt })
      .where(
        and(
          eq(artifacts.sessionId, input.sessionId),
          eq(artifacts.stageId, input.stageId),
          inArray(artifacts.type, ["transcript", "speech_evaluation"]),
          isNull(artifacts.supersededAt),
        ),
      );
    await tx.insert(artifacts).values([
      {
        sessionId: input.sessionId,
        stageId: input.stageId,
        type: "transcript",
        status: "ready",
        data: input.transcript,
      },
      {
        sessionId: input.sessionId,
        stageId: input.stageId,
        type: "speech_evaluation",
        status: "ready",
        data: input.evaluation,
      },
    ]);
    await tx
      .update(artifacts)
      .set({
        data: withRecordingAnalysisStatus(audio.data, "ready", completedAt),
        updatedAt: completedAt,
      })
      .where(eq(artifacts.id, audio.id));
  });
}

export async function markRecordingAnalysisFailed(input: {
  sessionId: string;
  stageId: StageId;
  audioArtifactId: string;
}) {
  const db = getDb();
  const audio = await db.query.artifacts.findFirst({
    where: and(
      eq(artifacts.id, input.audioArtifactId),
      eq(artifacts.sessionId, input.sessionId),
      eq(artifacts.stageId, input.stageId),
      eq(artifacts.type, "audio"),
      isNull(artifacts.supersededAt),
    ),
  });
  if (!audio || audio.data.analysisStatus === "ready") return;

  const failedAt = new Date();
  await db
    .update(artifacts)
    .set({
      data: withRecordingAnalysisStatus(audio.data, "failed", failedAt),
      updatedAt: failedAt,
    })
    .where(eq(artifacts.id, audio.id));
}

export async function replaceArtifactData(
  input: ArtifactWriteInput & { data: Record<string, unknown> },
  options?: ArtifactWriteOptions,
) {
  // Check the stage before superseding, and do both in one transaction, so a
  // rejected write never leaves the previous artifact superseded with no
  // replacement.
  return getDb().transaction(async (tx) => {
    await assertArtifactWritable(tx, input, options);
    const now = new Date();
    await tx
      .update(artifacts)
      .set({ supersededAt: now, updatedAt: now })
      .where(
        and(
          eq(artifacts.sessionId, input.sessionId),
          eq(artifacts.stageId, input.stageId),
          eq(artifacts.type, input.type),
          isNull(artifacts.supersededAt),
        ),
      );
    return insertArtifact(tx, input);
  });
}

export async function saveMessage(input: {
  sessionId: string;
  stageId: StageId;
  role: "student" | "assistant" | "system";
  kind?: string;
  content: Record<string, unknown>;
  idempotencyKey?: string;
  hiddenUntilComplete?: boolean;
}) {
  const db = getDb();
  const inserted = await db
    .insert(messages)
    .values({
      sessionId: input.sessionId,
      stageId: input.stageId,
      role: input.role,
      kind: input.kind ?? "text",
      content: input.content,
      idempotencyKey: input.idempotencyKey,
      hiddenUntilComplete: input.hiddenUntilComplete ?? false,
    })
    .onConflictDoNothing()
    .returning();
  return inserted[0] ?? null;
}

export async function completeCurrentStage(
  sessionId: string,
  stateVersion: number,
) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const sessionRows = await tx
      .select()
      .from(studentSessions)
      .where(eq(studentSessions.id, sessionId))
      .limit(1);
    const session = sessionRows[0];
    if (!session) {
      throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");
    }
    if (session.stateVersion !== stateVersion) {
      throw new ApiError(
        409,
        "STALE_SESSION",
        "工作階段已更新，請重新整理後再試。",
      );
    }

    const rows = await tx
      .select()
      .from(artifacts)
      .where(eq(artifacts.sessionId, sessionId))
      .orderBy(desc(artifacts.createdAt));
    const gate = evaluateStageGate(
      session.currentStage,
      evidenceForStage(rows, session.currentStage),
    );
    if (!gate.ok) throw new ApiError(409, "GATE_NOT_MET", gate.message);

    const next = nextStage(session.currentStage);
    const now = new Date();
    const updated = await tx
      .update(studentSessions)
      .set(
        next
          ? {
              currentStage: next,
              stageStatus: "active",
              stateVersion: stateVersion + 1,
              lastSeenAt: now,
            }
          : {
              stageStatus: "completed",
              completedAt: now,
              stateVersion: stateVersion + 1,
              lastSeenAt: now,
            },
      )
      .where(
        and(
          eq(studentSessions.id, sessionId),
          eq(studentSessions.stateVersion, stateVersion),
        ),
      )
      .returning({ id: studentSessions.id });
    if (!updated[0]) {
      throw new ApiError(
        409,
        "STALE_SESSION",
        "工作階段已更新，請重新整理後再試。",
      );
    }

    await tx
      .update(stageAttempts)
      .set({ status: "completed", completedAt: now })
      .where(
        and(
          eq(stageAttempts.sessionId, sessionId),
          eq(stageAttempts.stageId, session.currentStage),
          eq(stageAttempts.status, "active"),
        ),
      );

    if (next) {
      const attemptRows = await tx
        .select({
          value: sql<number>`coalesce(max(${stageAttempts.attempt}), 0)`,
        })
        .from(stageAttempts)
        .where(
          and(
            eq(stageAttempts.sessionId, sessionId),
            eq(stageAttempts.stageId, next),
          ),
        );
      await tx.insert(stageAttempts).values({
        sessionId,
        stageId: next,
        attempt: Number(attemptRows[0]?.value ?? 0) + 1,
        status: "active",
      });
    }
  });
}
