import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError, assertSameOrigin } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";
import {
  listRecordingAnalysisIssues,
  retryRecordingAnalysis,
} from "@/lib/services/recording-service";

// Transcription plus analysis of one recording can take well over a minute.
export const maxDuration = 180;

async function requireAdmin() {
  if (!(await getAdminClaims())) {
    throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
  }
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ ok: true, data: await listRecordingAnalysisIssues() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireAdmin();
    const { audioArtifactId } = z
      .object({ audioArtifactId: z.string().uuid() })
      .parse(await request.json());
    return NextResponse.json({
      ok: true,
      data: await retryRecordingAnalysis(audioArtifactId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
