import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real: the connect/callback routes, signed OAuth state and origin handling.
// Faked: the admin cookie and the Google token exchange.
vi.mock("@/lib/security/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/session")>()),
  getAdminClaims: async () => ({ role: "admin" }),
}));

const google = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/lib/storage/google-drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/google-drive")>()),
  completeGoogleConnection: google.complete,
}));

import { GET as callback } from "@/app/api/admin/google/callback/route";
import { GET as connect } from "@/app/api/admin/google/connect/route";
import { createOAuthState } from "@/lib/security/session";

const PREVIEW = "https://ddc-git-branch.vercel.app";

function get(url: string) {
  const parsed = new URL(url);
  return new Request(url, {
    headers: { host: parsed.host, "x-forwarded-proto": parsed.protocol.replace(":", "") },
  });
}

beforeAll(() => {
  process.env.AUTH_SECRET = "google-oauth-test-secret-0123456789abcdef";
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  // A stale value must not send the admin to another host.
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
});

beforeEach(() => {
  google.complete.mockReset();
});

describe("Google Drive OAuth", () => {
  it("sends Google the callback on the host the admin is signed in on", async () => {
    const response = await connect(get(`${PREVIEW}/api/admin/google/connect`));
    const location = new URL(response.headers.get("location")!);
    expect(location.host).toBe("accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${PREVIEW}/api/admin/google/callback`,
    );
  });

  it("completes with the same redirect URI and returns to that host's admin", async () => {
    const redirectUri = `${PREVIEW}/api/admin/google/callback`;
    const state = await createOAuthState(redirectUri);
    const response = await callback(
      get(`${redirectUri}?code=abc&state=${encodeURIComponent(state)}`),
    );
    expect(google.complete).toHaveBeenCalledWith("abc", redirectUri);
    expect(response.headers.get("location")).toBe(`${PREVIEW}/admin?connected=drive`);
  });

  it("rejects a state issued for another host", async () => {
    const state = await createOAuthState("https://other.example/api/admin/google/callback");
    const response = await callback(
      get(`${PREVIEW}/api/admin/google/callback?code=abc&state=${encodeURIComponent(state)}`),
    );
    expect(response.status).toBe(400);
    expect(google.complete).not.toHaveBeenCalled();
  });

  it("explains a denied consent instead of a generic failure", async () => {
    const response = await callback(
      get(`${PREVIEW}/api/admin/google/callback?error=access_denied`),
    );
    const body = await response.json();
    expect(body.error.code).toBe("GOOGLE_OAUTH_DENIED");
  });
});
