import { describe, expect, it } from "vitest";
import {
  evaluateStageGate,
  nextStage,
  STAGE_IDS,
  type GateEvidence,
} from "@/lib/domain/stages";

const completeEvidence: GateEvidence = {
  audioCount: 1,
  imageCount: 1,
  selfLabelCount: 3,
  conceptNodeCount: 3,
  conceptEdgeCount: 2,
  pendingVocabularyDecisions: 0,
  pendingConceptDecisions: 0,
  sentenceCount: 3,
  aiOutputReady: true,
  annotatedImageReady: true,
};

describe("seven-stage state machine", () => {
  it("keeps the published stage order", () => {
    expect(STAGE_IDS).toHaveLength(7);
    expect(nextStage("pretest")).toBe("visualization");
    expect(nextStage("sentence_scaffold")).toBe("posttest");
    expect(nextStage("posttest")).toBeNull();
  });

  it.each(STAGE_IDS)("accepts complete evidence for %s", (stage) => {
    expect(evaluateStageGate(stage, completeEvidence)).toMatchObject({
      ok: true,
      code: "OK",
    });
  });

  it("does not allow AI review stages to be skipped", () => {
    expect(
      evaluateStageGate("image_analysis", {
        ...completeEvidence,
        pendingVocabularyDecisions: 1,
      }).code,
    ).toBe("REVIEW_REQUIRED");
    expect(
      evaluateStageGate("ai_concept_map", {
        ...completeEvidence,
        aiOutputReady: false,
      }).code,
    ).toBe("AI_OUTPUT_REQUIRED");
  });

  it("requires an AI-annotated drawing in the recognition stage", () => {
    expect(
      evaluateStageGate("image_analysis", {
        ...completeEvidence,
        annotatedImageReady: false,
      }).code,
    ).toBe("AI_OUTPUT_REQUIRED");
  });

  it("requires scaffold generation, student sentences and practice audio", () => {
    expect(
      evaluateStageGate("sentence_scaffold", {
        ...completeEvidence,
        aiOutputReady: false,
      }).code,
    ).toBe("AI_OUTPUT_REQUIRED");
    expect(
      evaluateStageGate("sentence_scaffold", {
        ...completeEvidence,
        sentenceCount: 2,
      }).code,
    ).toBe("SENTENCES_REQUIRED");
    expect(
      evaluateStageGate("sentence_scaffold", {
        ...completeEvidence,
        audioCount: 0,
      }).code,
    ).toBe("AUDIO_REQUIRED");
  });
});
