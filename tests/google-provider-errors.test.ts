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
});
