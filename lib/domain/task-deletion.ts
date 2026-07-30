export function taskDeletionConfirmation(
  slug: string,
  version: number,
): string {
  return `${slug}@v${version}`;
}

export function taskDeletionAllowed(sessionCount: number): boolean {
  return Number.isInteger(sessionCount) && sessionCount === 0;
}
