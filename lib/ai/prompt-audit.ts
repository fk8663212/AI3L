import {
  BASE_SYSTEM_PROMPT,
  CONCEPT_EXPANSION_PROMPT_TEMPLATE,
  GOOGLE_TRANSCRIPTION_SYSTEM_PROMPT,
  IMAGE_ANALYSIS_PROMPT_TEMPLATE,
  OPENAI_TRANSCRIPTION_PROMPT,
  SENTENCE_SCAFFOLD_PROMPT_TEMPLATE,
  SPEECH_EVALUATION_PROMPT_TEMPLATE,
  SPEECH_EVALUATION_SYSTEM_PROMPT,
  TRANSCRIPTION_PROMPT_TEMPLATE,
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

function transcriptionCall(): PromptAuditCall {
  return promptCall({
    id: "speech_transcription",
    title: "忠實英語逐字稿",
    purpose: "保留學生原話、停頓與文法錯誤，不替學生潤稿。",
    systemLabel: "Gemini system instruction",
    systemPrompt: GOOGLE_TRANSCRIPTION_SYSTEM_PROMPT,
    userPromptTemplate: TRANSCRIPTION_PROMPT_TEMPLATE,
    variables: ["recording.durationSeconds", "recording.audio"],
    providerNote:
      "Gemini 使用上方 system instruction 與使用者模板；OpenAI 使用專用轉錄 API，並將下方文字放入 transcription prompt。",
    providerPrompt: OPENAI_TRANSCRIPTION_PROMPT,
  });
}

function speechEvaluationCall(): PromptAuditCall {
  return promptCall({
    id: "speech_evaluation",
    title: "口說描述性分析",
    purpose: "依逐字稿產生研究用途的內容、語速與組織描述。",
    systemLabel: "Speech evaluation system prompt",
    systemPrompt: SPEECH_EVALUATION_SYSTEM_PROMPT,
    userPromptTemplate: SPEECH_EVALUATION_PROMPT_TEMPLATE,
    variables: [
      "stage.id",
      "recording.transcriptJson",
      "recording.durationSeconds",
      "recording.wordsPerMinute",
    ],
  });
}

const stageCalls: Record<StageId, () => PromptAuditCall[]> = {
  pretest: () => [transcriptionCall(), speechEvaluationCall()],
  visualization: () => [],
  self_concept_map: () => [],
  image_analysis: () => [
    promptCall({
      id: "image_analysis",
      title: "手繪圖結構化分析",
      purpose: "從學生手繪圖提出可審核的英語詞彙與圖像證據。",
      systemLabel: "AI scaffold system prompt",
      systemPrompt: BASE_SYSTEM_PROMPT,
      userPromptTemplate: IMAGE_ANALYSIS_PROMPT_TEMPLATE,
      variables: ["task.title", "student.labels", "student.drawing"],
    }),
  ],
  ai_concept_map: () => [
    promptCall({
      id: "concept_expansion",
      title: "概念圖擴展",
      purpose: "在保留學生原始概念的前提下提出少量可選節點與關係。",
      systemLabel: "AI scaffold system prompt",
      systemPrompt: BASE_SYSTEM_PROMPT,
      userPromptTemplate: CONCEPT_EXPANSION_PROMPT_TEMPLATE,
      variables: [
        "task.title",
        "student.conceptMapJson",
        "student.acceptedVocabularyJson",
      ],
    }),
  ],
  sentence_scaffold: () => [
    promptCall({
      id: "sentence_scaffold",
      title: "漸進式句型鷹架",
      purpose: "產生關鍵詞、句首、示範句與轉折詞供學生選擇。",
      systemLabel: "AI scaffold system prompt",
      systemPrompt: BASE_SYSTEM_PROMPT,
      userPromptTemplate: SENTENCE_SCAFFOLD_PROMPT_TEMPLATE,
      variables: [
        "task.title",
        "student.finalConceptMapJson",
        "student.sentencesJson",
      ],
    }),
    transcriptionCall(),
    speechEvaluationCall(),
  ],
  posttest: () => [transcriptionCall(), speechEvaluationCall()],
};

export function promptAuditCatalog() {
  return {
    baseSystemPrompt: BASE_SYSTEM_PROMPT,
    baseSystemHash: hashForLog(BASE_SYSTEM_PROMPT),
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
      calls: stageCalls[stage.id](),
    })),
  };
}
