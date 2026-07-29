import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE,
  createAdminToken,
  secureCookieOptions,
} from "@/lib/security/session";
import { verifyAdminPassword } from "@/lib/security/crypto";
import {
  apiErrorResponse,
  assertSameOrigin,
  clientIp,
  ApiError,
} from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const bodySchema = z.object({ password: z.string().min(1).max(256) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(
      `admin-login:${clientIp(request)}`,
      8,
      15 * 60 * 1000,
    );
    const { password } = bodySchema.parse(await request.json());
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) {
      throw new ApiError(
        503,
        "ADMIN_PASSWORD_NOT_CONFIGURED",
        "ADMIN_PASSWORD_HASH 尚未設定。",
      );
    }
    if (!verifyAdminPassword(password, hash)) {
      throw new ApiError(401, "INVALID_PASSWORD", "管理員密碼不正確。");
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      ADMIN_COOKIE,
      await createAdminToken(),
      secureCookieOptions,
    );
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
