import { NextResponse } from "next/server";
import { z } from "zod";
import {
  conceptEdgeSchema,
  conceptMapSchema,
  conceptNodeSchema,
  imageAnalysisSchema,
} from "@/lib/ai/schemas";
import { runStageAI } from "@/lib/ai/provider-service";
import {
  ReviewDecisionError,
  resolveConceptReview,
  resolveVocabularyReview,
} from "@/lib/domain/review-decisions";
import { STAGE_IDS } from "@/lib/domain/stages";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  apiErrorResponse,
  ApiError,
  assertSameOrigin,
} from "@/lib/security/request";
import { getStudentClaims } from "@/lib/security/session";
import {
  completeCurrentStage,
  getSessionView,
  type SessionView,
  recordConsent,
  replaceArtifactData,
  saveMessage,
} from "@/lib/services/session-service";

export const maxDuration = 60;

const AI_RUN_LIMIT = 12;
const AI_RUN_WINDOW_MS = 10 * 60 * 1000;

function currentArtifactData(
  view: SessionView,
  stageId: SessionView["session"]["currentStage"],
  types: readonly string[],
) {
  return view.artifacts.find(
    (artifact) => artifact.stageId === stageId && types.includes(artifact.type),
  )?.data;
}

function asReviewError(error: unknown): never {
  if (error instanceof ReviewDecisionError) {
    throw new ApiError(400, error.code, error.message);
  }
  throw error;
}

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
    // Kept for client compatibility; the server rebuilds the accepted map.
    accepted: z
      .object({
        nodes: z.array(conceptNodeSchema).max(50),
        edges: z.array(conceptEdgeSchema).max(100),
      })
      .optional(),
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
        await enforceRateLimit(
          `student-ai:${claims.sessionId}`,
          AI_RUN_LIMIT,
          AI_RUN_WINDOW_MS,
        );
        await runStageAI(claims.sessionId, body.stage);
        break;
      case "review_vocabulary":
        if (view.session.currentStage !== "image_analysis") {
          throw new ApiError(409, "STAGE_LOCKED", "目前不是詞彙審核階段。");
        }
        {
          const analysis = imageAnalysisSchema.safeParse(
            currentArtifactData(view, "image_analysis", ["image_analysis"]),
          );
          if (!analysis.success) {
            throw new ApiError(
              409,
              "AI_OUTPUT_REQUIRED",
              "請先取得 AI 詞彙建議後再審核。",
            );
          }
          let review: ReturnType<typeof resolveVocabularyReview>;
          try {
            review = resolveVocabularyReview(
              analysis.data.suggestions,
              body.decisions,
            );
          } catch (error) {
            asReviewError(error);
          }
          await replaceArtifactData({
            sessionId: claims.sessionId,
            stageId: "image_analysis",
            type: "vocabulary_decisions",
            data: review,
          });
          await saveMessage({
            sessionId: claims.sessionId,
            stageId: "image_analysis",
            role: "student",
            kind: "vocabulary_decisions",
            content: { decisions: [...review.accepted, ...review.rejected] },
          });
        }
        break;
      case "review_concepts":
        if (view.session.currentStage !== "ai_concept_map") {
          throw new ApiError(409, "STAGE_LOCKED", "目前不是概念審核階段。");
        }
        {
          const generated = conceptMapSchema.safeParse(
            currentArtifactData(view, "ai_concept_map", [
              "generated_concept_map",
              "ai_concept_map",
            ]),
          );
          if (!generated.success) {
            throw new ApiError(
              409,
              "AI_OUTPUT_REQUIRED",
              "請先產生 AI 概念圖建議後再審核。",
            );
          }
          let review: ReturnType<typeof resolveConceptReview>;
          try {
            review = resolveConceptReview(generated.data, body.rejectedIds);
          } catch (error) {
            asReviewError(error);
          }
          await replaceArtifactData({
            sessionId: claims.sessionId,
            stageId: "ai_concept_map",
            type: "concept_decisions",
            data: review,
          });
          await saveMessage({
            sessionId: claims.sessionId,
            stageId: "ai_concept_map",
            role: "student",
            kind: "concept_decisions",
            content: {
              accepted: review.accepted,
              rejectedIds: review.rejectedIds,
            },
          });
        }
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
