import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";
import { listAdminSessions } from "@/lib/services/admin-session-service";

const querySchema = z.object({
  q: z.string().max(100).optional(),
  taskId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().max(100_000).default(1),
});

export async function GET(request: Request) {
  try {
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }
    const url = new URL(request.url);
    const query = querySchema.parse({
      q: url.searchParams.get("q") || undefined,
      taskId: url.searchParams.get("taskId") || undefined,
      page: url.searchParams.get("page") || undefined,
    });

    return NextResponse.json({
      ok: true,
      data: await listAdminSessions(query),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
