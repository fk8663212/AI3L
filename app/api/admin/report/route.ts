import { NextResponse } from "next/server";
import { z } from "zod";
import { prePostCsv } from "@/lib/domain/pre-post-report";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";
import { prePostReport } from "@/lib/services/report-service";

/** Pre/post comparison for one task, as JSON or (with format=csv) a CSV file. */
export async function GET(request: Request) {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    const params = new URL(request.url).searchParams;
    const taskId = z.string().uuid().parse(params.get("taskId"));
    const report = await prePostReport(taskId);
    if (params.get("format") === "csv") {
      // BOM so Excel opens the UTF-8 file with the right encoding.
      return new NextResponse(`﻿${prePostCsv(report.rows)}`, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="ai3l-pre-post-${Date.now()}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    return NextResponse.json({ ok: true, data: report });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
