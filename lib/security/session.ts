import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "ai3l_admin";
export const STUDENT_COOKIE = "ai3l_student";

type AdminClaims = JWTPayload & {
  role: "admin";
};

type StudentClaims = JWTPayload & {
  role: "student";
  sessionId: string;
};

function authKey(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    throw new Error("AUTH_SECRET is not configured.");
  }
  return new TextEncoder().encode(value);
}

async function sign(
  payload: Record<string, unknown>,
  expiresIn: string,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(authKey());
}

export function createAdminToken(): Promise<string> {
  return sign({ role: "admin" }, "12h");
}

export function createStudentToken(sessionId: string): Promise<string> {
  return sign({ role: "student", sessionId }, "7d");
}

/**
 * Signed OAuth state. It carries the redirect URI the flow started with, so
 * the callback exchanges the code with exactly that URI (Google requires the
 * same one) and returns the admin to the host they signed in on.
 */
export function createOAuthState(redirectUri: string): Promise<string> {
  return sign({ purpose: "google-drive-oauth", redirectUri }, "10m");
}

export async function verifyOAuthState(
  token: string,
): Promise<{ redirectUri: string } | null> {
  const payload = await verify<
    JWTPayload & { purpose?: string; redirectUri?: unknown }
  >(token);
  return payload?.purpose === "google-drive-oauth" &&
    typeof payload.redirectUri === "string"
    ? { redirectUri: payload.redirectUri }
    : null;
}

async function verify<T extends JWTPayload>(
  token: string | undefined,
): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authKey());
    return payload as T;
  } catch {
    return null;
  }
}

export async function getAdminClaims(): Promise<AdminClaims | null> {
  const store = await cookies();
  const payload = await verify<AdminClaims>(store.get(ADMIN_COOKIE)?.value);
  return payload?.role === "admin" ? payload : null;
}

export async function getStudentClaims(): Promise<StudentClaims | null> {
  const store = await cookies();
  const payload = await verify<StudentClaims>(store.get(STUDENT_COOKIE)?.value);
  if (payload?.role !== "student" || typeof payload.sessionId !== "string") {
    return null;
  }
  // A disabled or expired code ends access immediately, not when the 7-day
  // cookie runs out.
  const { studentCodeActive } = await import(
    "@/lib/services/access-code-service"
  );
  return (await studentCodeActive(payload.sessionId)) ? payload : null;
}

export const secureCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" &&
    !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(process.env.NEXT_PUBLIC_APP_URL ?? ""),
  path: "/",
};
