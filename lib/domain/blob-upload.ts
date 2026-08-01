import type { PresignedUrlPayload } from "@vercel/blob";

export function presignedPayloadFromUrl(value: string): PresignedUrlPayload {
  const url = new URL(value);
  const delegationToken = url.searchParams.get("vercel-blob-delegation");
  const signature = url.searchParams.get("vercel-blob-signature");
  if (!delegationToken || !signature) {
    throw new Error("Signed Blob URL is missing its delegation or signature.");
  }
  url.searchParams.delete("pathname");
  url.searchParams.delete("vercel-blob-delegation");
  url.searchParams.delete("vercel-blob-signature");
  return {
    delegationToken,
    signature,
    params: Object.fromEntries(url.searchParams.entries()),
  };
}
