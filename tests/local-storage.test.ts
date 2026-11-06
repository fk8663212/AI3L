import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { del, get, head, list, put } from "@/lib/storage/blob-store";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "ai3l-storage-"));
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("LOCAL_STORAGE_PATH", directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("private local storage", () => {
  it("persists bytes and metadata and deletes both through the storage API", async () => {
    const saved = await put("student/test/pretest/recording.wav", new Blob(["recording bytes"]), { access: "private", contentType: "audio/wav", addRandomSuffix: true });
    expect(saved.url).toMatch(/^local:\/\/student\/test\/pretest\//);
    expect((await head(saved.url)).size).toBe(15);
    const read = await get(saved.url, { access: "private" });
    expect(read?.statusCode).toBe(200);
    expect(await new Response(read!.stream).text()).toBe("recording bytes");
    await del(saved.url);
    await expect(head(saved.url)).rejects.toMatchObject({ status: 404 });
    expect((await list()).blobs).toHaveLength(0);
  });

  it("rejects traversal and public storage directories", async () => {
    for (const key of ["../escape", "/absolute", "student/../../escape", "student/%2e%2e/escape", "student/a\\b", "student/file.meta.json"]) {
      await expect(put(key, new Blob(["x"]), { access: "private" })).rejects.toMatchObject({ status: 400 });
    }
    await expect(head("local://../escape")).rejects.toMatchObject({ status: 400 });
    vi.stubEnv("LOCAL_STORAGE_PATH", path.resolve("public/research"));
    await expect(put("student/test/file", new Blob(["x"]), { access: "private" })).rejects.toThrow("outside public");
  });

  it("never overwrites an existing file when a pathname is reused", async () => {
    const original = await put("student/test/file.wav", new Blob(["original"]), { access: "private", addRandomSuffix: false });
    await expect(put("student/test/file.wav", new Blob(["replacement"]), { access: "private", addRandomSuffix: false })).rejects.toThrow();
    const read = await get(original.url, { access: "private" });
    expect(await new Response(read!.stream).text()).toBe("original");
  });

  it("pagination remains correct when earlier pages are deleted", async () => {
    for (const key of ["a", "b", "c"]) await put("student/test/" + key, new Blob([key]), { access: "private", addRandomSuffix: false });
    const first = await list({ prefix: "student/test/", limit: 2 });
    expect(first.blobs).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    await del(first.blobs.map((blob) => blob.url));
    const second = await list({ prefix: "student/test/", cursor: first.cursor, limit: 2 });
    expect(second.blobs.map((blob) => blob.pathname)).toEqual(["student/test/c"]);
    expect(second.hasMore).toBe(false);
  });

  it("does not create files after cancellation", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(put("student/test/cancelled", new Blob(["x"]), { access: "private", abortSignal: abort.signal })).rejects.toThrow();
    expect((await list()).blobs).toHaveLength(0);
  });
});
