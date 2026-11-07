type PrivateFile = {
  stream: ReadableStream<Uint8Array>;
  size?: number;
  contentType: string;
  filename: string;
  etag?: string;
};

/** Called only after the route has checked student/admin ownership. */
export async function privateFileResponse(request: Request, file: PrivateFile) {
  const size = file.size;
  const knownSize = typeof size === "number" && Number.isSafeInteger(size) && size >= 0;
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  const filename = encodeURIComponent(file.filename.replace(/[\r\n]/g, ""));
  const headers = new Headers({
    "content-type": file.contentType,
    "content-disposition": `${disposition}; filename="${filename}"; filename*=UTF-8''${filename}`,
    "cache-control": "private, no-store",
    "accept-ranges": knownSize ? "bytes" : "none",
  });
  if (knownSize) headers.set("content-length", String(size));
  if (file.etag) headers.set("etag", file.etag.startsWith('"') ? file.etag : `"${file.etag}"`);
  const range = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  if (!knownSize || !range || (ifRange && ifRange !== headers.get("etag"))) return new Response(file.stream, { headers });

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const suffix = match?.[1] === "";
  const start = match ? suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]) : NaN;
  const end = match ? suffix || !match[2] ? size - 1 : Math.min(Number(match[2]), size - 1) : NaN;
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    await file.stream.cancel();
    headers.set("content-range", `bytes */${size}`);
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }
  const bytes = await new Response(file.stream).arrayBuffer();
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}
