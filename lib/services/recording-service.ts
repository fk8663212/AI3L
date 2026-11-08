import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { accessCodes, artifacts, studentSessions, tasks } from "@/lib/db/schema";
import { withRecordingAnalysisStatus } from "@/lib/domain/recordings";
import { voiceActivitySchema } from "@/lib/domain/voice-activity";
import type { StageId } from "@/lib/domain/stages";
import { analyzeRecording } from "@/lib/ai/voice-service";
import { ApiError } from "@/lib/security/request";
import {
  markRecordingAnalysisFailed,
  saveRecordingAnalysis,
} from "@/lib/services/session-service";
import { getDriveFileStream } from "@/lib/storage/google-drive";

/**
 * The upload route analyses recordings in the background with a 180 s budget.
 * A "pending" analysis older than this was cut off and will never finish.
 */
export const STALLED_ANALYSIS_MS = 10 * 60 * 1000;

export type RecordingAnalysisIssue = {
  audioArtifactId: string;
  sessionId: string;
  studentLabel: string | null;
  taskTitle: string;
  stageId: StageId;
  status: "failed" | "stalled";
  updatedAt: string;
};

export async function listRecordingAnalysisIssues(): Promise<RecordingAnalysisIssue[]> {
  const stalledBefore = new Date(Date.now() - STALLED_ANALYSIS_MS).toISOString();
  const status = sql<string>`${artifacts.data}->>'analysisStatus'`;
  const updated = sql<string>`${artifacts.data}->>'analysisUpdatedAt'`;
  const rows = await getDb()
    .select({
      audioArtifactId: artifacts.id,
      sessionId: artifacts.sessionId,
      stageId: artifacts.stageId,
      status,
      updatedAt: updated,
      studentLabel: accessCodes.label,
      taskTitle: tasks.title,
    })
    .from(artifacts)
    .innerJoin(studentSessions, eq(artifacts.sessionId, studentSessions.id))
    .innerJoin(accessCodes, eq(studentSessions.accessCodeId, accessCodes.id))
    .innerJoin(tasks, eq(studentSessions.taskId, tasks.id))
    .where(
      and(
        eq(artifacts.type, "audio"),
        inArray(artifacts.storageProvider, ["google-drive", "local"]),
        isNull(artifacts.supersededAt),
        sql`(${status} = 'failed' or (${status} = 'pending' and ${updated} < ${stalledBefore}))`,
      ),
    )
    .orderBy(updated);
  return rows.map((row) => ({
    ...row,
    status: row.status === "failed" ? "failed" : "stalled",
  }));
}

/**
 * Re-runs transcription and speech analysis for a saved recording, reading the
 * audio back from Drive (the upload's in-memory bytes are long gone).
 */
export async function retryRecordingAnalysis(audioArtifactId: string) {
  const db = getDb();
  const audio = await db.query.artifacts.findFirst({
    where: and(
      eq(artifacts.id, audioArtifactId),
      eq(artifacts.type, "audio"),
      inArray(artifacts.storageProvider, ["google-drive", "local"]),
      isNull(artifacts.supersededAt),
    ),
  });
  if (!audio?.storageLocator) {
    throw new ApiError(404, "AUDIO_ARTIFACT_NOT_FOUND", "找不到這筆錄音。");
  }
  if (audio.data.analysisStatus === "ready") {
    return { status: "ready" as const };
  }

  await db
    .update(artifacts)
    .set({
      data: withRecordingAnalysisStatus(audio.data, "pending", new Date()),
      updatedAt: new Date(),
    })
    .where(eq(artifacts.id, audio.id));

  const target = {
    sessionId: audio.sessionId,
    stageId: audio.stageId,
    audioArtifactId: audio.id,
  };
  try {
    const file = await getDriveFileStream(audio.storageLocator);
    const bytes = new Uint8Array(await new Response(file.stream).arrayBuffer());
    const mimeType = audio.mimeType ?? file.mimeType;
    const voice = voiceActivitySchema.safeParse(audio.data.voice);
    const analysis = await analyzeRecording({
      ...target,
      bytes,
      mimeType,
      filename: file.name,
      durationSeconds: Number(audio.data.durationSeconds ?? 0),
      ...(voice.success ? { voice: voice.data } : {}),
    });
    await saveRecordingAnalysis({
      ...target,
      transcript: analysis.transcript,
      evaluation: analysis.evaluation,
    });
    return { status: "ready" as const };
  } catch (error) {
    await markRecordingAnalysisFailed(target);
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "ANALYSIS_RETRY_FAILED",
      "錄音分析仍然失敗，請確認 AI 供應商與錄音儲存庫設定後再試。",
    );
  }
}
