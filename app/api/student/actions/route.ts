import { NextResponse } from "next/server";
import { z } from "zod";
import { conceptEdgeSchema, conceptNodeSchema } from "@/lib/ai/schemas";
import { runStageAI } from "@/lib/ai/provider-service";
import { STAGE_IDS } from "@/lib/domain/stages";
import {
  apiErrorResponse,
  ApiError,
  assertSameOrigin,
} from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import {
  completeCurrentStage,
  getSessionView,
  recordConsent,
  replaceArtifactData,
  saveMessage,
} from "@/lib/services/session-service";

export const maxDuration = 60;

const decisionSchema = z.object({
  id: z.string(),
  status: z.enum(["accepted", "edited", "rejected"]),
  labelEn: z.string().optional(),
  labelZh: z.string().optional(),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("consent"), accepted: z.literal(true) }),
  z.object({
    action: z.literal("save_labels"),
    labels: z.array(z.string().min(1).max(80)).min(1).max(30),
    idempotencyKey: z.string().min(8).max(128),
  }),
  z.object({
    action: z.literal("run_ai"),
    stage: z.enum(["image_analysis", "ai_concept_map", "sentence_scaffold"]),
  }),
  z.object({
    action: z.literal("review_vocabulary"),
    decisions: z.array(decisionSchema).min(1).max(30),
  }),
  z.object({
    action: z.literal("review_concepts"),
    accepted: z.object({
      nodes: z.array(conceptNodeSchema).max(50),
      edges: z.array(conceptEdgeSchema).max(100),
    }),
    rejectedIds: z.array(z.string()).max(100),
  }),
  z.object({
    action: z.literal("save_sentences"),
    sentences: z.array(z.string().min(2).max(500)).min(1).max(20),
    hintLevel: z.number().int().min(0).max(3),
    idempotencyKey: z.string().min(8).max(128),
  }),
  z.object({
    action: z.literal("complete_stage"),
    stage: z.enum(STAGE_IDS),
    stateVersion: z.number().int().positive(),
  }),
]);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const claims = await getStudentClaims();
    if (!claims) throw new ApiError(401, "UNAUTHORIZED", "請先輸入學生代碼。");
    const body = bodySchema.parse(await request.json());
    const view = await getSessionView(claims.sessionId);

    if (body.action !== "consent" && !view.session.consented) {
      throw new ApiError(409, "CONSENT_REQUIRED", "請先閱讀並同意資料說明。");
    }

    switch (body.action) {
      case "consent":
        await recordConsent(claims.sessionId);
        break;
      case "save_labels":
        if (view.session.currentStage !== "visualization") {
          throw new ApiError(409, "STAGE_LOCKED", "目前不是手繪標記階段。");
        }
        await replaceArtifactData({
          sessionId: claims.sessionId,
          stageId: "visualization",
          type: "self_labels",
          data: { labels: body.labels },
        });
        await saveMessage({
          sessionId: claims.sessionId,
          stageId: "visualization",
          role: "student",
          kind: "labels",
          content: { labels: body.labels },
          idempotencyKey: body.idempotencyKey,
        });
        break;
      case "run_ai":
        await runStageAI(claims.sessionId, body.stage);
        if (body.stage === "image_analysis") {
          const updated = await getSessionView(claims.sessionId);
          const output = updated.artifacts.find(
            (artifact) =>
              artifact.stageId === "image_analysis" &&
              artifact.type === "image_analysis",
          );
          const suggestions = Array.isArray(output?.data.suggestions)
            ? output.data.suggestions
            : [];
          await replaceArtifactData({
            sessionId: claims.sessionId,
            stageId: "image_analysis",
            type: "vocabulary_decisions",
            data: {
              pending: suggestions.map((item) =>
                typeof item === "object" && item && "id" in item
                  ? String(item.id)
                  : crypto.randomUUID(),
              ),
              accepted: [],
              rejected: [],
            },
          });
        }
        break;
      case "review_vocabulary":
        if (view.session.currentStage !== "image_analysis") {
          throw new ApiError(409, "STAGE_LOCKED", "目前不是詞彙審核階段。");
        }
        await replaceArtifactData({
          sessionId: claims.sessionId,
          stageId: "image_analysis",
          type: "vocabulary_decisions",
          data: {
            pending: [],
            accepted: body.decisions.filter(
              (decision) => decision.status !== "rejected",
            ),
            rejected: body.decisions.filter(
              (decision) => decision.status === "rejected",
            ),
          },
        });
        await saveMessage({
          sessionId: claims.sessionId,
          stageId: "image_analysis",
          role: "student",
          kind: "vocabulary_decisions",
          content: { decisions: body.decisions },
        });
        break;
      case "review_concepts":
        if (view.session.currentStage !== "ai_concept_map") {
          throw new ApiError(409, "STAGE_LOCKED", "目前不是概念審核階段。");
        }
        await replaceArtifactData({
          sessionId: claims.sessionId,
          stageId: "ai_concept_map",
          type: "concept_decisions",
          data: {
            pending: [],
            accepted: body.accepted,
            rejectedIds: body.rejectedIds,
          },
        });
        await saveMessage({
          sessionId: claims.sessionId,
          stageId: "ai_concept_map",
          role: "student",
          kind: "concept_decisions",
          content: {
            accepted: body.accepted,
            rejectedIds: body.rejectedIds,
          },
        });
        break;
      case "save_sentences":
        if (view.session.currentStage !== "sentence_scaffold") {
          throw new ApiError(409, "STAGE_LOCKED", "目前不是句型鷹架階段。");
        }
        await replaceArtifactData({
          sessionId: claims.sessionId,
          stageId: "sentence_scaffold",
          type: "sentences",
          data: {
            sentences: body.sentences,
            hintLevel: body.hintLevel,
          },
        });
        await saveMessage({
          sessionId: claims.sessionId,
          stageId: "sentence_scaffold",
          role: "student",
          kind: "sentences",
          content: {
            sentences: body.sentences,
            hintLevel: body.hintLevel,
          },
          idempotencyKey: body.idempotencyKey,
        });
        break;
      case "complete_stage":
        if (body.stage !== view.session.currentStage) {
          throw new ApiError(409, "STAGE_LOCKED", "不能完成非目前階段。");
        }
        await completeCurrentStage(claims.sessionId, body.stateVersion);
        break;
    }

    return NextResponse.json({
      ok: true,
      data: await getSessionView(claims.sessionId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
