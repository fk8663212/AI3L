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
