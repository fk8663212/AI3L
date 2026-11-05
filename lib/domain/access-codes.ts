export type AccessCodeStatus = "active" | "disabled" | "expired";

/** Whether a code can still be used — to sign in, and to keep using a session. */
export function accessCodeStatus(
  code: { disabledAt: Date | string | null; expiresAt: Date | string | null },
  now: Date = new Date(),
): AccessCodeStatus {
  if (code.disabledAt) return "disabled";
  if (code.expiresAt && new Date(code.expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return "active";
}

export const MAX_CODE_BATCH = 500;
