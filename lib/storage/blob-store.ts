import { createHash, randomUUID } from "node:crypto";
import { access, link, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import * as cloud from "@vercel/blob";
import { ApiError } from "@/lib/security/request";

export function localStorageEnabled() {
  const driver = process.env.STORAGE_DRIVER ?? "vercel";
  if (driver !== "local" && driver !== "vercel") throw new Error("STORAGE_DRIVER must be local or vercel.");
  return driver === "local";
}

export const isLocalLocator = (locator: string) => locator.startsWith("local://");
export const uploadStorageProvider = () => localStorageEnabled() ? "local" : "vercel-blob";

function storageRoot() {
  const root = path.resolve(/* turbopackIgnore: true */ process.env.LOCAL_STORAGE_PATH ?? ".local/storage");
  const publicRoot = path.resolve("public");
  if (root === publicRoot || root.startsWith(publicRoot + path.sep)) {
    throw new Error("LOCAL_STORAGE_PATH must be outside public/.");
  }
  return root;
}

function safeKey(value: string) {
  if (!value || value.length > 1024 || !/^[a-zA-Z0-9._/-]+$/.test(value) ||
      value.split("/").some((part) => !part || part === "." || part === "..") ||
      value.endsWith(".meta.json")) {
    throw new ApiError(400, "INVALID_STORAGE_PATH", "檔案路徑無效。");
  }
  return value;
}

function keyOf(locator: string) {
  if (!isLocalLocator(locator)) throw new ApiError(400, "INVALID_STORAGE_PATH", "不是本機檔案。");
  return safeKey(locator.slice("local://".length));
}

function filename(key: string) {
  return path.join(/* turbopackIgnore: true */ storageRoot(), safeKey(key));
}

export async function ensureLocalStorage() {
  await mkdir(storageRoot(), { recursive: true, mode: 0o700 });
  await access(storageRoot(), constants.R_OK | constants.W_OK);
}

type Metadata = {
  pathname: string; contentType: string; size: number; uploadedAt: string; etag: string;
};

async function localHead(locator: string) {
  const key = keyOf(locator);
  try {
    // User files are mounted at runtime; they must not enter Next's build trace.
    const metadataPath = filename(key) + ".meta.json";
    const metadata = JSON.parse(await readFile(/* turbopackIgnore: true */ metadataPath, "utf8")) as Metadata;
    if (metadata.pathname !== key) throw new Error("Storage metadata does not match its path.");
    return {
      ...metadata, uploadedAt: new Date(metadata.uploadedAt), url: locator, downloadUrl: locator,
      contentDisposition: `inline; filename="${encodeURIComponent(path.basename(key))}"`,
      cacheControl: "private, no-store",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ApiError(404, "FILE_NOT_FOUND", "找不到本機檔案。");
    throw error;
  }
}

export async function put(key: string, body: Parameters<typeof cloud.put>[1], options: Parameters<typeof cloud.put>[2]) {
  if (!localStorageEnabled()) return cloud.put(key, body, options);
  options?.abortSignal?.throwIfAborted();
  safeKey(key);
  if (options?.addRandomSuffix !== false) {
    const ext = path.posix.extname(key);
    key = key.slice(0, key.length - ext.length) + "-" + randomUUID() + ext;
  }
  const bytes = Buffer.from(await new Response(body as BodyInit).arrayBuffer());
  const target = filename(key);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const metadata: Metadata = {
    pathname: key, contentType: options?.contentType ?? "application/octet-stream", size: bytes.length,
    uploadedAt: new Date().toISOString(), etag: createHash("sha256").update(bytes).digest("hex"),
  };
  const temporary = target + "." + randomUUID() + ".tmp";
  let created = false;
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    options?.abortSignal?.throwIfAborted();
    await link(temporary, target);
    created = true;
    await writeFile(target + ".meta.json", JSON.stringify(metadata), { mode: 0o600, flag: "wx" });
  } catch (error) {
    await rm(temporary, { force: true });
    if (created) await rm(target, { force: true });
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return localHead("local://" + key);
}

export async function head(locator: string, options?: Parameters<typeof cloud.head>[1]) {
  options?.abortSignal?.throwIfAborted();
  return isLocalLocator(locator) ? localHead(locator) : cloud.head(locator, options);
}

export async function get(locator: string, options: Parameters<typeof cloud.get>[1]) {
  if (!isLocalLocator(locator)) return cloud.get(locator, options);
  options?.abortSignal?.throwIfAborted();
  const blob = await localHead(locator);
  try {
    const filePath = filename(blob.pathname);
    const bytes = await readFile(/* turbopackIgnore: true */ filePath);
    return { statusCode: 200 as const, stream: new Blob([new Uint8Array(bytes)]).stream(), blob };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ApiError(404, "FILE_NOT_FOUND", "找不到本機檔案。");
    throw error;
  }
}

export async function del(locators: string | string[], options?: Parameters<typeof cloud.del>[1]) {
  const remote: string[] = [];
  for (const locator of Array.isArray(locators) ? locators : [locators]) {
    options?.abortSignal?.throwIfAborted();
    if (!isLocalLocator(locator)) { remote.push(locator); continue; }
    const file = filename(keyOf(locator));
    await rm(file, { force: true });
    await rm(file + ".meta.json", { force: true });
  }
  if (remote.length) {
    if (options) await cloud.del(remote, options);
    else await cloud.del(remote);
  }
}

export async function list(options: Parameters<typeof cloud.list>[0] = {}) {
  if (!localStorageEnabled()) return cloud.list(options);
  await ensureLocalStorage();
  const prefix = options?.prefix ?? "";
  if (prefix) safeKey(prefix.replace(/\/$/, ""));
  const keys: string[] = [];
  async function walk(directory: string, relative = "") {
    for (const entry of await readdir(/* turbopackIgnore: true */ directory, { withFileTypes: true })) {
      const key = relative + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), key + "/");
      else if (entry.isFile() && key.endsWith(".meta.json")) keys.push(key.slice(0, -10));
    }
  }
  await walk(storageRoot());
  const after = options?.cursor ? Buffer.from(options.cursor, "base64url").toString("utf8") : "";
  const matches = keys.filter((key) => key.startsWith(prefix) && key > after).sort();
  const limit = Math.max(1, Math.min(1000, options?.limit ?? 1000));
  const selected = matches.slice(0, limit);
  const blobs = await Promise.all(selected.map((key) => localHead("local://" + key)));
  const hasMore = matches.length > limit;
  return { blobs, hasMore, cursor: hasMore ? Buffer.from(selected.at(-1)!).toString("base64url") : undefined };
}
