import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  accessCodes,
  auditLogs,
  studentSessions,
  tasks,
} from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import {
  DEFAULT_TASK_CONFIG,
  normalizeTaskConfig,
} from "@/lib/domain/default-task";
import {
  apiErrorResponse,
  ApiError,
  assertSameOrigin,
} from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";

const V1_ID = "6f7a3ccb-56a0-4f2c-8f9d-197fcc35a39c";
const V2_ID = "5c538c11-78bc-402d-a131-e6bdedb30311";

async function taskCount(
  table: typeof studentSessions | typeof accessCodes,
  taskId: string,
) {
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(table)
    .where(eq(table.taskId, taskId));
  return Number(rows[0]?.count ?? 0);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(await getAdminClaims())) {
      throw new ApiError(401, "UNAUTHORIZED", "請先登入管理後台。");
    }

    const db = getDb();
    const [v1, v2] = await Promise.all([
      db.query.tasks.findFirst({ where: eq(tasks.id, V1_ID) }),
      db.query.tasks.findFirst({ where: eq(tasks.id, V2_ID) }),
    ]);
    if (!v1 || !v2) {
      throw new ApiError(404, "TASK_NOT_FOUND", "找不到指定的 v1 或 v2 任務。");
    }
    if (
      v1.version !== 1 ||
      v2.version !== 2 ||
      v1.familyId !== v2.familyId ||
      v2.status !== "published"
    ) {
      throw new ApiError(
        409,
        "TASK_IDENTITY_MISMATCH",
        "任務版本、family 或發布狀態不符，拒絕修復。",
      );
    }

    const v2Sessions = await taskCount(studentSessions, v2.id);
    if (v2Sessions !== 0) {
      throw new ApiError(
        409,
        "TASK_ALREADY_USED",
        `v2 已有 ${v2Sessions} 個工作階段，拒絕修改已使用的研究版本。`,
      );
    }

    const sourceConfig = normalizeTaskConfig(v1.config);
    const fixedConfig = normalizeTaskConfig({
      ...sourceConfig,
      stageConfig: {
        ...sourceConfig.stageConfig,
        image_analysis: DEFAULT_TASK_CONFIG.stageConfig.image_analysis,
        ai_concept_map: DEFAULT_TASK_CONFIG.stageConfig.ai_concept_map,
      },
      promptConfig: {
        ...sourceConfig.promptConfig,
        imageAnalysisTemplate:
          DEFAULT_TASK_CONFIG.promptConfig.imageAnalysisTemplate,
        conceptExpansionTemplate:
          DEFAULT_TASK_CONFIG.promptConfig.conceptExpansionTemplate,
      },
    });

    await db
      .update(tasks)
      .set({
        slug: v1.slug,
        title: v1.title,
        description: v1.description,
        provider: v1.provider,
        modelId: v1.modelId,
        promptVersion: "2.0.0",
        config: fixedConfig,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.id, v2.id),
          eq(tasks.version, 2),
          eq(tasks.status, "published"),
        ),
      );
    await db.insert(auditLogs).values({
      actor: "admin-maintenance",
      action: "task.published_config_encoding_repaired",
      targetType: "task",
      targetId: v2.id,
      detail: {
        reason:
          "Repair UTF-8 corruption introduced during initial v2 provisioning before any student session started.",
        sourceTaskId: v1.id,
        sessionCountAtRepair: v2Sessions,
        promptVersion: "2.0.0",
      },
    });

    const repaired = await db.query.tasks.findFirst({
      where: eq(tasks.id, v2.id),
    });
    if (!repaired) {
      throw new ApiError(
        500,
        "REPAIR_VERIFICATION_FAILED",
        "修復後無法重新讀取 v2。",
      );
    }
    const repairedConfig = normalizeTaskConfig(repaired.config);
    const checks = {
      titleRestored: repaired.title === v1.title,
      descriptionRestored: repaired.description === v1.description,
      imageInstructionUpdated:
        repairedConfig.stageConfig.image_analysis.instruction ===
        DEFAULT_TASK_CONFIG.stageConfig.image_analysis.instruction,
      conceptInstructionUpdated:
        repairedConfig.stageConfig.ai_concept_map.instruction ===
        DEFAULT_TASK_CONFIG.stageConfig.ai_concept_map.instruction,
      imagePromptUpdated:
        repairedConfig.promptConfig.imageAnalysisTemplate ===
        DEFAULT_TASK_CONFIG.promptConfig.imageAnalysisTemplate,
      conceptPromptUpdated:
        repairedConfig.promptConfig.conceptExpansionTemplate ===
        DEFAULT_TASK_CONFIG.promptConfig.conceptExpansionTemplate,
    };
    if (Object.values(checks).some((value) => !value)) {
      throw new ApiError(
        500,
        "REPAIR_VERIFICATION_FAILED",
        "v2 UTF-8 修復後的內容驗證失敗。",
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        v1: {
          id: v1.id,
          version: v1.version,
          sessions: await taskCount(studentSessions, v1.id),
        },
        v2: {
          id: repaired.id,
          version: repaired.version,
          status: repaired.status,
          promptVersion: repaired.promptVersion,
          sessions: await taskCount(studentSessions, repaired.id),
          accessCodes: await taskCount(accessCodes, repaired.id),
          checks,
        },
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
