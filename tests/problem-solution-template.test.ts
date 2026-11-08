import { describe, expect, it } from "vitest";
import {
  applySpeakingTemplateInstructions,
  speakingTemplateInstructions,
  speakingTemplateLabel,
  speakingTemplateSchema,
  speakingTemplateSelection,
} from "@/lib/domain/speaking-templates";
import { DEFAULT_TASK_CONFIG, normalizeTaskConfig } from "@/lib/domain/default-task";
import { conceptMapSignature, microMap, outlineGenerationSchema, validSpeakingOutline } from "@/lib/domain/speaking-outline";
import { speakingOutlinePrompt } from "@/lib/ai/speaking-outline-prompt";
import { conceptExpansionPrompt, imageAnalysisPrompt, sentenceScaffoldPrompt } from "@/lib/ai/prompts";
import { promptAuditCatalog } from "@/lib/ai/prompt-audit";
import { causalMap, causalSections, problemSolutionMap as map, problemSolutionSections as sections, problemSolutionOriginals } from "./fixtures/problem-solution";

const template = speakingTemplateSelection("problem_solution")!;

describe("cause and effect / problem-solution template", () => {
  it("accepts the third template and changes only default stage instructions", () => {
    expect(speakingTemplateSchema.parse(template)).toEqual({ id: "problem_solution", version: "1.0.0" });
    expect(speakingTemplateLabel(template)).toBe("因果／問題解決順序");
    const current = applySpeakingTemplateInstructions(DEFAULT_TASK_CONFIG.stageConfig, "chronological");
    current.visualization.instruction = "請畫出自己觀察到的回收情境。";
    const next = applySpeakingTemplateInstructions(current, "problem_solution", speakingTemplateInstructions("chronological"));
    expect(next.visualization.instruction).toBe(current.visualization.instruction);
    expect(next.ai_concept_map.instruction).toContain("預期成效與已觀察結果");
    expect(next.pretest.minimumRecordingSeconds).toBe(30);
    for (const stage of ["pretest", "posttest"] as const) {
      expect(next[stage].instruction).not.toMatch(/大稻埕|Because|As a result|成因|解決策略|→/);
    }
    const config = normalizeTaskConfig({ ...DEFAULT_TASK_CONFIG, speakingTemplate: template });
    expect(JSON.stringify(config.promptConfig)).not.toContain("大稻埕");
  });

  it("requests evidence-based causes and keeps expected effects separate from observed results", () => {
    const prompt = speakingOutlinePrompt("教室垃圾分類", map, template);
    expect(prompt).toContain("problem_solution");
    expect(prompt).toContain("causal");
    expect(prompt).toContain("不是因果證據");
    expect(prompt).toContain("預期成效不能寫成已觀察結果");
    expect(prompt).toContain("不強迫湊滿四段");
    expect(prompt).toContain("不要硬加學生未提供的解決策略");
    expect(prompt).toContain("不得將缺少解法列入 informationGaps");
    expect(prompt).toContain("informationGaps");
    for (const prompt of [
      imageAnalysisPrompt({ taskTitle: "垃圾分類", studentLabels: [], speakingTemplate: template }),
      conceptExpansionPrompt({ taskTitle: "垃圾分類", studentMap: {}, acceptedVocabulary: [], speakingTemplate: template }),
    ]) {
      expect(prompt).toContain("不能只憑圖片推斷成因");
      expect(prompt).toContain("預期成效與已觀察結果");
    }
    const hints = sentenceScaffoldPrompt({ taskTitle: "垃圾分類", finalConceptMap: map, studentSentences: problemSolutionOriginals, speakingOutline: { sections, organization: "problem_solution" }, speakingTemplate: template });
    expect(hints).toContain("已確認因果才用 Because");
    expect(hints).toContain("This could help …");
    expect(hints).toContain("已有觀察證據的結果才用 The result was …");
    expect(hints).toContain("逐句提示、示範改寫、翻譯與 transitions");
  });

  it.each([
    { organization: "problem_solution", map, sections },
    { organization: "causal", map: causalMap, sections: causalSections },
  ])("validates $organization without forcing a fixed four-part outline", ({ organization, map, sections }) => {
    const schema = outlineGenerationSchema(map, template);
    expect(schema.safeParse({ sections, organization, informationGaps: [] }).success).toBe(true);
    expect(schema.safeParse({ sections, organization }).success).toBe(false);
    expect(schema.safeParse({ sections, organization: "procedural", informationGaps: [] }).success).toBe(false);
    expect(schema.safeParse({ sections: sections.map(section => ({ ...section, nodeIds: ["invented-cause"] })), organization, informationGaps: [] }).success).toBe(false);
  });

  it("preserves the direction and uncertainty of the approved Micro relationships", () => {
    expect(microMap(map, sections[1]).edges).toEqual([map.edges[1]]);
    const expected = microMap(map, sections[3]);
    expect(expected.edges).toEqual([map.edges[3]]);
    expect(expected.edges[0].relationEn).toBe("may improve");
    expect(expected.nodes.map(node => node.id)).toEqual(["new-labels", "clearer-sorting"]);
  });

  it("rejects mismatched historical templates and malformed saved organization", () => {
    const data = { sections, sourceMapSignature: conceptMapSignature(map), speakingTemplate: template, organization: "problem_solution", informationGaps: [] };
    expect(validSpeakingOutline(data, map, template)).not.toBeNull();
    expect(validSpeakingOutline(data, map, speakingTemplateSelection("chronological"))).toBeNull();
    expect(validSpeakingOutline({ ...data, organization: "procedural" }, map, template)).toBeNull();
    expect(validSpeakingOutline({ ...data, speakingTemplate: { ...template, version: "2.0.0" } }, map, template)).toBeNull();
  });

  it("includes causal contracts in the teacher audit while keeping pre/post analysis unchanged", () => {
    const audit = promptAuditCatalog(DEFAULT_TASK_CONFIG.promptConfig, template);
    expect(audit.stages.find(stage => stage.id === "ai_concept_map")?.calls.find(call => call.id === "speaking_outline")?.userPromptTemplate).toContain("不是因果證據");
    expect(audit.stages.find(stage => stage.id === "sentence_scaffold")?.calls.find(call => call.id === "sentence_scaffold")?.providerNote).toContain("This could help");
    const legacy = promptAuditCatalog();
    for (const stage of ["pretest", "posttest"] as const) {
      expect(audit.stages.find(item => item.id === stage)?.calls).toEqual(legacy.stages.find(item => item.id === stage)?.calls);
    }
  });
});
