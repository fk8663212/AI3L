import { describe, expect, it } from "vitest";
import { normalizeImageAnalysisOutput } from "@/lib/ai/normalize";
import { imageAnalysisGenerationSchema } from "@/lib/ai/schemas";

const good = {
  id: "kite",
  labelEn: "kite",
  labelZh: "風箏",
  category: "object",
  confidence: 0.9,
  evidence: "A diamond shape on a string.",
  example: "I fly a kite.",
  region: { x: 100, y: 120, width: 200, height: 180 },
};

describe("normalizeImageAnalysisOutput", () => {
  it("repairs out-of-range numbers instead of failing the whole analysis", () => {
    const raw = {
      sceneSummaryZh: "海邊放風箏",
      uncertaintyNote: "",
      suggestions: [
        { ...good, confidence: 85, region: { x: -5, y: 990, width: 0, height: 400 } },
        { ...good, id: "kite", labelEn: "sun", confidence: "0.4" },
      ],
    };
    expect(imageAnalysisGenerationSchema.safeParse(raw).success).toBe(false);

    const parsed = imageAnalysisGenerationSchema.parse(normalizeImageAnalysisOutput(raw));
    expect(parsed.suggestions[0].confidence).toBe(0.85);
    expect(parsed.suggestions[0].region).toEqual({ x: 0, y: 990, width: 1, height: 10 });
    expect(parsed.suggestions[1].confidence).toBe(0.4);
    // Duplicate ids would break the per-word review.
    expect(new Set(parsed.suggestions.map((item) => item.id)).size).toBe(2);
  });

  it("fills missing text, drops unlabeled items and keeps at most 20", () => {
    const raw = {
      sceneSummaryZh: "場景",
      uncertaintyNote: "",
      suggestions: [
        { labelEn: "dog", labelZh: "狗", region: { x: 1, y: 1, width: 5, height: 5 } },
        { labelEn: "", labelZh: "空" },
        ...Array.from({ length: 30 }, (_, index) => ({ ...good, id: `n${index}` })),
      ],
    };
    const parsed = imageAnalysisGenerationSchema.parse(normalizeImageAnalysisOutput(raw));
    expect(parsed.suggestions).toHaveLength(20);
    expect(parsed.suggestions[0]).toMatchObject({ id: "s1", category: "object", confidence: 0.5 });
    expect(parsed.suggestions[0].example.length).toBeGreaterThan(0);
  });

  it("still fails when there is nothing usable", () => {
    const raw = { sceneSummaryZh: "", uncertaintyNote: "", suggestions: [{ labelEn: "" }] };
    expect(imageAnalysisGenerationSchema.safeParse(normalizeImageAnalysisOutput(raw)).success).toBe(false);
  });
});
