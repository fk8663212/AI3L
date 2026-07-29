import { NextResponse } from "next/server";
import { googleAuthorizationUrl } from "@/lib/storage/google-drive";
import {
  createOAuthState,
  getAdminClaims,
} from "@/lib/security/session";
import { apiErrorResponse, ApiError } from "@/lib/security/request";

export async function GET() {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    return NextResponse.redirect(
      googleAuthorizationUrl(await createOAuthState()),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
