export const STAGE_IDS = [
  "pretest",
  "visualization",
  "self_concept_map",
  "image_analysis",
  "ai_concept_map",
  "sentence_scaffold",
  "posttest",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export const STAGE_STATUSES = [
  "locked",
  "active",
  "waiting_ai",
  "review_required",
  "ready",
  "completed",
  "blocked",
] as const;

export type StageStatus = (typeof STAGE_STATUSES)[number];

export type StageDefinition = {
  id: StageId;
  order: number;
  shortLabel: string;
  title: string;
  description: string;
  aiEnabled: boolean;
};

export const STAGES: readonly StageDefinition[] = [
  {
    id: "pretest",
    order: 1,
    shortLabel: "前測",
    title: "獨立口說前測",
    description: "不使用 AI 或提示，先說出你目前想到的內容。",
    aiEnabled: false,
  },
  {
    id: "visualization",
    order: 2,
    shortLabel: "手繪",
    title: "手繪情境與自主標記",
    description: "上傳手繪圖並自主標記；系統同時在後台預先辨識更多詞彙。",
    aiEnabled: true,
  },
  {
    id: "self_concept_map",
    order: 3,
    shortLabel: "概念",
    title: "手繪原始概念圖",
    description: "在紙上整理概念、方向連線與關係詞，再拍照上傳。",
    aiEnabled: false,
  },
  {
    id: "image_analysis",
    order: 4,
    shortLabel: "辨識",
    title: "AI 圖像元素分析",
    description: "審核 AI 從手繪圖辨識出的元素與詞彙。",
    aiEnabled: true,
  },
  {
    id: "ai_concept_map",
    order: 5,
    shortLabel: "擴充",
    title: "AI 概念圖擴充",
    description: "比較 AI 建議與自己的概念圖，保留真正符合經驗的內容。",
    aiEnabled: true,
  },
  {
    id: "sentence_scaffold",
    order: 6,
    shortLabel: "句型",
    title: "句型鷹架與口說練習",
    description: "依需要逐步開啟關鍵詞、句首與完整例句。",
    aiEnabled: true,
  },
  {
    id: "posttest",
    order: 7,
    shortLabel: "後測",
    title: "無提示口說後測",
    description: "撤除所有鷹架後，再次獨立完成口說。",
    aiEnabled: false,
  },
] as const;

export type GateEvidence = {
  speakingOutlineRequired?: boolean;
  speakingOutlineReady?: boolean;
  audioCount: number;
  imageCount: number;
  selfLabelCount: number;
  pendingVocabularyDecisions: number;
  pendingConceptDecisions: number;
  sentenceCount: number;
  aiOutputReady: boolean;
  annotatedImageReady: boolean;
};

export type StageGateResult = {
  ok: boolean;
  code:
    | "OK"
    | "AUDIO_REQUIRED"
    | "IMAGE_REQUIRED"
    | "LABELS_REQUIRED"
    | "CONCEPT_MAP_REQUIRED"
    | "AI_OUTPUT_REQUIRED"
    | "REVIEW_REQUIRED"
    | "SENTENCES_REQUIRED"
    | "OUTLINE_REQUIRED";
  message: string;
};

const ok = (): StageGateResult => ({
  ok: true,
  code: "OK",
  message: "此階段已符合完成條件。",
});

export function evaluateStageGate(
  stage: StageId,
  evidence: GateEvidence,
): StageGateResult {
  switch (stage) {
    case "pretest":
    case "posttest":
      return evidence.audioCount >= 1
        ? ok()
        : {
            ok: false,
            code: "AUDIO_REQUIRED",
            message: "請先完成並成功保存一段口說錄音。",
          };
    case "visualization":
      if (evidence.imageCount < 1) {
        return {
          ok: false,
          code: "IMAGE_REQUIRED",
          message: "請先上傳一張手繪情境圖。",
        };
      }
      return evidence.selfLabelCount >= 3
        ? ok()
        : {
            ok: false,
            code: "LABELS_REQUIRED",
            message: "請至少加入三個你原本就知道的英文標記。",
          };
    case "self_concept_map":
      return evidence.imageCount >= 1
        ? ok()
        : {
            ok: false,
            code: "CONCEPT_MAP_REQUIRED",
            message: "請先上傳一張由學生自行完成的手繪概念圖。",
          };
    case "image_analysis":
      if (!evidence.aiOutputReady || !evidence.annotatedImageReady) {
        return {
          ok: false,
          code: "AI_OUTPUT_REQUIRED",
          message: "請先取得 AI 已在手繪圖上完成標記的版本。",
        };
      }
      return evidence.pendingVocabularyDecisions === 0
        ? ok()
        : {
            ok: false,
            code: "REVIEW_REQUIRED",
            message: "請接受、修改或拒絕每一項 AI 詞彙建議。",
          };
    case "ai_concept_map":
      if (!evidence.aiOutputReady) {
        return {
          ok: false,
          code: "AI_OUTPUT_REQUIRED",
          message: "請先產生 AI 概念圖建議。",
        };
      }
      if (evidence.pendingConceptDecisions === 0 && evidence.speakingOutlineRequired && !evidence.speakingOutlineReady) {
        return { ok: false, code: "OUTLINE_REQUIRED", message: "請依任務模板建立 Macro／Micro 講述架構。" };
      }
      return evidence.pendingConceptDecisions === 0
        ? ok()
        : {
            ok: false,
            code: "REVIEW_REQUIRED",
            message: "請審核所有 AI 概念與關係建議。",
          };
    case "sentence_scaffold":
      if (evidence.speakingOutlineRequired && !evidence.speakingOutlineReady) {
        return { ok: false, code: "OUTLINE_REQUIRED", message: "請先依任務模板建立目前概念圖的講述架構。" };
      }
      if (!evidence.aiOutputReady) {
        return {
          ok: false,
          code: "AI_OUTPUT_REQUIRED",
          message: "請先取得本階段的 AI 語言鷹架。",
        };
      }
      if (evidence.sentenceCount < 3) {
        return {
          ok: false,
          code: "SENTENCES_REQUIRED",
          message: "請先完成至少三個自己的英文句子。",
        };
      }
      return evidence.audioCount >= 1
        ? ok()
        : {
            ok: false,
            code: "AUDIO_REQUIRED",
            message: "請完成一段使用鷹架的口說練習。",
          };
  }
}

export function nextStage(stage: StageId): StageId | null {
  const index = STAGE_IDS.indexOf(stage);
  return index >= 0 && index < STAGE_IDS.length - 1
    ? STAGE_IDS[index + 1]
    : null;
}

export function assertStageTransition(
  current: StageId,
  requested: StageId,
): void {
  if (nextStage(current) !== requested) {
    throw new Error(`Invalid stage transition: ${current} -> ${requested}`);
  }
}
