import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rateLimits } from "@/lib/db/schema";
import { ApiError } from "@/lib/security/request";

export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const current = await db.query.rateLimits.findFirst({
    where: eq(rateLimits.key, key),
  });

  if (!current || now.getTime() - current.windowStartedAt.getTime() > windowMs) {
    await db
      .insert(rateLimits)
      .values({ key, count: 1, windowStartedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { count: 1, windowStartedAt: now, updatedAt: now },
      });
    return;
  }

  if (current.count >= limit) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "嘗試次數過多，請稍後再試。",
    );
  }

  await db
    .update(rateLimits)
    .set({ count: sql`${rateLimits.count} + 1`, updatedAt: now })
    .where(eq(rateLimits.key, key));
}
