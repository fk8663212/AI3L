import { z } from "zod";
import type { SpeechEvaluation, Transcript } from "@/lib/ai/schemas";

/**
 * Speech models invent plausible learner speech for a silent recording, so a
 * recording with no voice must never reach them. The recorder measures the
 * microphone level while recording and reports how much of it was voiced.
 */
export const voiceActivitySchema = z.object({
  /** Seconds whose level was above VOICE_LEVEL_THRESHOLD. */
  voicedSeconds: z.number().min(0).max(600),
  /** Highest RMS level seen, 0..1. */
  peakLevel: z.number().min(0).max(1),
});

export type VoiceActivity = z.infer<typeof voiceActivitySchema>;

/** RMS of a time-domain frame (-1..1 samples). Quiet speech is about 0.02+. */
export const VOICE_LEVEL_THRESHOLD = 0.015;
/** Less voiced time than this is treated as a recording without speech. */
export const MIN_VOICED_SECONDS = 1.5;

export function rmsLevel(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / samples.length);
}

export function isSilentRecording(voice: VoiceActivity | undefined): boolean {
  return Boolean(voice) && voice!.voicedSeconds < MIN_VOICED_SECONDS;
}

export function silentTranscript(): Transcript {
  return { language: "en", text: "", segments: [] };
}

export function silentEvaluation(): SpeechEvaluation {
  return {
    contentUnits: 0,
    wordsPerMinute: 0,
    pauseCount: 0,
    vocabularyHighlights: [],
    organizationFeedbackZh: "這段錄音沒有偵測到可辨識的英語口說，因此沒有進行分析。",
    nextStepZh: "請確認麥克風可以收音（錄音時音量條會跳動），再重新錄一次。",
  };
}

/**
 * Keeps only segments inside the recording: a segment that starts after the
 * end cannot have been spoken, and the text is rebuilt from what remains.
 */
export function boundTranscript(transcript: Transcript, durationSeconds: number): Transcript {
  const segments = transcript.segments
    .filter((segment) => segment.text.trim()
      && segment.startSeconds < durationSeconds
      && segment.endSeconds >= segment.startSeconds)
    .map((segment) => ({
      ...segment,
      endSeconds: Math.min(segment.endSeconds, durationSeconds),
    }));
  const text =
    transcript.segments.length && segments.length !== transcript.segments.length
      ? segments.map((segment) => segment.text.trim()).join(" ")
      : transcript.text.trim();
  return { ...transcript, text, segments };
}
