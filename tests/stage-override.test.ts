import { describe, expect, it } from "vitest";
import {
  normalizeStageOverrideReason,
  stageOverrideReasonReady,
} from "@/lib/domain/stage-override";

describe("stage override reason", () => {
  it("trims the audited reason before persistence", () => {
    expect(normalizeStageOverrideReason("  學生需要重新上傳  ")).toBe(
      "學生需要重新上傳",
    );
  });

  it("makes the minimum reason requirement explicit", () => {
    expect(stageOverrideReasonReady("測試")).toBe(false);
    expect(stageOverrideReasonReady("退回重新作答")).toBe(true);
  });
});

describe("overrideRedoesStages", () => {
  it("redoes the target stage and every later stage when moving back", async () => {
    const { overrideRedoesStages } = await import("@/lib/domain/stage-override");
    expect(
      overrideRedoesStages({ from: "image_analysis", to: "visualization", completed: false }),
    ).toEqual([
      "visualization",
      "self_concept_map",
      "image_analysis",
      "ai_concept_map",
      "sentence_scaffold",
      "posttest",
    ]);
    expect(
      overrideRedoesStages({ from: "pretest", to: "pretest", completed: false }),
    ).toHaveLength(7);
  });

  it("keeps work when skipping forward, but not when reopening a completed session", async () => {
    const { overrideRedoesStages } = await import("@/lib/domain/stage-override");
    expect(
      overrideRedoesStages({ from: "pretest", to: "self_concept_map", completed: false }),
    ).toEqual([]);
    expect(
      overrideRedoesStages({ from: "posttest", to: "posttest", completed: true }),
    ).toEqual(["posttest"]);
  });
});
