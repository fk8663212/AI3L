import { describe, expect, it } from "vitest";
import {
  applySpeakingTemplateInstructions,
  sameSpeakingTemplate,
  speakingTemplateInstructions,
  speakingTemplateSelection,
} from "@/lib/domain/speaking-templates";
import {
  DEFAULT_TASK_CONFIG,
  normalizeTaskConfig,
} from "@/lib/domain/default-task";
import {
  conceptMapSignature,
  outlineGenerationSchema,
  validSpeakingOutline,
} from "@/lib/domain/speaking-outline";
import { speakingOutlinePrompt } from "@/lib/ai/speaking-outline-prompt";
import {
  conceptExpansionPrompt,
  imageAnalysisPrompt,
  sentenceScaffoldPrompt,
} from "@/lib/ai/prompts";
import { promptAuditCatalog } from "@/lib/ai/prompt-audit";
import { evaluateStageGate } from "@/lib/domain/stages";
import { stageChecklist } from "@/lib/domain/stage-checklist";
import { conceptMapOutput } from "./flow/fixtures";

const template = speakingTemplateSelection("chronological")!;
const map = conceptMapOutput();
const sections = [
  {
    id: "making",
    titleZh: "準備與製作",
    titleEn: "Making",
    nodeIds: map.nodes.map((node) => node.id),
  },
];

describe("speaking templates", () => {
  it("leaves unconfigured legacy tasks unclassified", () => {
    const normalized = normalizeTaskConfig(DEFAULT_TASK_CONFIG);
    expect(normalized).not.toHaveProperty("speakingTemplate");
    expect(normalized.promptConfig).toEqual(DEFAULT_TASK_CONFIG.promptConfig);
    expect(normalized.stageConfig).toEqual(DEFAULT_TASK_CONFIG.stageConfig);
  });

  it("changes default instructions while preserving teacher edits and recording limits", () => {
    const spatial = applySpeakingTemplateInstructions(
      DEFAULT_TASK_CONFIG.stageConfig,
      "spatial",
    );
    spatial.visualization.instruction = "請畫出你在實作課親手完成的作品。";
    const next = applySpeakingTemplateInstructions(
      spatial,
      "chronological",
      speakingTemplateInstructions("spatial"),
    );
    expect(next.visualization.instruction).toBe(
      spatial.visualization.instruction,
    );
    expect(next.self_concept_map.instruction).toContain("先後");
    expect(next.pretest.minimumRecordingSeconds).toBe(30);
    for (const stage of ["pretest", "posttest"] as const) {
      expect(next[stage].instruction).not.toMatch(
        /大稻埕|First|Next|Finally|核心步驟|準備工作|→/,
      );
    }
  });

  it("generalizes only unchanged task prompts and retains teacher-defined prompts", () => {
    const custom = "這是老師自訂的大稻埕情境研究提示，不得改寫。";
    const config = normalizeTaskConfig({
      ...DEFAULT_TASK_CONFIG,
      speakingTemplate: template,
    });
    expect(JSON.stringify(config.promptConfig)).not.toContain("大稻埕");
    expect(
      normalizeTaskConfig({
        ...config,
        promptConfig: { ...config.promptConfig, baseSystemPrompt: custom },
      }).promptConfig.baseSystemPrompt,
    ).toBe(custom);
  });

  it("uses temporal analysis and conditional procedural/historical organization", () => {
    const outline = speakingOutlinePrompt("製作風車", map, template);
    expect(outline).toContain("procedural");
    expect(outline).toContain("chronological");
    expect(outline).toContain("沒有突發狀況就略過");
    expect(outline).toContain("informationGaps");
    expect(outline).toContain("不能把節點陣列順序");
    expect(
      imageAnalysisPrompt({
        taskTitle: "風車",
        studentLabels: [],
        speakingTemplate: template,
      }),
    ).toContain("不能由圖片左右位置推斷時間");
    expect(
      conceptExpansionPrompt({
        taskTitle: "風車",
        studentMap: {},
        acceptedVocabulary: [],
        speakingTemplate: template,
      }),
    ).toContain("動作");
    const hints = sentenceScaffoldPrompt({
      taskTitle: "風車",
      finalConceptMap: map,
      studentSentences: ["I made a windmill."],
      speakingOutline: { sections },
      speakingTemplate: template,
    });
    expect(hints).toContain("First、Next、Then、Finally");
    expect(hints).toContain("不得補出學生未提供");
  });

  it("requires structured gap notes and organization, and validates approved node references", () => {
    const schema = outlineGenerationSchema(map, template);
    expect(schema.safeParse({ sections }).success).toBe(false);
    expect(
      schema.safeParse({
        sections,
        organization: "procedural",
        informationGaps: [],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        sections: [{ ...sections[0], nodeIds: ["invented"] }],
        organization: "procedural",
        informationGaps: [],
      }).success,
    ).toBe(false);
  });

  it("matches template versions without relabeling historical outlines", () => {
    const legacy = { sections, sourceMapSignature: conceptMapSignature(map) };
    const current = {
      ...legacy,
      speakingTemplate: template,
      organization: "procedural",
      informationGaps: [],
    };
    expect(validSpeakingOutline(legacy, map, template)).toBeNull();
    expect(validSpeakingOutline(current, map, null)).toBeNull();
    expect(validSpeakingOutline(current, map, template)).not.toBeNull();
    expect(validSpeakingOutline(current, map)).not.toBeNull(); // Read-only history.
    expect(
      sameSpeakingTemplate(template, { ...template, version: "2.0.0" }),
    ).toBe(false);
  });

  it("audits the same template contracts without adding hints to pre/post speech analysis", () => {
    const audit = promptAuditCatalog(
      DEFAULT_TASK_CONFIG.promptConfig,
      template,
    );
    expect(
      audit.stages
        .find((stage) => stage.id === "ai_concept_map")
        ?.calls.find((call) => call.id === "speaking_outline")
        ?.userPromptTemplate,
    ).toContain("procedural");
    expect(
      audit.stages
        .find((stage) => stage.id === "sentence_scaffold")
        ?.calls.find((call) => call.id === "sentence_scaffold")?.providerNote,
    ).toContain("First、Next");
    const legacy = promptAuditCatalog();
    for (const stage of ["pretest", "posttest"] as const) {
      expect(audit.stages.find((item) => item.id === stage)?.calls).toEqual(
        legacy.stages.find((item) => item.id === stage)?.calls,
      );
    }
  });

  it("requires a current template outline in both server gates and student checklist", () => {
    const evidence = {
      audioCount: 1,
      imageCount: 1,
      selfLabelCount: 3,
      pendingVocabularyDecisions: 0,
      pendingConceptDecisions: 0,
      sentenceCount: 3,
      aiOutputReady: true,
      annotatedImageReady: true,
    };
    expect(evaluateStageGate("ai_concept_map", evidence).ok).toBe(true);
    for (const stage of ["ai_concept_map", "sentence_scaffold"] as const) {
      expect(
        evaluateStageGate(stage, {
          ...evidence,
          speakingOutlineRequired: true,
          speakingOutlineReady: false,
        }).code,
      ).toBe("OUTLINE_REQUIRED");
    }
    const artifacts = [
      {
        id: "map",
        stageId: "ai_concept_map" as const,
        type: "concept_decisions",
        data: { accepted: map, pending: [] },
      },
      {
        id: "outline",
        stageId: "ai_concept_map" as const,
        type: "speaking_outline",
        data: {
          sections,
          sourceMapSignature: conceptMapSignature(map),
          speakingTemplate: template,
          organization: "procedural",
          informationGaps: [],
        },
      },
    ];
    const checklist = stageChecklist("ai_concept_map", artifacts, {
      speakingTemplate: template,
    });
    expect(checklist.at(-1)?.done).toBe(true);
    expect(
      stageChecklist("ai_concept_map", artifacts.slice(0, 1), {
        speakingTemplate: template,
      }).at(-1)?.done,
    ).toBe(false);
  });
});
