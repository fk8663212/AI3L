import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";
import { listAccessCodes } from "@/lib/services/access-code-service";

export async function GET(request: Request) {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    const taskId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("taskId"));
    return NextResponse.json({ ok: true, data: await listAccessCodes(taskId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
