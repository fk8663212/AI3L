import { NextResponse } from "next/server";
import { completeGoogleConnection } from "@/lib/storage/google-drive";
import {
  getAdminClaims,
  verifyOAuthState,
} from "@/lib/security/session";
import { apiErrorResponse, ApiError } from "@/lib/security/request";

export async function GET(request: Request) {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !(await verifyOAuthState(state))) {
      throw new ApiError(400, "INVALID_OAUTH_CALLBACK", "Google OAuth 回傳無效。");
    }
    await completeGoogleConnection(code);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? url.origin}/admin?connected=drive`,
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
