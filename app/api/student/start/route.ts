import { NextResponse } from "next/server";
import { z } from "zod";
import { hashAccessCode } from "@/lib/security/crypto";
import {
  apiErrorResponse,
  assertSameOrigin,
  clientIp,
} from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  createStudentToken,
  secureCookieOptions,
  STUDENT_COOKIE,
} from "@/lib/security/session";
import { startStudentSession } from "@/lib/services/session-service";

const bodySchema = z.object({
  code: z.string().min(8).max(32),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(
      `student-code:${clientIp(request)}`,
      12,
      15 * 60 * 1000,
    );
    const { code } = bodySchema.parse(await request.json());
    const session = await startStudentSession(hashAccessCode(code));
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      STUDENT_COOKIE,
      await createStudentToken(session.id),
      secureCookieOptions,
    );
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
