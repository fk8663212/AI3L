import { NextResponse } from "next/server";
import { apiErrorResponse, assertSameOrigin } from "@/lib/security/request";
import { secureCookieOptions, STUDENT_COOKIE } from "@/lib/security/session";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(STUDENT_COOKIE, "", {
      ...secureCookieOptions,
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
