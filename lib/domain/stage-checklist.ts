import { conceptMapSchema } from "@/lib/ai/schemas";
import { validSpeakingOutline } from "@/lib/domain/speaking-outline";
import type { StageId } from "@/lib/domain/stages";

export type ChecklistStep = { label: string; done: boolean };

type ArtifactLike = {
  id?: string;
  stageId: StageId;
  type: string;
  status?: string;
  data: Record<string, unknown>;
};

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * The concrete steps a student must finish in the current stage, in order.
 * Mirrors the server's stage gate (which stays the authority) so the student
 * can see exactly what is left instead of one generic message.
 */
export function stageChecklist(
  stage: StageId,
  artifacts: readonly ArtifactLike[],
  recording: { minimumSeconds?: number; maximumSeconds?: number } = {},
): ChecklistStep[] {
  const find = (type: string, stageId: StageId = stage) =>
    artifacts.find((item) => item.stageId === stageId && item.type === type);
  const has = (type: string, stageId: StageId = stage) => Boolean(find(type, stageId));
  const range =
    recording.minimumSeconds && recording.maximumSeconds
      ? `${recording.minimumSeconds}–${recording.maximumSeconds} 秒`
      : "";

  switch (stage) {
    case "pretest":
    case "posttest":
      return [{ label: `錄一段${range ? ` ${range}的` : ""}英文口說`, done: has("audio") }];
    case "visualization":
      return [
        { label: "上傳你的手繪情境圖", done: has("image") },
        {
          label: "保存至少 3 個你原本就知道的英文詞",
          done: count(find("self_labels")?.data.labels) >= 3,
        },
      ];
    case "self_concept_map":
      return [{ label: "上傳你在紙上畫的概念圖照片", done: has("image") }];
    case "image_analysis": {
      const decisions = find("vocabulary_decisions");
      return [
        { label: "取得 AI 標記後的手繪圖", done: has("annotated_image") },
        {
          label: "逐項決定接受、修改或拒絕 AI 的詞彙",
          done: Boolean(decisions) && count(decisions?.data.pending) === 0 &&
            count(decisions?.data.accepted) + count(decisions?.data.rejected) > 0,
        },
      ];
    }
    case "ai_concept_map": {
      const decisions = find("concept_decisions");
      return [
        {
          label: "產生 AI 擴充概念圖",
          done: has("generated_concept_map") || has("ai_concept_map"),
        },
        {
          label: "決定保留或移除每個 AI 新增的概念與關係",
          done: Boolean(decisions) && count(decisions?.data.pending) === 0,
        },
      ];
    }
    case "sentence_scaffold": {
      const map = conceptMapSchema.safeParse(find("concept_decisions", "ai_concept_map")?.data.accepted);
      const outline = find("speaking_outline", "ai_concept_map");
      const hasOutline = map.success && validSpeakingOutline(outline?.data, map.data);
      const hintsCurrent = has("sentence_scaffold") && (!hasOutline || find("sentence_scaffold")?.data.speakingOutlineId === outline?.id);
      return [
        {
          label: "寫下並保存至少 3 個自己的英文句子",
          done: count(find("sentences")?.data.sentences) >= 3,
        },
        { label: hasOutline ? "取得與目前講述段落相符的提示" : "取得分級提示", done: hintsCurrent },
        { label: "錄一段口說練習", done: has("audio") },
      ];
    }
  }
}
