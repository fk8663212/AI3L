import type { ConceptMap } from "@/lib/ai/schemas";

export class ReviewDecisionError extends Error {
  constructor(
    public readonly code: "UNKNOWN_REVIEW_ITEM" | "DUPLICATE_REVIEW_ITEM" | "EDIT_LABEL_REQUIRED",
    message: string,
  ) {
    super(message);
  }
}

type Suggestion = { id: string; labelEn: string; labelZh: string };

export type VocabularyDecisionInput = {
  id: string;
  status: "accepted" | "edited" | "rejected";
  labelEn?: string;
  labelZh?: string;
};

export type ResolvedVocabularyDecision = {
  id: string;
  status: "accepted" | "edited" | "rejected";
  labelEn: string;
  labelZh: string;
};

/**
 * Resolves a student's vocabulary review against the AI suggestions stored on
 * the server. Only suggestion ids the AI actually produced are accepted, and
 * any suggestion without a decision stays pending so the stage gate holds.
 */
export function resolveVocabularyReview(
  suggestions: readonly Suggestion[],
  decisions: readonly VocabularyDecisionInput[],
) {
  const byId = new Map(suggestions.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const resolved: ResolvedVocabularyDecision[] = [];

  for (const decision of decisions) {
    const suggestion = byId.get(decision.id);
    if (!suggestion) {
      throw new ReviewDecisionError(
        "UNKNOWN_REVIEW_ITEM",
        "審核內容包含不存在的 AI 詞彙建議，請重新整理後再試。",
      );
    }
    if (seen.has(decision.id)) {
      throw new ReviewDecisionError(
        "DUPLICATE_REVIEW_ITEM",
        "同一個詞彙建議只能審核一次。",
      );
    }
    seen.add(decision.id);

    if (decision.status === "edited") {
      const labelEn = decision.labelEn?.trim() ?? "";
      if (!labelEn) {
        throw new ReviewDecisionError(
          "EDIT_LABEL_REQUIRED",
          "修改後的英文詞彙不可為空白。",
        );
      }
      resolved.push({
        id: decision.id,
        status: "edited",
        labelEn,
        labelZh: decision.labelZh?.trim() || suggestion.labelZh,
      });
    } else {
      resolved.push({
        id: decision.id,
        status: decision.status,
        labelEn: suggestion.labelEn,
        labelZh: suggestion.labelZh,
      });
    }
  }

  return {
    pending: suggestions
      .map((item) => item.id)
      .filter((id) => !seen.has(id)),
    accepted: resolved.filter((item) => item.status !== "rejected"),
    rejected: resolved.filter((item) => item.status === "rejected"),
  };
}

/**
 * Rebuilds the accepted concept map from the server's generated map. The
 * client only says which AI-added items to reject; it cannot inject nodes or
 * edges that the AI never proposed.
 */
export function resolveConceptReview(
  generated: ConceptMap,
  rejectedIds: readonly string[],
) {
  const aiItemIds = new Set(
    [...generated.nodes, ...generated.edges]
      .filter((item) => item.source === "ai")
      .map((item) => item.id),
  );
  const rejected = new Set<string>();
  for (const id of rejectedIds) {
    if (!aiItemIds.has(id)) {
      throw new ReviewDecisionError(
        "UNKNOWN_REVIEW_ITEM",
        "只能拒絕 AI 新增的概念或關係，請重新整理後再試。",
      );
    }
    rejected.add(id);
  }

  const nodes = generated.nodes.filter((node) => !rejected.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = generated.edges.filter(
    (edge) =>
      !rejected.has(edge.id) && nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );

  return {
    pending: [] as string[],
    accepted: { nodes, edges },
    rejectedIds: [...rejected],
  };
}

export class ConceptEditError extends Error {
  constructor(
    public readonly code: "REVIEW_REQUIRED" | "INVALID_CONCEPT_MAP",
    message: string,
  ) {
    super(message);
  }
}

export type ConceptEditInput = {
  nodes: ReadonlyArray<{
    id: string;
    labelEn: string;
    labelZh?: string;
    category?: string;
    x?: number;
    y?: number;
  }>;
  edges: ReadonlyArray<{
    id: string;
    from: string;
    to: string;
    relationEn: string;
    relationZh?: string;
  }>;
};

const CATEGORIES = ["person", "object", "event", "place", "feeling", "quality"] as const;
type Category = (typeof CATEGORIES)[number];
const ID_PATTERN = /^[\w-]{1,64}$/u;
export const MAX_EDITED_NODES = 40;
export const MAX_EDITED_EDGES = 80;

function clampPercent(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)) * 10) / 10
    : undefined;
}

/**
 * Applies a student's edits to their reviewed concept map. The client sends
 * the whole map; the server decides provenance: an item that came from the
 * reviewed map keeps its source (student or AI) and is flagged "edited" when
 * its wording changed, and anything new is the student's own.
 */
export function resolveConceptEdit(reviewed: ConceptMap, input: ConceptEditInput): ConceptMap {
  const fail = (message: string): never => {
    throw new ConceptEditError("INVALID_CONCEPT_MAP", message);
  };
  if (input.nodes.length > MAX_EDITED_NODES) fail(`概念最多 ${MAX_EDITED_NODES} 個。`);
  if (input.edges.length > MAX_EDITED_EDGES) fail(`關係最多 ${MAX_EDITED_EDGES} 條。`);

  const baseNodes = new Map(reviewed.nodes.map((node) => [node.id, node]));
  const baseEdges = new Map(reviewed.edges.map((edge) => [edge.id, edge]));
  const nodeIds = new Set<string>();

  const nodes = input.nodes.map((node) => {
    if (!ID_PATTERN.test(node.id) || nodeIds.has(node.id)) fail("概念的識別碼不正確，請重新整理後再試。");
    nodeIds.add(node.id);
    const labelEn = node.labelEn.trim();
    if (!labelEn) fail("每個概念都要有英文。");
    const base = baseNodes.get(node.id);
    const labelZh = node.labelZh?.trim() || base?.labelZh || labelEn;
    const category: Category = CATEGORIES.includes(node.category as Category)
      ? (node.category as Category)
      : (base?.category ?? "object");
    const edited =
      !base || base.labelEn !== labelEn || base.labelZh !== labelZh || base.category !== category;
    return {
      id: node.id,
      labelEn,
      labelZh,
      category,
      source: base?.source ?? ("student" as const),
      x: clampPercent(node.x),
      y: clampPercent(node.y),
      ...(base && edited ? { edited: true } : {}),
    };
  });

  const edgeIds = new Set<string>();
  const edges = input.edges.map((edge) => {
    if (!ID_PATTERN.test(edge.id) || edgeIds.has(edge.id)) fail("關係的識別碼不正確，請重新整理後再試。");
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail("每條關係都要連到圖上的概念。");
    if (edge.from === edge.to) fail("關係不能連回同一個概念。");
    const relationEn = edge.relationEn.trim();
    if (!relationEn) fail("每條關係都要有英文關係詞。");
    const base = baseEdges.get(edge.id);
    const relationZh = edge.relationZh?.trim() || base?.relationZh || relationEn;
    const edited =
      !base ||
      base.relationEn !== relationEn ||
      base.relationZh !== relationZh ||
      base.from !== edge.from ||
      base.to !== edge.to;
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      relationEn,
      relationZh,
      source: base?.source ?? ("student" as const),
      ...(base && edited ? { edited: true } : {}),
    };
  });

  return { nodes, edges };
}
