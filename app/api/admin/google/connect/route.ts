import { NextResponse } from "next/server";
import {
  googleAuthorizationUrl,
  googleRedirectUri,
} from "@/lib/storage/google-drive";
import {
  createOAuthState,
  getAdminClaims,
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
    // Come back to the host the admin is signed in on: the admin cookie only
    // exists there. Google Cloud must list this exact redirect URI.
    const redirectUri = googleRedirectUri(requestOrigin(request));
    return NextResponse.redirect(
      googleAuthorizationUrl(await createOAuthState(redirectUri), redirectUri),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
