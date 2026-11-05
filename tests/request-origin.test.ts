import { afterEach, describe, expect, it } from "vitest";
import { assertSameOrigin } from "@/lib/security/request";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

function post(url: string, headers: Record<string, string>) {
  return new Request(url, { method: "POST", headers });
}

describe("assertSameOrigin", () => {
  it("accepts the origin the request was sent to, even when NEXT_PUBLIC_APP_URL differs", () => {
    // e.g. a Preview deployment while the variable holds the production domain,
    // or the .env.example localhost value copied into Vercel.
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const request = post("https://ddc-git-branch.vercel.app/api/admin/login", {
      origin: "https://ddc-git-branch.vercel.app",
      host: "ddc-git-branch.vercel.app",
      "x-forwarded-proto": "https",
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("accepts the forwarded host behind a proxy", () => {
    const request = post("http://internal:3000/api/admin/login", {
      origin: "https://research.example.edu",
      host: "internal:3000",
      "x-forwarded-host": "research.example.edu",
      "x-forwarded-proto": "https",
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("accepts the configured app URL and Vercel production hostname", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ddc.example.com/";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ddc.vercel.app";
    for (const origin of ["https://ddc.example.com", "https://ddc.vercel.app"]) {
      const request = post("https://ddc-abc123.vercel.app/api/admin/login", {
        origin,
        host: "ddc-abc123.vercel.app",
      });
      expect(() => assertSameOrigin(request)).not.toThrow();
    }
  });

  it("still rejects another site", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ddc.example.com";
    const request = post("https://ddc.example.com/api/admin/login", {
      origin: "https://evil.example",
      host: "ddc.example.com",
    });
    expect(() => assertSameOrigin(request)).toThrow(
      expect.objectContaining({ code: "ORIGIN_MISMATCH" }),
    );
  });

  it("allows requests without an Origin header (same-origin GET-style clients)", () => {
    expect(() => assertSameOrigin(post("https://ddc.example.com/x", {}))).not.toThrow();
  });
});
