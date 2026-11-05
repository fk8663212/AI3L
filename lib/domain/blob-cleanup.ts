/** Uploads younger than this may still be on their way to being saved. */
export const BLOB_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000;

/**
 * Blobs no artifact row points at, once past the grace period: recording
 * staging copies (their artifact points at Drive), rejected or abandoned
 * uploads, and leftovers from deleted participants. Blobs referenced by any
 * artifact, superseded ones included, are research data and are kept.
 */
export function selectOrphanBlobs<T extends { url: string; uploadedAt: Date }>(
  blobs: readonly T[],
  referencedUrls: ReadonlySet<string>,
  now: Date = new Date(),
): T[] {
  const cutoff = now.getTime() - BLOB_GRACE_PERIOD_MS;
  return blobs.filter(
    (blob) =>
      blob.uploadedAt.getTime() < cutoff && !referencedUrls.has(blob.url),
  );
}
