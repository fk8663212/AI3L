import type { StageId } from "@/lib/domain/stages";

export type TaskStageConfig = {
  instruction: string;
  minimumRecordingSeconds?: number;
  maximumRecordingSeconds?: number;
};

export type TaskConfig = {
  locale: "zh-TW";
  targetLanguage: "en";
  consentText: string;
  retentionDays: number;
  stageConfig: Record<StageId, TaskStageConfig>;
};

export const DEFAULT_TASK_CONFIG: TaskConfig = {
  locale: "zh-TW",
  targetLanguage: "en",
  consentText:
    "我了解本活動會保存我的文字、圖片與口說錄音，供教師進行學習與研究分析。",
  retentionDays: 180,
  stageConfig: {
    pretest: {
      instruction:
        "請用英文描述你在大稻埕年貨市場看到或經歷的事情。先說出目前想得到的內容，不需要擔心文法。",
      minimumRecordingSeconds: 30,
      maximumRecordingSeconds: 120,
    },
    visualization: {
      instruction:
        "畫出你印象中的場景，包含人物、物件與事件；再標記至少三個你原本就知道的英文詞彙。",
    },
    self_concept_map: {
      instruction:
        "先不用 AI，整理至少三個概念，並寫出至少兩個概念之間的英文關係。",
    },
    image_analysis: {
      instruction:
        "逐項確認 AI 的辨識是否真的出現在你的圖畫或經驗中。你可以接受、修改或拒絕。",
    },
    ai_concept_map: {
      instruction:
        "比較 AI 建議與自己的概念圖，只保留符合你實際經驗的節點與關係。",
    },
    sentence_scaffold: {
      instruction:
        "先嘗試自己造句。需要時再依序開啟關鍵詞、句首和完整示範句，最後完成一段口說練習。",
      minimumRecordingSeconds: 30,
      maximumRecordingSeconds: 120,
    },
    posttest: {
      instruction:
        "現在不會顯示先前的提示。請再次獨立用英文描述你的大稻埕年貨市場經驗。",
      minimumRecordingSeconds: 30,
      maximumRecordingSeconds: 120,
    },
  },
};

export const DEFAULT_TASK = {
  slug: "dadaocheng-lunar-new-year",
  title: "大稻埕年貨市場英語敘事",
  description:
    "以手繪、概念圖與 AI 鷹架，將大稻埕年貨市場經驗轉化為可表達的英語敘事。",
  provider: "google" as const,
  modelId: "gemini-3.6-flash",
  config: DEFAULT_TASK_CONFIG,
};
