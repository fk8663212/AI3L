import { describe, expect, it } from "vitest";
import { promptAuditCatalog } from "@/lib/ai/prompt-audit";
import {
  DEFAULT_TASK_PROMPT_CONFIG,
  LEGACY_TYPED_CONCEPT_EXPANSION_PROMPT_TEMPLATE,
  conceptExpansionPrompt,
  imageAnalysisPrompt,
  sentenceScaffoldPrompt,
  speechEvaluationPrompt,
  speechTranscriptionPrompt,
} from "@/lib/ai/prompts";
import {
  DEFAULT_TASK_CONFIG,
  normalizeTaskConfig,
} from "@/lib/domain/default-task";

describe("prompt audit catalog", () => {
  it("covers all seven research stages and their AI calls", () => {
    const catalog = promptAuditCatalog();

    expect(catalog.stages).toHaveLength(7);
    expect(
      catalog.stages.find((stage) => stage.id === "visualization")?.calls,
    ).toHaveLength(1);
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
      imageAnalysisPrompt({
        taskTitle: "Market story",
        studentLabels: [],
      }),
    ).toContain("10 至 16");

    expect(
      conceptExpansionPrompt({
        taskTitle: "Market story",
        studentMap: { nodes: ["market"] },
        acceptedVocabulary: ["lantern"],
      }),
    ).toContain('{"nodes":["market"]}');
    expect(
      conceptExpansionPrompt({
        taskTitle: "Market story",
        studentMap: { format: "hand-drawn-image", attached: true },
        acceptedVocabulary: ["lantern"],
      }),
    ).toContain("手繪概念圖圖片");

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

  it("uses task-specific templates in both runtime and audit views", () => {
    const promptConfig = {
      ...DEFAULT_TASK_PROMPT_CONFIG,
      baseSystemPrompt: "Custom research system prompt.",
      imageAnalysisTemplate:
        "Custom image task: {{task.title}} / {{student.labels}}",
    };
    const catalog = promptAuditCatalog(promptConfig);
    const imageCall = catalog.stages.find(
      (stage) => stage.id === "image_analysis",
    )?.calls[0];

    expect(catalog.baseSystemPrompt).toBe("Custom research system prompt.");
    expect(imageCall?.userPromptTemplate).toContain(
      promptConfig.imageAnalysisTemplate,
    );
    expect(imageCall?.userPromptTemplate).toContain("固定研究輸出契約");
    expect(
      imageAnalysisPrompt(
        { taskTitle: "Pilot", studentLabels: ["crowd"] },
        promptConfig.imageAnalysisTemplate,
      ),
    ).toContain("Custom image task: Pilot / crowd");
    expect(
      imageAnalysisPrompt(
        { taskTitle: "Pilot", studentLabels: ["crowd"] },
        promptConfig.imageAnalysisTemplate,
      ),
    ).toContain("固定研究輸出契約");
  });

  it("backfills prompt defaults for tasks created before editable prompts", () => {
    const legacyConfig = {
      locale: DEFAULT_TASK_CONFIG.locale,
      targetLanguage: DEFAULT_TASK_CONFIG.targetLanguage,
      consentText: DEFAULT_TASK_CONFIG.consentText,
      retentionDays: DEFAULT_TASK_CONFIG.retentionDays,
      stageConfig: DEFAULT_TASK_CONFIG.stageConfig,
    };
    const normalized = normalizeTaskConfig(legacyConfig);

    expect(normalized.promptConfig).toEqual(DEFAULT_TASK_PROMPT_CONFIG);
    expect(normalized.stageConfig).toEqual(DEFAULT_TASK_CONFIG.stageConfig);
  });

  it("migrates the former typed concept-map defaults to hand-drawn input", () => {
    const normalized = normalizeTaskConfig({
      ...DEFAULT_TASK_CONFIG,
      promptConfig: {
        ...DEFAULT_TASK_PROMPT_CONFIG,
        conceptExpansionTemplate:
          LEGACY_TYPED_CONCEPT_EXPANSION_PROMPT_TEMPLATE,
      },
      stageConfig: {
        ...DEFAULT_TASK_CONFIG.stageConfig,
        self_concept_map: {
          instruction:
            "先不用 AI，整理至少三個概念，並寫出至少兩個概念之間的英文關係。",
        },
      },
    });

    expect(normalized.stageConfig.self_concept_map.instruction).toContain(
      "紙上手繪",
    );
    expect(normalized.promptConfig.conceptExpansionTemplate).toContain(
      "手繪圖片附件",
    );
  });
});
