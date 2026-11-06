import { randomUUID } from "node:crypto";
import sharp from "sharp";

export const imageAnalysisOutput = () => ({
  sceneSummaryZh: "海邊放風箏",
  suggestions: ["kite", "beach", "wind"].map((word, index) => ({
    id: `v-${randomUUID()}`,
    labelEn: word,
    labelZh: word,
    category: "object" as const,
    confidence: 0.9,
    evidence: "drawing",
    example: `I see a ${word}.`,
    region: { x: 100 * index, y: 100, width: 200, height: 200 },
  })),
  uncertaintyNote: "",
});

export const conceptMapOutput = () => {
  const suffix = randomUUID().slice(0, 8);
  return {
    nodes: [
      { id: `n1-${suffix}`, labelEn: "kite", labelZh: "風箏", category: "object" as const, source: "student" as const },
      { id: `n2-${suffix}`, labelEn: "wind", labelZh: "風", category: "object" as const, source: "ai" as const },
      { id: `n3-${suffix}`, labelEn: "beach", labelZh: "海灘", category: "place" as const, source: "ai" as const },
    ],
    edges: [
      { id: `e1-${suffix}`, from: `n2-${suffix}`, to: `n1-${suffix}`, relationEn: "lifts", relationZh: "吹起", source: "ai" as const },
      { id: `e2-${suffix}`, from: `n1-${suffix}`, to: `n3-${suffix}`, relationEn: "flies over", relationZh: "飛過", source: "ai" as const },
    ],
  };
};

export const sentenceScaffoldOutput = () => ({
  sentences: [0, 1, 2].map((index) => ({
    index,
    original: "model text that the server must replace",
    question: "你在哪裡做這件事？",
    keywords: [{ word: "beach", translation: "海灘" }],
    frame: "I ___ on the ___.",
    example: { sentence: "I fly a red kite on the beach.", translation: "我在海灘放紅色風箏。" },
  })),
  transitions: ["First", "Then"],
});

let cachedPng: Buffer | undefined;
export async function tinyPng(): Promise<Buffer> {
  cachedPng ??= await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  return cachedPng;
}
