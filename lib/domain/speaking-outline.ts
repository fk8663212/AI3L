import { z } from "zod";
import { conceptMapSchema, type ConceptMap } from "@/lib/ai/schemas";

export const speakingSectionSchema = z.object({
  id: z.string().min(1).max(64),
  titleZh: z.string().trim().min(1, "請填寫段落名稱。").max(80),
  titleEn: z.string().trim().min(1, "請填寫英文段落名稱。").max(80),
  nodeIds: z.array(z.string().min(1)).min(1, "每段至少需要一個概念。").max(40),
});
export const speakingOutlineSchema = z.object({
  sections: z.array(speakingSectionSchema).min(1).max(6),
});
export type SpeakingSection = z.infer<typeof speakingSectionSchema>;
export type SpeakingOutline = z.infer<typeof speakingOutlineSchema>;

/** Layout changes do not invalidate the content used to build an outline. */
export function conceptMapSignature(map: ConceptMap) {
  return JSON.stringify({
    nodes: map.nodes
      .map(({ id, labelEn, labelZh, category, source }) => ({
        id,
        labelEn,
        labelZh,
        category,
        source,
      }))
      .sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? -1 : 1)),
    edges: map.edges
      .map(({ id, from, to, relationEn, relationZh, source }) => ({
        id,
        from,
        to,
        relationEn,
        relationZh,
        source,
      }))
      .sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? -1 : 1)),
  });
}

export function outlineSchemaForMap(map: ConceptMap) {
  const ids = new Set(map.nodes.map((node) => node.id));
  return speakingOutlineSchema
    .extend({
      sections: z
        .array(
          speakingSectionSchema.extend({
            nodeIds: z
              .array(z.enum([...ids] as [string, ...string[]]))
              .min(1)
              .max(40),
          }),
        )
        .min(1)
        .max(6),
    })
    .superRefine((outline, ctx) => {
      const sections = new Set<string>();
      const covered = new Set<string>();
      for (const [index, section] of outline.sections.entries()) {
        if (sections.has(section.id))
          ctx.addIssue({
            code: "custom",
            path: ["sections", index, "id"],
            message: "段落代號不可重複。",
          });
        sections.add(section.id);
        if (new Set(section.nodeIds).size !== section.nodeIds.length)
          ctx.addIssue({
            code: "custom",
            path: ["sections", index, "nodeIds"],
            message: "同一段落的概念不可重複。",
          });
        for (const id of section.nodeIds) {
          if (!ids.has(id))
            ctx.addIssue({
              code: "custom",
              path: ["sections", index, "nodeIds"],
              message: "只能選擇學生已確認的概念。",
            });
          covered.add(id);
        }
      }
      if ([...ids].some((id) => !covered.has(id)))
        ctx.addIssue({
          code: "custom",
          path: ["sections"],
          message: "請將每個已確認的概念至少安排到一個段落。",
        });
    });
}

export function validSpeakingOutline(
  data: Record<string, unknown> | undefined,
  map: ConceptMap,
) {
  if (!data || data.sourceMapSignature !== conceptMapSignature(map))
    return null;
  const parsed = outlineSchemaForMap(map).safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function outlineSourceMap(data: Record<string, unknown>) {
  try {
    return conceptMapSchema.parse(JSON.parse(String(data.sourceMapSignature)));
  } catch {
    return null;
  }
}

export function microMap(
  map: ConceptMap,
  section: SpeakingSection,
): ConceptMap {
  const ids = new Set(section.nodeIds);
  return {
    nodes: map.nodes
      .filter((node) => ids.has(node.id))
      .map(({ id, labelEn, labelZh, category, source }) => ({
        id,
        labelEn,
        labelZh,
        category,
        source,
      })),
    edges: map.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  };
}
