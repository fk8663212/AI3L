import { describe, expect, it } from "vitest";
import { privateFileResponse } from "@/lib/storage/file-response";

function file() {
  return { stream: new Blob(["0123456789"]).stream(), size: 10, contentType: "audio/webm", filename: "pretest.webm", etag: "audio-v1" };
}

describe("private media delivery", () => {
  it("keeps an audio extension and provides an explicit download", async () => {
    const response = await privateFileResponse(new Request("http://localhost/audio?download=1"), file());
    expect(response.headers.get("content-disposition")).toContain('attachment; filename="pretest.webm"');
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("0123456789");
  });

  it.each([["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"]])("serves %s for media seeking", async (range, body, contentRange) => {
    const response = await privateFileResponse(new Request("http://localhost/audio", { headers: { range } }), file());
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(await response.text()).toBe(body);
  });

  it.each(["bytes=10-", "bytes=5-3", "bytes=-0", "bytes=-", "bytes=0-1,4-5"])("rejects an invalid range %s", async (range) => {
    expect((await privateFileResponse(new Request("http://localhost/audio", { headers: { range } }), file())).status).toBe(416);
  });

  it("ignores an old If-Range validator", async () => {
    const response = await privateFileResponse(new Request("http://localhost/audio", { headers: { range: "bytes=2-5", "if-range": '"old-version"' } }), file());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
  });
});
