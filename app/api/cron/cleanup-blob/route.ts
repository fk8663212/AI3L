import { del, list } from "@/lib/storage/blob-store";
import { and, inArray, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { artifacts } from "@/lib/db/schema";
import { selectOrphanBlobs } from "@/lib/domain/blob-cleanup";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (
    !secret ||
    request.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const referenced = new Set(
    (
      await getDb()
        .select({ url: artifacts.storageLocator })
        .from(artifacts)
        .where(
          and(
            inArray(artifacts.storageProvider, ["vercel-blob", "local"]),
            isNotNull(artifacts.storageLocator),
          ),
        )
    ).flatMap((row) => (row.url ? [row.url] : [])),
  );

  const now = new Date();
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await list({ prefix: "student/", cursor, limit: 1_000 });
    const orphans = selectOrphanBlobs(page.blobs, referenced, now);
    if (orphans.length) {
      await del(orphans.map((blob) => blob.url));
      deleted += orphans.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return NextResponse.json({ ok: true, deleted });
}
