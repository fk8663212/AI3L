import { describe, expect, it } from "vitest";
import {
  conceptMapSignature,
  microMap,
  outlineSchemaForMap,
  validSpeakingOutline,
} from "@/lib/domain/speaking-outline";
import type { ConceptMap } from "@/lib/ai/schemas";
const map: ConceptMap = {
  nodes: [
    {
      id: "shop",
      labelEn: "bakery",
      labelZh: "糕餅店",
      category: "place",
      source: "student",
    },
    {
      id: "cake",
      labelEn: "pineapple cake",
      labelZh: "鳳梨酥",
      category: "object",
      source: "ai",
    },
    {
      id: "gate",
      labelEn: "entrance",
      labelZh: "入口",
      category: "place",
      source: "student",
    },
  ],
  edges: [
    {
      id: "sells",
      from: "shop",
      to: "cake",
      relationEn: "sells",
      relationZh: "販售",
      source: "student",
    },
  ],
};
const sections = [
  { id: "entrance", titleZh: "入口", titleEn: "Entrance", nodeIds: ["gate"] },
  {
    id: "food",
    titleZh: "特色美食",
    titleEn: "Food",
    nodeIds: ["shop", "cake"],
  },
];

describe("content-based Macro / Micro", () => {
  it("keeps exactly the approved nodes and relations of the selected paragraph", () => {
    const micro = microMap(map, sections[1]);
    expect(micro.nodes.map((node) => node.id)).toEqual(["shop", "cake"]);
    expect(micro.edges).toEqual(map.edges);
    expect(microMap(map, sections[0]).edges).toEqual([]);
  });
  it("allows renamed/reordered paragraphs and repeated concepts", () => {
    expect(
      outlineSchemaForMap(map).safeParse({
        sections: [
          sections[1],
          { ...sections[0], titleZh: "最後的回顧", nodeIds: ["gate", "cake"] },
        ],
      }).success,
    ).toBe(true);
  });
  it.each([
    [sections[0]],
    [sections[0], { ...sections[1], nodeIds: ["invented"] }],
    [sections[0], { ...sections[1], id: "entrance" }],
    [sections[0], { ...sections[1], nodeIds: ["shop", "cake", "cake"] }],
  ])(
    "rejects missing, invented or duplicate graph references",
    (...sections) => {
      expect(outlineSchemaForMap(map).safeParse({ sections }).success).toBe(
        false,
      );
    },
  );
  it("invalidates old outlines when content changes, while ignoring layout", () => {
    const data = { sections, sourceMapSignature: conceptMapSignature(map) };
    expect(
      validSpeakingOutline(data, {
        ...map,
        nodes: map.nodes.map((node) => ({ ...node, x: 30, y: 50 })),
      }),
    ).not.toBeNull();
    expect(
      validSpeakingOutline(data, {
        ...map,
        nodes: map.nodes.map((node) => ({ ...node, labelEn: "new content" })),
      }),
    ).toBeNull();
  });
});
