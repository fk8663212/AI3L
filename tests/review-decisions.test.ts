import { describe, expect, it } from "vitest";
import {
  ReviewDecisionError,
  resolveConceptReview,
  resolveVocabularyReview,
} from "@/lib/domain/review-decisions";
import type { ConceptMap } from "@/lib/ai/schemas";

const suggestions = [
  { id: "s1", labelEn: "kite", labelZh: "風箏" },
  { id: "s2", labelEn: "beach", labelZh: "海灘" },
  { id: "s3", labelEn: "happy", labelZh: "開心" },
];

describe("resolveVocabularyReview", () => {
  it("keeps undecided suggestions pending so the gate stays closed", () => {
    const review = resolveVocabularyReview(suggestions, [
      { id: "s1", status: "accepted" },
    ]);
    expect(review.pending).toEqual(["s2", "s3"]);
  });

  it("uses server labels for accepted items and trimmed client labels for edits", () => {
    const review = resolveVocabularyReview(suggestions, [
      { id: "s1", status: "accepted", labelEn: "injected", labelZh: "x" },
      { id: "s2", status: "edited", labelEn: "  sand  ", labelZh: "" },
      { id: "s3", status: "rejected" },
    ]);
    expect(review.pending).toEqual([]);
    expect(review.accepted).toEqual([
      { id: "s1", status: "accepted", labelEn: "kite", labelZh: "風箏" },
      { id: "s2", status: "edited", labelEn: "sand", labelZh: "海灘" },
    ]);
    expect(review.rejected.map((item) => item.id)).toEqual(["s3"]);
  });

  it.each([
    [[{ id: "nope", status: "accepted" as const }], "UNKNOWN_REVIEW_ITEM"],
    [
      [
        { id: "s1", status: "accepted" as const },
        { id: "s1", status: "rejected" as const },
      ],
      "DUPLICATE_REVIEW_ITEM",
    ],
    [[{ id: "s1", status: "edited" as const, labelEn: " " }], "EDIT_LABEL_REQUIRED"],
  ])("rejects invalid decisions (%#)", (decisions, code) => {
    expect(() => resolveVocabularyReview(suggestions, decisions)).toThrow(
      expect.objectContaining({ code }) as ReviewDecisionError,
    );
  });
});

const generated: ConceptMap = {
  nodes: [
    { id: "n1", labelEn: "kite", labelZh: "風箏", category: "object", source: "student" },
    { id: "n2", labelEn: "wind", labelZh: "風", category: "object", source: "ai" },
    { id: "n3", labelEn: "beach", labelZh: "海灘", category: "place", source: "ai" },
  ],
  edges: [
    { id: "e1", from: "n2", to: "n1", relationEn: "lifts", relationZh: "吹起", source: "ai" },
    { id: "e2", from: "n1", to: "n3", relationEn: "flies over", relationZh: "飛過", source: "ai" },
  ],
};

describe("resolveConceptReview", () => {
  it("rebuilds the accepted map from the generated map", () => {
    const review = resolveConceptReview(generated, ["n2"]);
    expect(review.pending).toEqual([]);
    expect(review.accepted.nodes.map((node) => node.id)).toEqual(["n1", "n3"]);
    // e1 depends on the rejected node n2, so it is dropped too.
    expect(review.accepted.edges.map((edge) => edge.id)).toEqual(["e2"]);
    expect(review.rejectedIds).toEqual(["n2"]);
  });

  it("only allows AI-added items to be rejected", () => {
    expect(() => resolveConceptReview(generated, ["n1"])).toThrow(
      ReviewDecisionError,
    );
    expect(() => resolveConceptReview(generated, ["missing"])).toThrow(
      ReviewDecisionError,
    );
  });
});
