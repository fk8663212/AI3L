export type RecordingAnalysisStatus = "pending" | "ready" | "failed";

export const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/wav",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
] as const;

export function normalizeAudioMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() || "audio/webm";
}

export function isSupportedAudioMimeType(value: string): boolean {
  const normalized = normalizeAudioMimeType(value);
  return (SUPPORTED_AUDIO_MIME_TYPES as readonly string[]).includes(normalized);
}

export function withRecordingAnalysisStatus(
  data: Record<string, unknown>,
  status: RecordingAnalysisStatus,
  at: Date,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...data,
    analysisStatus: status,
    analysisUpdatedAt: at.toISOString(),
  };

  if (status === "pending") {
    delete next.analysisCompletedAt;
  } else {
    next.analysisCompletedAt = at.toISOString();
  }

  return next;
}
