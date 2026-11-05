import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";
import { listAuditLogs } from "@/lib/services/report-service";

export async function GET(request: Request) {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    const params = new URL(request.url).searchParams;
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .catch(1)
      .parse(params.get("page") ?? 1);
    const action = z
      .string()
      .max(80)
      .optional()
      .parse(params.get("action") || undefined);
    return NextResponse.json({
      ok: true,
      data: await listAuditLogs({ page, action }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
