import { beforeEach, describe, expect, it, vi } from "vitest";

// Real: analyzeRecording, prompts, the silence rules. Faked: the AI calls,
// the task context and the ai_runs writes.
const ai = vi.hoisted(() => ({ transcribe: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  transcribeAudio: ai.transcribe,
  generateStructured: ai.generate,
}));
vi.mock("@/lib/ai/provider-service", () => ({
  taskAIContext: async () => ({
    provider: "google",
    apiKey: "key",
    session: { currentStage: "pretest" },
    task: { modelId: "gemini-test", promptVersion: "v1", config: {} },
  }),
}));
vi.mock("@/lib/db/client", () => {
  const chain = {
    values: () => chain,
    returning: async () => [{ id: "run" }],
    set: () => chain,
    where: async () => undefined,
  };
  return { getDb: () => ({ insert: () => chain, update: () => chain }) };
});

import { speechTranscriptionPrompt } from "@/lib/ai/prompts";
import { analyzeRecording } from "@/lib/ai/voice-service";
import {
  boundTranscript,
  isSilentRecording,
  rmsLevel,
} from "@/lib/domain/voice-activity";

const recording = {
  sessionId: "session",
  stageId: "pretest" as const,
  bytes: new Uint8Array([1]),
  mimeType: "audio/webm",
  filename: "pretest.webm",
  durationSeconds: 30,
};

const evaluation = {
  contentUnits: 3,
  wordsPerMinute: 0,
  pauseCount: 0,
  vocabularyHighlights: ["salad"],
  organizationFeedbackZh: "回饋",
  nextStepZh: "下一步",
};

beforeEach(() => {
  ai.transcribe.mockReset();
  ai.generate.mockReset();
  ai.generate.mockResolvedValue({ value: evaluation });
});

describe("silent recordings", () => {
  it("never sends a recording without voice to the speech model", async () => {
    const result = await analyzeRecording({
      ...recording,
      voice: { voicedSeconds: 0.3, peakLevel: 0.004 },
    });
    expect(ai.transcribe).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
    expect(result.transcript.text).toBe("");
    expect(result.evaluation.contentUnits).toBe(0);
    expect(result.evaluation.vocabularyHighlights).toEqual([]);
  });

  it("does not evaluate when the model hears nothing", async () => {
    ai.transcribe.mockResolvedValue({ value: { language: "en", text: "  ", segments: [] } });
    const result = await analyzeRecording(recording);
    expect(ai.generate).not.toHaveBeenCalled();
    expect(result.evaluation.contentUnits).toBe(0);
  });

  it("still analyses a recording with speech", async () => {
    ai.transcribe.mockResolvedValue({
      value: {
        language: "en",
        text: "I have some fish.",
        segments: [{ startSeconds: 1, endSeconds: 3, text: "I have some fish." }],
      },
    });
    const result = await analyzeRecording({
      ...recording,
      voice: { voicedSeconds: 12, peakLevel: 0.3 },
    });
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(result.transcript.text).toBe("I have some fish.");
    expect(result.evaluation.wordsPerMinute).toBe(8);
  });

  it("always tells the transcriber to return nothing for silence", () => {
    expect(speechTranscriptionPrompt(30, "Custom template {{recording.durationSeconds}}s")).toMatch(
      /no intelligible speech[\s\S]*empty text/,
    );
  });

  it("drops transcript segments that start after the recording ended", () => {
    const bounded = boundTranscript(
      {
        language: "en",
        text: "Real words. Invented words.",
        segments: [
          { startSeconds: 0, endSeconds: 4, text: "Real words." },
          { startSeconds: 40, endSeconds: 45, text: "Invented words." },
        ],
      },
      10,
    );
    expect(bounded.text).toBe("Real words.");
    expect(bounded.segments).toHaveLength(1);
  });

  it("measures level and decides silence", () => {
    expect(rmsLevel(new Float32Array(100))).toBe(0);
    expect(rmsLevel(Float32Array.from({ length: 100 }, () => 0.5))).toBeCloseTo(0.5);
    expect(isSilentRecording(undefined)).toBe(false);
    expect(isSilentRecording({ voicedSeconds: 1, peakLevel: 0.01 })).toBe(true);
    expect(isSilentRecording({ voicedSeconds: 8, peakLevel: 0.2 })).toBe(false);
  });
});
