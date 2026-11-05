import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rateLimits } from "@/lib/db/schema";
import { ApiError } from "@/lib/security/request";

/**
 * Fixed-window rate limit. A single upsert both resets an expired window and
 * increments the counter, so concurrent requests cannot all read the same
 * stale count and slip past the limit.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);
  const expired = sql`${rateLimits.windowStartedAt} < ${windowStart.toISOString()}::timestamptz`;
  const rows = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStartedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStartedAt: sql`case when ${expired} then ${now.toISOString()}::timestamptz else ${rateLimits.windowStartedAt} end`,
        updatedAt: now,
      },
    })
    .returning({ count: rateLimits.count });

  if ((rows[0]?.count ?? 0) > limit) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "嘗試次數過多，請稍後再試。",
    );
  }
}
