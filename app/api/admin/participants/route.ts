import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { apiErrorResponse, ApiError, assertSameOrigin } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";
import {
  deleteParticipantData,
  listRetentionExpiredSessions,
  purgeRetentionExpired,
} from "@/lib/services/participant-data-service";

// Deleting a participant removes several Drive and Blob files one by one.
export const maxDuration = 120;

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("delete_participant"),
    sessionId: z.string().uuid(),
    // The admin types the student label (or session id) to confirm.
    confirmation: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("purge_retention"),
    sessionIds: z.array(z.string().uuid()).min(1).max(25),
  }),
]);

async function requireAdmin() {
  if (!(await getAdminClaims())) {
    throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
  }
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ ok: true, data: await listRetentionExpiredSessions() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireAdmin();
    const body = bodySchema.parse(await request.json());
    if (body.action === "purge_retention") {
      return NextResponse.json({
        ok: true,
        data: await purgeRetentionExpired(body.sessionIds),
      });
    }

    const session = await getDb().query.studentSessions.findFirst({
      where: (sessions, { eq }) => eq(sessions.id, body.sessionId),
    });
    if (!session) throw new ApiError(404, "SESSION_NOT_FOUND", "找不到工作階段。");
    const code = await getDb().query.accessCodes.findFirst({
      where: (codes, { eq }) => eq(codes.id, session.accessCodeId),
    });
    const expected = code?.label ?? session.id;
    if (body.confirmation !== expected) {
      throw new ApiError(
        400,
        "CONFIRMATION_MISMATCH",
        `請輸入「${expected}」以確認刪除。`,
      );
    }
    return NextResponse.json({
      ok: true,
      data: await deleteParticipantData({
        sessionId: body.sessionId,
        reason: "admin_request",
      }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
