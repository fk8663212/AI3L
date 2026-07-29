import { describe, expect, it } from "vitest";
import { promptAuditCatalog } from "@/lib/ai/prompt-audit";
import {
  conceptExpansionPrompt,
  imageAnalysisPrompt,
  sentenceScaffoldPrompt,
  speechEvaluationPrompt,
  speechTranscriptionPrompt,
} from "@/lib/ai/prompts";

describe("prompt audit catalog", () => {
  it("covers all seven research stages and their AI calls", () => {
    const catalog = promptAuditCatalog();

    expect(catalog.stages).toHaveLength(7);
    expect(
      catalog.stages.find((stage) => stage.id === "visualization")?.calls,
    ).toHaveLength(0);
    expect(
      catalog.stages.find((stage) => stage.id === "sentence_scaffold")?.calls,
    ).toHaveLength(3);
    expect(
      catalog.stages.find((stage) => stage.id === "posttest")?.calls,
    ).toHaveLength(2);
  });

  it("makes the task-description boundary explicit", () => {
    const catalog = promptAuditCatalog();
    const serializedTemplates = JSON.stringify(catalog.stages);

    expect(catalog.contextPolicy.excluded).toContain(
      "任務摘要 task.description",
    );
    expect(serializedTemplates).not.toContain("{{task.description}}");
    expect(serializedTemplates).toContain("{{task.title}}");
  });

  it("renders runtime prompts from the audited templates", () => {
    expect(
      imageAnalysisPrompt({
        taskTitle: "Market story",
        studentLabels: ["lantern", "crowd"],
      }),
    ).toContain("任務：Market story");

    expect(
      conceptExpansionPrompt({
        taskTitle: "Market story",
        studentMap: { nodes: ["market"] },
        acceptedVocabulary: ["lantern"],
      }),
    ).toContain('{"nodes":["market"]}');

    expect(
      sentenceScaffoldPrompt({
        taskTitle: "Market story",
        finalConceptMap: { nodes: ["market"] },
        studentSentences: ["I saw a crowd."],
      }),
    ).toContain('["I saw a crowd."]');

    expect(speechTranscriptionPrompt(42)).toContain("42 seconds");
    expect(
      speechEvaluationPrompt({
        stage: "posttest",
        transcript: "I visited the market.",
        durationSeconds: 30,
        wordsPerMinute: 10,
      }),
    ).toContain("posttest");
  });
});
