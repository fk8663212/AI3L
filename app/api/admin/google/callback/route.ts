import { NextResponse } from "next/server";
import {
  completeGoogleConnection,
  googleRedirectUri,
} from "@/lib/storage/google-drive";
import {
  getAdminClaims,
  verifyOAuthState,
} from "@/lib/security/session";
import {
  apiErrorResponse,
  ApiError,
  requestOrigin,
} from "@/lib/security/request";

export async function GET(request: Request) {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    const url = new URL(request.url);
    const origin = requestOrigin(request);
    const googleError = url.searchParams.get("error");
    if (googleError) {
      throw new ApiError(
        400,
        "GOOGLE_OAUTH_DENIED",
        `Google 未完成授權（${googleError}），請回到後台重新連接。`,
      );
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const verified = state ? await verifyOAuthState(state) : null;
    // The flow must finish on the host it started on, with the same URI.
    if (!code || !verified || verified.redirectUri !== googleRedirectUri(origin)) {
      throw new ApiError(400, "INVALID_OAUTH_CALLBACK", "Google OAuth 回傳無效，請回到後台重新連接。");
    }
    await completeGoogleConnection(code, verified.redirectUri);
    return NextResponse.redirect(`${origin}/admin?connected=drive`);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
