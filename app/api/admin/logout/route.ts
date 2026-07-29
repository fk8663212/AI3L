import { NextResponse } from "next/server";
import { ADMIN_COOKIE, secureCookieOptions } from "@/lib/security/session";
import { assertSameOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", {
    ...secureCookieOptions,
    maxAge: 0,
  });
  return response;
}
