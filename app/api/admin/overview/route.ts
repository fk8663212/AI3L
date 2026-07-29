import { NextResponse } from "next/server";
import { adminOverview, bootstrapDefaults } from "@/lib/services/admin-service";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";

export async function GET() {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    await bootstrapDefaults();
    return NextResponse.json({ ok: true, data: await adminOverview() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
