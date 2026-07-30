import type { StageId } from "@/lib/domain/stages";
import {
  DEFAULT_TASK_PROMPT_CONFIG,
  type TaskPromptConfig,
} from "@/lib/ai/prompts";

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
  promptConfig: TaskPromptConfig;
};

export const DEFAULT_TASK_CONFIG: TaskConfig = {
  locale: "zh-TW",
  targetLanguage: "en",
  consentText:
    "我了解本活動會保存我的文字、圖片與口說錄音，供教師進行學習與研究分析。",
  retentionDays: 180,
  promptConfig: DEFAULT_TASK_PROMPT_CONFIG,
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
        "查看 AI 已標記英文詞彙的手繪圖版本，逐項確認辨識內容是否真的出現在圖畫或經驗中；你可以接受、修改或拒絕。",
    },
    ai_concept_map: {
      instruction:
        "比較 AI 生成的新概念圖與自己的原始概念圖，只保留能幫助描述實際經驗的節點與關係。",
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

export function normalizeTaskConfig(
  config: Partial<TaskConfig> | null | undefined,
): TaskConfig {
  const sourceStages = config?.stageConfig;
  return {
    locale: config?.locale ?? DEFAULT_TASK_CONFIG.locale,
    targetLanguage:
      config?.targetLanguage ?? DEFAULT_TASK_CONFIG.targetLanguage,
    consentText: config?.consentText ?? DEFAULT_TASK_CONFIG.consentText,
    retentionDays:
      config?.retentionDays ?? DEFAULT_TASK_CONFIG.retentionDays,
    promptConfig: {
      ...DEFAULT_TASK_PROMPT_CONFIG,
      ...(config?.promptConfig ?? {}),
    },
    stageConfig: {
      pretest: {
        ...DEFAULT_TASK_CONFIG.stageConfig.pretest,
        ...sourceStages?.pretest,
      },
      visualization: {
        ...DEFAULT_TASK_CONFIG.stageConfig.visualization,
        ...sourceStages?.visualization,
      },
      self_concept_map: {
        ...DEFAULT_TASK_CONFIG.stageConfig.self_concept_map,
        ...sourceStages?.self_concept_map,
      },
      image_analysis: {
        ...DEFAULT_TASK_CONFIG.stageConfig.image_analysis,
        ...sourceStages?.image_analysis,
      },
      ai_concept_map: {
        ...DEFAULT_TASK_CONFIG.stageConfig.ai_concept_map,
        ...sourceStages?.ai_concept_map,
      },
      sentence_scaffold: {
        ...DEFAULT_TASK_CONFIG.stageConfig.sentence_scaffold,
        ...sourceStages?.sentence_scaffold,
      },
      posttest: {
        ...DEFAULT_TASK_CONFIG.stageConfig.posttest,
        ...sourceStages?.posttest,
      },
    },
  };
}

export const DEFAULT_TASK = {
  slug: "dadaocheng-lunar-new-year",
  title: "大稻埕年貨市場英語敘事",
  description:
    "以手繪、概念圖與 AI 鷹架，將大稻埕年貨市場經驗轉化為可表達的英語敘事。",
  provider: "google" as const,
  modelId: "gemini-3.6-flash",
  config: DEFAULT_TASK_CONFIG,
};
