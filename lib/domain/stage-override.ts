import { STAGE_IDS, type StageId } from "@/lib/domain/stages";

export const MIN_STAGE_OVERRIDE_REASON_LENGTH = 5;

export function normalizeStageOverrideReason(reason: string): string {
  return reason.trim();
}

export function stageOverrideReasonReady(reason: string): boolean {
  return (
    normalizeStageOverrideReason(reason).length >=
    MIN_STAGE_OVERRIDE_REASON_LENGTH
  );
}

/**
 * Stages whose work an override invalidates. Moving to the current or an
 * earlier stage (or reopening a completed session) redoes the target stage
 * and every later one; skipping forward keeps everything.
 */
export function overrideRedoesStages(input: {
  from: StageId;
  to: StageId;
  completed: boolean;
}): StageId[] {
  const fromIndex = STAGE_IDS.indexOf(input.from);
  const toIndex = STAGE_IDS.indexOf(input.to);
  if (!input.completed && toIndex > fromIndex) return [];
  return STAGE_IDS.slice(toIndex);
}
