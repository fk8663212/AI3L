import {
  DEFAULT_TASK_PROMPT_CONFIG,
  effectiveConceptExpansionTemplate,
  effectiveImageAnalysisTemplate,
  type TaskPromptConfig,
} from "@/lib/ai/prompts";
import { STAGES, type StageId } from "@/lib/domain/stages";
import { hashForLog } from "@/lib/security/crypto";

export type PromptAuditCall = {
  id: string;
  title: string;
  purpose: string;
  systemLabel: string | null;
  systemPrompt: string | null;
  systemHash: string | null;
  userPromptTemplate: string;
  templateHash: string;
  variables: string[];
  providerNote: string | null;
  providerPrompt: string | null;
  providerPromptHash: string | null;
};

function promptCall(input: {
  id: string;
  title: string;
  purpose: string;
  systemLabel?: string;
  systemPrompt?: string;
  userPromptTemplate: string;
  variables: string[];
  providerNote?: string;
  providerPrompt?: string;
}): PromptAuditCall {
  return {
    id: input.id,
    title: input.title,
    purpose: input.purpose,
    systemLabel: input.systemLabel ?? null,
    systemPrompt: input.systemPrompt ?? null,
    systemHash: input.systemPrompt ? hashForLog(input.systemPrompt) : null,
    userPromptTemplate: input.userPromptTemplate,
    templateHash: hashForLog(input.userPromptTemplate),
    variables: input.variables,
    providerNote: input.providerNote ?? null,
    providerPrompt: input.providerPrompt ?? null,
    providerPromptHash: input.providerPrompt
      ? hashForLog(input.providerPrompt)
      : null,
  };
}

function transcriptionCall(config: TaskPromptConfig): PromptAuditCall {
  return promptCall({
    id: "speech_transcription",
    title: "忠實英語逐字稿",
    purpose: "保留學生原話、停頓與文法錯誤，不替學生潤稿。",
    systemLabel: "Gemini system instruction",
    systemPrompt: config.googleTranscriptionSystemPrompt,
    userPromptTemplate: config.transcriptionTemplate,
    variables: ["recording.durationSeconds", "recording.audio"],
    providerNote:
      "Gemini 使用上方 system instruction 與使用者模板；OpenAI 使用專用轉錄 API，並將下方文字放入 transcription prompt。",
    providerPrompt: config.openaiTranscriptionPrompt,
  });
}

function speechEvaluationCall(config: TaskPromptConfig): PromptAuditCall {
  return promptCall({
    id: "speech_evaluation",
    title: "口說描述性分析",
    purpose: "依逐字稿產生研究用途的內容、語速與組織描述。",
    systemLabel: "Speech evaluation system prompt",
    systemPrompt: config.speechEvaluationSystemPrompt,
    userPromptTemplate: config.speechEvaluationTemplate,
    variables: [
      "stage.id",
      "recording.transcriptJson",
      "recording.durationSeconds",
      "recording.wordsPerMinute",
    ],
  });
}

const stageCalls: Record<
  StageId,
  (config: TaskPromptConfig) => PromptAuditCall[]
> = {
  pretest: (config) => [
    transcriptionCall(config),
    speechEvaluationCall(config),
  ],
  visualization: () => [],
  self_concept_map: () => [],
  image_analysis: (config) => [
    promptCall({
      id: "image_analysis",
      title: "手繪圖結構化分析",
      purpose:
        "辨識學生手繪圖中的元素、回傳標準化座標，形成可審核的英文標記版本。",
      systemLabel: "AI scaffold system prompt",
      systemPrompt: config.baseSystemPrompt,
      userPromptTemplate: effectiveImageAnalysisTemplate(
        config.imageAnalysisTemplate,
      ),
      variables: ["task.title", "student.labels", "student.drawing"],
    }),
  ],
  ai_concept_map: (config) => [
    promptCall({
      id: "concept_expansion",
      title: "生成新的擴充概念圖",
      purpose:
        "讀取學生上傳的手繪概念圖，與已確認詞彙整合，生成具有節點、方向連線與關係標籤的新概念圖。",
      systemLabel: "AI scaffold system prompt",
      systemPrompt: config.baseSystemPrompt,
      userPromptTemplate: effectiveConceptExpansionTemplate(
        config.conceptExpansionTemplate,
      ),
      variables: [
        "task.title",
        "student.handDrawnConceptMapImage",
        "student.conceptMapJson",
        "student.acceptedVocabularyJson",
      ],
    }),
  ],
  sentence_scaffold: (config) => [
    promptCall({
      id: "sentence_scaffold",
      title: "漸進式句型鷹架",
      purpose: "產生關鍵詞、句首、示範句與轉折詞供學生選擇。",
      systemLabel: "AI scaffold system prompt",
      systemPrompt: config.baseSystemPrompt,
      userPromptTemplate: config.sentenceScaffoldTemplate,
      variables: [
        "task.title",
        "student.finalConceptMapJson",
        "student.sentencesJson",
      ],
    }),
    transcriptionCall(config),
    speechEvaluationCall(config),
  ],
  posttest: (config) => [
    transcriptionCall(config),
    speechEvaluationCall(config),
  ],
};

export function promptAuditCatalog(
  config: TaskPromptConfig = DEFAULT_TASK_PROMPT_CONFIG,
) {
  return {
    baseSystemPrompt: config.baseSystemPrompt,
    baseSystemHash: hashForLog(config.baseSystemPrompt),
    contextPolicy: {
      included: [
        "任務名稱 task.title",
        "當前階段需要的學生作品",
        "學生自行接受、修改或輸入的內容",
        "錄音長度、逐字稿與基礎語速估計",
      ],
      excluded: [
        "任務摘要 task.description",
        "學生代碼與管理員資料",
        "其他學生的工作階段",
        "未到達階段的提示內容",
      ],
    },
    stages: STAGES.map((stage) => ({
      ...stage,
      calls: stageCalls[stage.id](config),
    })),
  };
}
