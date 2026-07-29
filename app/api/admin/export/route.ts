import { NextResponse } from "next/server";
import { exportResearchData } from "@/lib/services/admin-service";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";

export async function GET(request: Request) {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    const taskId = new URL(request.url).searchParams.get("taskId") ?? undefined;
    const data = await exportResearchData(taskId);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="ai3l-export-${Date.now()}.json"`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
