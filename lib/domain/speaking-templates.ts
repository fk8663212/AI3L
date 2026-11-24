import { z } from "zod";
import { POSTTEST_REFERENCE_INSTRUCTION, STAGES, type StageId } from "@/lib/domain/stages";
import type { TaskConfig } from "@/lib/domain/default-task";

export const speakingTemplateIdSchema = z.enum(["spatial", "chronological", "problem_solution"]);
export const speakingTemplateSchema = z.object({
  id: speakingTemplateIdSchema,
  version: z.literal("1.0.0"),
});
export type SpeakingTemplate = z.infer<typeof speakingTemplateSchema>;
export type SpeakingTemplateId = SpeakingTemplate["id"];
export type SpeakingTemplateChoice = SpeakingTemplateId | "legacy";

export const SPEAKING_TEMPLATES = {
  spatial: {
    label: "空間／導覽順序",
    english: "Spatial Order",
    description: "適合街區導覽、展覽介紹與場域觀察。",
    sequence: "入口與全貌 → 場域氛圍 → 展品與特色細節 → 個人總結",
  },
  chronological: {
    label: "時間／流程順序",
    english: "Chronological / Procedural Order",
    description: "適合實作、實驗、料理過程與歷史事件。",
    sequence: "準備工作 → 核心步驟 → 狀況與排除（有資料時）→ 產出與檢驗",
  },
  problem_solution: {
    label: "因果／問題解決順序",
    english: "Cause and Effect / Problem-Solution Order",
    description: "適合問題探討、工程除錯、案例分析與 SDGs 專案。",
    sequence: "問題現況與背景 → 有依據的成因 → 解決策略與行動 → 預期成效或已觀察結果",
  },
} as const;

export function speakingTemplateSelection(
  choice?: SpeakingTemplateChoice,
): SpeakingTemplate | undefined {
  return choice && choice !== "legacy"
    ? { id: choice, version: "1.0.0" }
    : undefined;
}

export function parseSpeakingTemplate(value: unknown) {
  const parsed = speakingTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function sameSpeakingTemplate(left: unknown, right: unknown) {
  if (left == null && right == null) return true;
  const a = parseSpeakingTemplate(left);
  const b = parseSpeakingTemplate(right);
  return Boolean(a && b && a.id === b.id && a.version === b.version);
}

export function speakingTemplateLabel(value: unknown) {
  const selection = parseSpeakingTemplate(value);
  return selection
    ? SPEAKING_TEMPLATES[selection.id].label
    : "原有講述架構（未指定模板）";
}

export function speakingTemplateInstructions(
  id: SpeakingTemplateId,
): Record<StageId, string> {
  if (id === "problem_solution") return {
    pretest:
      "請用英文說明本次任務中你觀察到的情況與自己的想法。先說你目前想得到的內容，不需要擔心文法。",
    visualization:
      "畫下你觀察到的問題情境，包含相關人物、物件、現象或自己的處理經驗；上傳後先獨立標記至少三個你原本就知道的英文詞彙。",
    self_concept_map:
      "先自行在紙上手繪概念與有方向的關係，標出你知道的原因、影響或處理方式；用關係詞區分已知與推測，再拍照上傳，供後續 AI 整合擴充。",
    image_analysis:
      "核對 AI 標記的情況、物件與行動是否符合原圖或實際經驗，逐項接受、修改或拒絕；圖畫沒有提供的原因與成效不要當成事實。",
    ai_concept_map:
      "比較 AI 整合後的概念圖。AI 也會依活動背景提出待確認的可能原因或解法，請篩選符合內容的建議，保留推測與提案的語氣；再建立講述架構，檢查依據並區分預期成效與已觀察結果。",
    sentence_scaffold:
      "先寫下至少三個自己的英文句子，再依目前的講述架構取得分級提示，最後完成一段口說練習。",
    posttest: POSTTEST_REFERENCE_INSTRUCTION,
  };
  const temporal = id === "chronological";
  return {
    pretest: temporal
      ? "請用英文說明本次任務中的活動、製作經驗或事件。先說你目前想得到的內容，不需要擔心文法。"
      : "請用英文描述本次任務中你觀察到的場景與經驗。先說你目前想得到的內容，不需要擔心文法。",
    visualization: temporal
      ? "依自己的記憶畫下活動或事件，可用多個畫面呈現不同階段，畫出工具、材料、動作、人物或結果；上傳後先獨立標記至少三個你原本就知道的英文詞彙。"
      : "畫出你印象中的場景，包含人物、物件與事件；上傳後先獨立標記至少三個你原本就知道的英文詞彙。",
    self_concept_map: temporal
      ? "先自行在紙上手繪概念與有方向的關係，標出你知道的先後、動作與結果，再拍照上傳供後續 AI 整合；不確定的順序可以留待確認。"
      : "先自行在紙上手繪概念、方向連線與關係詞，完成後拍照上傳，供後續 AI 整合擴充。",
    image_analysis: temporal
      ? "核對 AI 標記的動作、材料、人物與結果是否真的出現在圖中，逐項接受、修改或拒絕；不確定的內容不要當成已發生的事。"
      : "查看 AI 標記後的手繪圖，逐項確認是否符合圖畫或實際經驗；你可以接受、修改或拒絕。",
    ai_concept_map: temporal
      ? "比較 AI 整合後的概念圖，篩選依活動背景提出的常見步驟或細節；補述不代表你真的做過。確認符合內容後建立時間／流程架構，並檢查實際先後。"
      : "比較 AI 整合後的概念圖，篩選依活動主題與簡介提出的特色或體驗；補述不代表你真的去過或做過。確認符合內容後建立空間／導覽架構。",
    sentence_scaffold:
      "先寫下至少三個自己的英文句子，再依目前的講述架構取得分級提示，最後完成一段口說練習。",
    posttest: POSTTEST_REFERENCE_INSTRUCTION,
  };
}

/** Preserve teacher-written instructions when changing the template. */
export function applySpeakingTemplateInstructions(
  current: TaskConfig["stageConfig"],
  next: SpeakingTemplateId,
  previous?: Record<StageId, string>,
): TaskConfig["stageConfig"] {
  const instructions = speakingTemplateInstructions(next);
  return Object.fromEntries(
    STAGES.map(({ id }) => [
      id,
      {
        ...current[id],
        instruction:
          !previous || current[id].instruction === previous[id]
            ? instructions[id]
            : current[id].instruction,
      },
    ]),
  ) as TaskConfig["stageConfig"];
}
