import { describe, expect, it } from "vitest";
import { z } from "zod";
import { googleResponseJsonSchema } from "@/lib/ai/provider";
import {
  annotatedImageSchema,
  generatedConceptMapSchema,
  imageAnalysisGenerationSchema,
  imageAnalysisSchema,
  speechEvaluationSchema,
  transcriptSchema,
} from "@/lib/ai/schemas";

describe("AI structured outputs", () => {
  it("removes JSON Schema keywords unsupported by Gemini", () => {
    const schema = googleResponseJsonSchema(
      imageAnalysisGenerationSchema,
    ) as Record<string, unknown>;
    const serialized = JSON.stringify(schema);

    expect(serialized).not.toContain('"$schema"');
    expect(serialized).not.toContain('"minLength"');
    expect(serialized).toContain('"minItems":1');
    expect(serialized).toContain('"minimum":0');
    expect(serialized).toContain('"additionalProperties":false');

    const transcript = JSON.stringify(
      googleResponseJsonSchema(z.object({ language: z.literal("en") })),
    );
    expect(transcript).not.toContain('"const"');
    expect(transcript).toContain('"enum":["en"]');
  });

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

  it("requires bounded coordinates for the AI-annotated drawing", () => {
    const generated = imageAnalysisGenerationSchema.parse({
      sceneSummaryZh: "市場場景",
      uncertaintyNote: "依手繪內容辨識",
      suggestions: [
        {
          id: "vendor-1",
          labelEn: "vendor",
          labelZh: "攤販",
          category: "person",
          confidence: 0.91,
          evidence: "圖面左側的人物",
          example: "The vendor sells New Year goods.",
          region: { x: 80, y: 120, width: 240, height: 520 },
        },
      ],
    });

    expect(
      annotatedImageSchema.parse({
        sourceImageArtifactId: "6f7a3ccb-56a0-4f2c-8f9d-197fcc35a39c",
        annotations: generated.suggestions,
      }).annotations[0].region.width,
    ).toBe(240);

    expect(() =>
      imageAnalysisGenerationSchema.parse({
        ...generated,
        suggestions: [
          {
            ...generated.suggestions[0],
            region: { x: 1001, y: 0, width: 20, height: 20 },
          },
        ],
      }),
    ).toThrow();
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

  it("requires a generated concept map rather than a vocabulary list", () => {
    expect(() =>
      generatedConceptMapSchema.parse({
        nodes: [
          {
            id: "market",
            labelEn: "market",
            labelZh: "市場",
            category: "place",
            source: "student",
          },
        ],
        edges: [],
      }),
    ).toThrow();
  });
});
