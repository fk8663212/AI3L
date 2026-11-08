import type { ConceptMap } from "@/lib/ai/schemas";
import type { SpeakingSection } from "@/lib/domain/speaking-outline";

/** Synthetic teaching example, unrelated to stored student work. */
export const problemSolutionMap: ConceptMap = {
  nodes: [
    { id: "classroom", labelEn: "classroom", labelZh: "教室", category: "place", source: "student" },
    { id: "mixed-waste", labelEn: "mixed waste", labelZh: "垃圾混放", category: "event", source: "student" },
    { id: "unclear-labels", labelEn: "unclear labels", labelZh: "不清楚的標示", category: "quality", source: "student" },
    { id: "new-labels", labelEn: "new labels", labelZh: "新標示", category: "object", source: "student" },
    { id: "bins", labelEn: "recycling bins", labelZh: "回收桶", category: "object", source: "student" },
    { id: "clearer-sorting", labelEn: "clearer sorting", labelZh: "更清楚的分類（預期）", category: "event", source: "ai" },
  ],
  edges: [
    { id: "observed", from: "classroom", to: "mixed-waste", relationEn: "has", relationZh: "有", source: "student" },
    { id: "cause", from: "unclear-labels", to: "mixed-waste", relationEn: "contributes to", relationZh: "促成", source: "student" },
    { id: "action", from: "new-labels", to: "bins", relationEn: "could be placed on", relationZh: "可以貼在", source: "student" },
    { id: "expected", from: "new-labels", to: "clearer-sorting", relationEn: "may improve", relationZh: "可能改善", source: "ai" },
  ],
};

export const problemSolutionSections: SpeakingSection[] = [
  { id: "problem", titleZh: "教室垃圾混放", titleEn: "The problem", nodeIds: ["classroom", "mixed-waste"] },
  { id: "causes", titleZh: "標示與成因", titleEn: "Causes", nodeIds: ["unclear-labels", "mixed-waste"] },
  { id: "actions", titleZh: "改善標示的提案", titleEn: "A proposed action", nodeIds: ["new-labels", "bins"] },
  { id: "outcomes", titleZh: "預期分類改善", titleEn: "Expected improvement", nodeIds: ["new-labels", "clearer-sorting"] },
];

export const problemSolutionOriginals = [
  "There is mixed waste in our classroom.",
  "Unclear labels contribute to mixed waste.",
  "We could put new labels on the bins.",
];

export const problemSolutionHints = [
  { sectionId: "problem", keywords: [{ word: "mixed waste", translation: "垃圾混放" }], sentenceStart: "One problem is …" },
  { sectionId: "causes", keywords: [{ word: "unclear labels", translation: "不清楚的標示" }], sentenceStart: "Because the labels are unclear, …" },
  { sectionId: "actions", keywords: [{ word: "new labels", translation: "新標示" }], sentenceStart: "To solve this problem, we could …" },
  { sectionId: "outcomes", keywords: [{ word: "clearer sorting", translation: "更清楚的分類" }], sentenceStart: "This could help …" },
];

export const causalMap: ConceptMap = {
  nodes: problemSolutionMap.nodes.slice(0, 3),
  edges: problemSolutionMap.edges.slice(0, 2),
};
export const causalSections = problemSolutionSections.slice(0, 2);
