export const ADMIN_SESSION_PAGE_SIZE = 25;

export function normalizeAdminSessionPage(page: number): number {
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

export function adminSessionTotalPages(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / ADMIN_SESSION_PAGE_SIZE);
}
