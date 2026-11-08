import { SPEAKING_OUTLINE_TEMPLATE, PARAGRAPH_HINTS_CONTRACT, speakingOutlineTemplate, templateAnalysisContract, paragraphHintsContract } from "@/lib/ai/speaking-outline-prompt";
import type { SpeakingTemplate } from "@/lib/domain/speaking-templates";
import {
  DEFAULT_TASK_PROMPT_CONFIG,
  effectiveConceptExpansionTemplate,
  effectiveSentenceScaffoldTemplate,
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

function imageAnalysisCall(
  config: TaskPromptConfig,
  input: { id: string; title: string; purpose: string },
): PromptAuditCall {
  return promptCall({
    ...input,
    systemLabel: "AI scaffold system prompt",
    systemPrompt: config.baseSystemPrompt,
    userPromptTemplate: effectiveImageAnalysisTemplate(
      config.imageAnalysisTemplate,
    ),
    variables: ["task.title", "student.labels", "student.drawing"],
  });
}

function outlineCall(config: TaskPromptConfig): PromptAuditCall {
  return promptCall({ id: "speaking_outline", title: "Macro／Micro 講述架構", purpose: "只依已確認概念安排講述順序與各段子圖，不提前提供語言提示。", systemLabel: "AI scaffold system prompt", systemPrompt: config.baseSystemPrompt, userPromptTemplate: `${SPEAKING_OUTLINE_TEMPLATE}\n任務：{{task.title}}\n已確認概念圖：\n{{student.finalConceptMapJson}}`, variables: ["task.title", "student.finalConceptMapJson"] });
}

const stageCalls: Record<
  StageId,
  (config: TaskPromptConfig) => PromptAuditCall[]
> = {
  pretest: (config) => [
    transcriptionCall(config),
    speechEvaluationCall(config),
  ],
  visualization: (config) => [
    imageAnalysisCall(config, {
      id: "image_analysis_precompute",
      title: "上傳後預先辨識手繪圖",
      purpose:
        "圖片上傳完成後立即在後台辨識更多詞彙與座標；結果到圖像分析階段才向學生顯示。",
    }),
  ],
  self_concept_map: () => [],
  image_analysis: (config) => [
    imageAnalysisCall(config, {
      id: "image_analysis_retry",
      title: "手繪圖辨識重試",
      purpose:
        "上傳時的預先分析未完成或需要重跑時，辨識圖中元素並形成可審核的英文標記版本。",
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
    outlineCall(config),
  ],
  sentence_scaffold: (config) => [
    outlineCall(config),
    promptCall({
      id: "sentence_scaffold",
      title: "漸進式句型鷹架",
      purpose: "為學生的每一個句子各產生三級鷹架：引導問題與關鍵詞、句型框架、示範改寫，並提供串連用的連接詞。",
      systemLabel: "AI scaffold system prompt",
      systemPrompt: config.baseSystemPrompt,
      userPromptTemplate: effectiveSentenceScaffoldTemplate(
        config.sentenceScaffoldTemplate,
      ),
      variables: [
        "task.title",
        "student.finalConceptMapJson",
        "student.sentencesJson",
        "student.speakingOutlineJson（有講述架構時）",
      ],
      providerNote: `有 Macro／Micro 架構時，同一個請求會額外附加 student.speakingOutlineJson 與下列契約：${PARAGRAPH_HINTS_CONTRACT}`,
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
  speakingTemplate?: SpeakingTemplate,
) {
  return {
    baseSystemPrompt: config.baseSystemPrompt,
    baseSystemHash: hashForLog(config.baseSystemPrompt),
    contextPolicy: {
      included: [
        "任務名稱 task.title",
        "任務指定的講述模板與版本（如有）",
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
      calls: stageCalls[stage.id](config).map((call) => {
        if (!speakingTemplate) return call;
        let userPromptTemplate = call.userPromptTemplate;
        if (call.id === "speaking_outline") userPromptTemplate = userPromptTemplate.replace(SPEAKING_OUTLINE_TEMPLATE, speakingOutlineTemplate(speakingTemplate));
        if (call.id.startsWith("image_analysis") || call.id === "concept_expansion") userPromptTemplate += templateAnalysisContract(speakingTemplate);
        return {
          ...call,
          userPromptTemplate,
          templateHash: hashForLog(userPromptTemplate),
          providerNote: call.id === "sentence_scaffold"
            ? `有 Macro／Micro 架構時，同一個請求會額外附加 student.speakingOutlineJson 與下列契約：${paragraphHintsContract(speakingTemplate)}`
            : call.providerNote,
        };
      }),
    })),
  };
}
