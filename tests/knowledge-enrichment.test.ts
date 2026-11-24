import { describe, expect, it } from "vitest";
import { conceptMapSchema, enrichedConceptMapGenerationSchema } from "@/lib/ai/schemas";
import { conceptExpansionPrompt, imageAnalysisPrompt, sentenceScaffoldPrompt } from "@/lib/ai/prompts";
import { conceptMapWithoutEnrichmentNotes, unconfirmedEnrichmentMap } from "@/lib/domain/concept-enrichment";
import { resolveConceptReview, resolveConceptEdit } from "@/lib/domain/review-decisions";
import { speakingOutlinePrompt } from "@/lib/ai/speaking-outline-prompt";
import { speakingTemplateSelection } from "@/lib/domain/speaking-templates";
import { jiaoxiEnrichmentMap as map } from "./fixtures/knowledge-enrichment";

describe("activity-based knowledge enrichment", () => {
  it("passes the teacher's activity brief even when a custom expansion template omits it", () => {
    const prompt = conceptExpansionPrompt({ taskTitle: "礁溪旅遊", taskDescription: "分享這次旅行的地點與活動，學生作品只寫了去礁溪玩。", studentMap: { attached: true }, acceptedVocabulary: [] }, "老師自訂提示 {{task.title}}");
    expect(prompt).toContain("分享這次旅行的地點與活動");
    expect(prompt).toContain("一般知識");
    expect(prompt).toContain("background_knowledge");
    expect(prompt).toContain("不是對學生經歷的斷言");
    expect(prompt).not.toContain("{{task.description}}");
    expect(imageAnalysisPrompt({ taskTitle: "礁溪旅遊", studentLabels: [] })).toContain("不要標記看不見或只能猜測的物件");
  });

  it("requires explicit nullable provenance in new model output while reading older stored maps", () => {
    expect(enrichedConceptMapGenerationSchema.safeParse(map).success).toBe(true);
    const oldMap = conceptMapWithoutEnrichmentNotes(map);
    expect(conceptMapSchema.safeParse(oldMap).success).toBe(true);
    expect(enrichedConceptMapGenerationSchema.safeParse(oldMap).success).toBe(false);
    const badSource = structuredClone(map);
    badSource.nodes[2].source = "student";
    expect(enrichedConceptMapGenerationSchema.safeParse(badSource).success).toBe(false);
    const missingEdgeMark = structuredClone(map);
    missingEdgeMark.edges[1].enrichment = null;
    expect(enrichedConceptMapGenerationSchema.safeParse(missingEdgeMark).success).toBe(false);
  });

  it("does not let the model mark its own knowledge as student-confirmed", () => {
    const spoofed = structuredClone(map);
    spoofed.nodes[2].enrichment!.confirmedByStudent = true;
    expect(unconfirmedEnrichmentMap(spoofed).nodes[2].enrichment).not.toHaveProperty("confirmedByStudent");
  });

  it("keeps knowledge out of the final map unless the student explicitly retains it", () => {
    const omitted = resolveConceptReview(map, []);
    expect(omitted.accepted.nodes.map(node => node.id)).toEqual(["trip", "jiaoxi"]);
    expect(omitted.accepted.edges.map(edge => edge.id)).toEqual(["destination"]);
    const chosen = resolveConceptReview(map, [], ["hot-spring", "possible-bath"]);
    expect(chosen.accepted.nodes[2]).toMatchObject({ source: "ai", enrichment: { confirmedByStudent: true } });
    expect(chosen.accepted.edges[1].relationEn).toBe("may include");
    expect(chosen.confirmedEnrichmentIds).toEqual(["hot-spring", "possible-bath"]);
    expect(() => resolveConceptReview(map, [], ["jiaoxi"])).toThrow();
    expect(() => resolveConceptReview(map, ["hot-spring"], ["hot-spring"])).toThrow();
  });

  it("preserves the AI origin through manual editing without allowing client provenance injection", () => {
    const accepted = resolveConceptReview(map, [], ["hot-spring", "possible-bath"]).accepted;
    const changed = resolveConceptEdit(accepted, { nodes: accepted.nodes.map(node => ({ ...node, labelEn: node.id === "hot-spring" ? "warm spring bath" : node.labelEn, source: "student" })), edges: accepted.edges });
    expect(changed.nodes[2]).toMatchObject({ source: "ai", edited: true, enrichment: accepted.nodes[2].enrichment });
    expect(changed.edges[1].enrichment).toEqual(accepted.edges[1].enrichment);
  });

  it("uses only selected concepts in speaking stages, without repeating the AI's review questions", () => {
    const accepted = resolveConceptReview(map, [], ["hot-spring", "possible-bath"]).accepted;
    const clean = conceptMapWithoutEnrichmentNotes(accepted);
    expect(JSON.stringify(clean)).not.toContain("questionZh");
    expect(clean.nodes[2].labelEn).toBe("hot spring bath");
    for (const prompt of [speakingOutlinePrompt("礁溪旅遊", accepted, speakingTemplateSelection("spatial")), sentenceScaffoldPrompt({ taskTitle: "礁溪旅遊", finalConceptMap: accepted, studentSentences: ["I went to Jiaoxi."] })]) {
      expect(prompt).toContain("hot spring bath");
      expect(prompt).not.toContain("你這次有泡溫泉嗎");
    }
  });
});
