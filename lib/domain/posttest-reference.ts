import { z } from "zod";
import { conceptMapSchema } from "@/lib/ai/schemas";
import { speakingOutlineSchema, validSpeakingOutline } from "@/lib/domain/speaking-outline";
import { speakingTemplateSchema, type SpeakingTemplate } from "@/lib/domain/speaking-templates";
import { POSTTEST_REFERENCE_INSTRUCTION } from "@/lib/domain/stages";
import { conceptMapWithoutEnrichmentNotes } from "@/lib/domain/concept-enrichment";

export const POSTTEST_REFERENCE_POLICY = "concept-map-only-v1";

const LEGACY_POSTTEST_INSTRUCTIONS = new Set([
  "現在不會顯示先前的提示。請再次獨立用英文描述你的大稻埕年貨市場經驗。",
  "現在不會顯示先前的提示。請再次獨立用英文描述相同任務的場景與經驗。",
  "現在不會顯示先前的提示。請再次獨立用英文說明相同任務中的活動、製作經驗或事件。",
  "現在不會顯示先前的提示。請再次獨立用英文說明相同任務中你觀察到的情況與自己的想法。",
]);

/** Adapt the active student's screen only; leave published/exported task text intact. */
export function posttestInstructionForReference(instruction: string) {
  return LEGACY_POSTTEST_INSTRUCTIONS.has(instruction) ? POSTTEST_REFERENCE_INSTRUCTION : instruction;
}

export const posttestReferenceSchema = z.object({
  policyVersion: z.literal(POSTTEST_REFERENCE_POLICY),
  mapArtifactId: z.string().min(1),
  outlineArtifactId: z.string().min(1).nullable(),
  map: conceptMapSchema,
  outline: speakingOutlineSchema.nullable(),
  speakingTemplate: speakingTemplateSchema.optional(),
  organization: z.enum(["procedural", "chronological", "causal", "problem_solution"]).optional(),
});
export type PosttestReference = z.infer<typeof posttestReferenceSchema>;

export const posttestSupportSchema = z.object({
  policyVersion: z.literal(POSTTEST_REFERENCE_POLICY),
  reference: posttestReferenceSchema.nullable(),
});

type ReferenceArtifact = {
  id: string;
  stageId: string;
  type: string;
  data: Record<string, unknown>;
  supersededAt: Date | null;
};

/** A narrow projection: no earlier sentences, rejected nodes or AI hints. */
export function posttestReferenceFromArtifacts(
  rows: ReferenceArtifact[],
  template?: SpeakingTemplate,
): PosttestReference | null {
  const active = rows.filter(row => row.supersededAt === null);
  const audio = active.find(row => row.stageId === "posttest" && row.type === "audio");
  if (audio) {
    // A saved take keeps its original reference condition. In particular, old
    // unassisted recordings must not be relabelled after this feature ships.
    const saved = posttestSupportSchema.safeParse(audio.data.posttestSupport);
    return saved.success ? saved.data.reference : null;
  }
  const decisions = active.find(row => row.stageId === "ai_concept_map" && row.type === "concept_decisions");
  const parsed = conceptMapSchema.safeParse(decisions?.data.accepted);
  if (!decisions || !parsed.success || !parsed.data.nodes.length
    || !Array.isArray(decisions.data.pending) || decisions.data.pending.length) return null;

  const saved = active.find(row => row.stageId === "ai_concept_map" && row.type === "speaking_outline");
  const plan = validSpeakingOutline(saved?.data, parsed.data, template ?? null);
  return posttestReferenceSchema.parse({
    policyVersion: POSTTEST_REFERENCE_POLICY,
    mapArtifactId: decisions.id,
    outlineArtifactId: plan ? saved!.id : null,
    map: conceptMapWithoutEnrichmentNotes(parsed.data),
    // Keep only the student's final sections, not generatedSections or hints.
    outline: plan ? { sections: plan.sections } : null,
    ...(template ? { speakingTemplate: template } : {}),
    ...(plan && "organization" in plan ? { organization: plan.organization } : {}),
  });
}
