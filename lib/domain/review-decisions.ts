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
