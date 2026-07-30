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
