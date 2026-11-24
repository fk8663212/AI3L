import { knowledgeEnrichmentSchema, type ConceptMap } from "@/lib/ai/schemas";

export const CONCEPT_ENRICHMENT_POLICY = "topic-knowledge-v1";

/** A model cannot claim that its suggestions have already been confirmed. */
export function unconfirmedEnrichmentMap(map: ConceptMap): ConceptMap {
  const pending = <T extends ConceptMap["nodes"][number] | ConceptMap["edges"][number]>(item: T): T => {
    if (!item.enrichment) return item;
    if (item.source !== "ai") throw new Error("背景補述不能當作學生原有內容。");
    return { ...item, enrichment: knowledgeEnrichmentSchema.parse(item.enrichment) };
  };
  return { nodes: map.nodes.map(pending), edges: map.edges.map(pending) };
}

/** Later speaking stages use chosen concepts, not the AI's review questions. */
export function conceptMapWithoutEnrichmentNotes(map: ConceptMap): ConceptMap {
  const clean = <T extends ConceptMap["nodes"][number] | ConceptMap["edges"][number]>(item: T) => {
    const { enrichment, ...content } = item;
    void enrichment;
    return content;
  };
  return { nodes: map.nodes.map(clean), edges: map.edges.map(clean) };
}
