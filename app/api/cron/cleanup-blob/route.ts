import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const MAX_STAGING_AGE_MS = 24 * 60 * 60 * 1_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (
    !secret ||
    request.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const cutoff = Date.now() - MAX_STAGING_AGE_MS;
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const page = await list({
      prefix: "student/",
      cursor,
      limit: 1_000,
    });
    const staleAudio = page.blobs.filter(
      (blob) =>
        blob.uploadedAt.getTime() < cutoff &&
        /\/recording\.(?:webm|m4a|ogg|wav)/iu.test(blob.pathname),
    );
    if (staleAudio.length) {
      await del(staleAudio.map((blob) => blob.url));
      deleted += staleAudio.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return NextResponse.json({ ok: true, deleted });
}
