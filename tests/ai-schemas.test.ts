import { describe, expect, it } from "vitest";
import {
  imageAnalysisSchema,
  speechEvaluationSchema,
  transcriptSchema,
} from "@/lib/ai/schemas";

describe("AI structured outputs", () => {
  it("rejects an out-of-range visual confidence", () => {
    const parsed = imageAnalysisSchema.safeParse({
      sceneSummaryZh: "市場場景",
      uncertaintyNote: "依手繪推測",
      suggestions: [
        {
          id: "one",
          labelEn: "vendor",
          labelZh: "攤販",
          category: "person",
          confidence: 1.2,
          evidence: "圖中人物",
          example: "I talked to a vendor.",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a faithful transcript and conservative evaluation", () => {
    expect(
      transcriptSchema.parse({
        language: "en",
        text: "I went to the market.",
        segments: [
          {
            startSeconds: 0,
            endSeconds: 2.4,
            text: "I went to the market.",
          },
        ],
      }).text,
    ).toContain("market");

    expect(
      speechEvaluationSchema.parse({
        contentUnits: 1,
        wordsPerMinute: 75,
        pauseCount: 0,
        vocabularyHighlights: ["market"],
        organizationFeedbackZh: "已表達一個主要事件。",
        nextStepZh: "加入事件發生順序。",
      }).contentUnits,
    ).toBe(1);
  });
});
