import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructured } from "@/lib/ai/provider";

// Real: the @google/genai SDK and our Gemini call. Faked: the network.

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    // HTTP/2 answers carry no reason phrase, as on Vercel.
    statusText: "",
    headers: { "content-type": "application/json" },
  });
}

const okBody = {
  responseId: "r1",
  candidates: [
    { content: { role: "model", parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" },
  ],
};

function call() {
  return generateStructured({
    provider: "google",
    apiKey: "test-key",
    modelId: "gemini-test",
    schemaName: "probe",
    schema: z.object({ ok: z.literal(true) }),
    system: "system",
    prompt: "prompt",
    binary: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/webp" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gemini errors", () => {
  it("keeps Google's status and message instead of a bare 'Non-retryable exception'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(403, { error: { code: 403, message: "API key not valid", status: "PERMISSION_DENIED" } }),
      ),
    );
    const error = await call().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ status: 403 });
    expect(String((error as Error).message)).toContain("API key not valid");
  });

  it("retries without the JSON schema when Gemini rejects it as an invalid argument", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(400, {
          error: { code: 400, message: "Invalid JSON payload", status: "INVALID_ARGUMENT" },
        }),
      )
      .mockResolvedValueOnce(json(200, okBody));
    vi.stubGlobal("fetch", fetchMock);

    await expect(call()).resolves.toMatchObject({ value: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("regenerates malformed JSON once and counts both requests' usage", async () => {
    const malformed = { ...okBody, usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 }, candidates: [{ content: { parts: [{ text: '{"ok":true' }] }, finishReason: "STOP" }] };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, malformed))
      .mockResolvedValueOnce(json(200, { ...okBody, usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 3 } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(call()).resolves.toMatchObject({ value: { ok: true }, usage: { inputTokens: 10, outputTokens: 5 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(requests[1].contents[0].parts[0].text).toContain("Escape quotation marks");
    expect(requests[1].generationConfig.responseJsonSchema).toEqual(requests[0].generationConfig.responseJsonSchema);
  });

  it("retries schema-invalid or token-truncated output but fails after two attempts", async () => {
    const invalid = { ...okBody, candidates: [{ content: { parts: [{ text: '{"ok":false}' }] }, finishReason: "STOP" }] };
    const truncated = { ...okBody, candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "MAX_TOKENS" }] };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, invalid)).mockResolvedValueOnce(json(200, truncated));
    vi.stubGlobal("fetch", fetchMock);
    await expect(call()).rejects.toThrow(/after 2 attempts.*MAX_TOKENS/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry quota errors or safety refusals", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(429, { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(call()).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockReset().mockResolvedValueOnce(json(200, { candidates: [{ finishReason: "SAFETY" }] }));
    await expect(call()).rejects.toThrow(/SAFETY/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
