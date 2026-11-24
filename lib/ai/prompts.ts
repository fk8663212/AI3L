import { paragraphHintsContract, templateAnalysisContract } from "@/lib/ai/speaking-outline-prompt";
import type { SpeakingTemplate } from "@/lib/domain/speaking-templates";
import { conceptMapSchema } from "@/lib/ai/schemas";
import { conceptMapWithoutEnrichmentNotes } from "@/lib/domain/concept-enrichment";
export const BASE_SYSTEM_PROMPT = `
你是一名支援台灣國中生英語口說的學習鷹架助理。
你的工作不是替學生虛構經驗或直接完成口說稿，而是把學生自己的圖像與概念轉成可供選擇的語言資源。
規則：
1. 先根據提供的學生作品與任務情境理解內容；圖像辨識只標記可見元素。概念擴充階段可依活動主題與簡介，運用一般背景知識提出待學生確認的補述建議。
2. 將直接可見的內容與推測分開；不確定時降低 confidence 並明確說明。
3. 英文必須自然、適合國中程度，中文使用繁體中文。
4. 背景知識只作喚起回憶與補充內容的候選，不當成學生親身經驗；是否保留由學生決定。
5. 回傳必須符合指定 JSON schema，不要包含 markdown。
`.trim();

export const IMAGE_ANALYSIS_PROMPT_TEMPLATE = `
任務：{{task.title}}
學生在 AI 介入前自行標記的詞彙：
{{student.labels}}

請分析附上的手繪圖，找出可支持口說敘事的人物、物件、事件、地點、感受與特質。
每一項建議都要給英文、繁中、分類、0 到 1 的信心、圖像證據與一個簡短自然例句。
另以原圖左上角為原點，為每一項提供 0 到 1000 的正規化 region（x、y、width、height），緊密框住可辨識元素；不要標記看不見或只能猜測的物件。
每個 id 必須唯一且穩定，讓學生能逐項審核標記。
圖像證據足夠時提供 10 至 16 項，盡量涵蓋不同分類；圖像內容較少時可少於 10 項，不得為湊數猜測。
避免重複學生已知且沒有新增價值的項目。
`.trim();

export const LEGACY_TYPED_CONCEPT_EXPANSION_PROMPT_TEMPLATE = `
任務：{{task.title}}
學生原始概念圖：
{{student.conceptMapJson}}

學生已接受或修改後的 AI 詞彙：
{{student.acceptedVocabularyJson}}

請將學生原始概念與已確認詞彙分類，生成一張完整、連貫的新概念圖。
保留有助於敘事的學生原始節點與關係，再加入可由手繪圖、已確認詞彙或緊密情境關聯支持的英文節點與關係。
新概念圖必須能單獨閱讀：每個節點都應參與至少一條關係，所有 edge 的 from/to 都必須對應到輸出的 node id。
AI 新增項目的 source 必須是 "ai"，學生原始項目的 source 必須是 "student"。
可加入有助於描述大稻埕情境的近距離詞彙聯想，但不可把未提供的事件寫成學生親身經驗。
`.trim();

export const CONCEPT_EXPANSION_PROMPT_TEMPLATE = `
任務：{{task.title}}
學生原始概念圖已隨本請求作為手繪圖片附件提供。
附件資訊：
{{student.conceptMapJson}}

學生已接受或修改後的 AI 詞彙：
{{student.acceptedVocabularyJson}}

請先讀取手繪概念圖中的節點、方向連線與關係詞，再與已確認詞彙整合，生成一張完整、連貫的新概念圖。
保留可辨識且有助於敘事的學生原始節點與關係，再加入可由手繪情境、已確認詞彙或緊密情境關聯支持的英文節點與關係。
新概念圖必須能單獨閱讀：每個節點都應參與至少一條關係，所有 edge 的 from/to 都必須對應到輸出的 node id。
AI 新增項目的 source 必須是 "ai"，從學生手繪圖讀取的原始項目 source 必須是 "student"。
難以辨識的字詞或連線不得自行補成學生內容；可依本次活動主題與簡介加入待學生確認的背景知識補述，但不可把它寫成已發生的親身經驗。
`.trim();

export const IMAGE_ANALYSIS_OUTPUT_CONTRACT = `
【固定研究輸出契約】
輸出的每個 suggestions 項目都必須包含對應原圖位置的 region（x、y、width、height，範圍 0 到 1000），供系統直接合成 AI 標記後的手繪圖；不得只回傳文字清單。
圖像證據足夠時應提供 10 至 16 個不重複、適合國中生口說的詞彙；內容不足時應保守減少，不得虛構元素。
`.trim();

export const CONCEPT_MAP_OUTPUT_CONTRACT = `
【固定研究輸出契約】
學生原始概念來源是隨請求附上的手繪概念圖圖片；必須先讀取圖片中的節點、方向連線與關係詞，無法辨識時應保守處理，不得假設學生輸入了未出現的概念。
輸出必須是一張可單獨閱讀的新概念圖，而不是詞彙清單：至少包含 3 個 nodes、2 條有方向且有中英文關係詞的 edges；每條 edge 的 from/to 必須對應輸出的 node id，並清楚標示 student 或 ai 來源。

【活動背景與知識補述】
活動主題：{{task.title}}
老師提供的活動簡介：{{task.description}}
本次活動以這裡的主題與簡介為準，不沿用模板範例的地名或故事。
先整合學生手繪概念圖與已確認的情境詞彙，再主動運用與活動主題／簡介相關的一般知識，提出少量（通常 1 至 4 個）能喚起回憶、補足表達的候選概念，並連回已有內容。資料不足以判斷相關性時可不補述，不為湊數新增。
候選應是學生可能省略、且與本次活動有具體關聯的體驗、物件或細節，並以問題請學生確認；不要把任何固定景點、活動或案例套用到所有任務。
每個 node 與 edge 都要回傳 enrichment：學生原有內容與可由作品／已確認詞彙支持的項目用 null；超出這些輸入的背景補述用 {"kind":"background_knowledge","reasonZh":"為什麼與本次活動相關","questionZh":"請學生確認是否符合經驗或想表達內容的問題"}，source 一律為 ai。連到補述概念的新關係也必須有 enrichment；不要在輸出中自行加上「學生已確認」標記。
補述是待確認的候選，不是對學生經歷的斷言；用適合國中生的概念詞／短語與保守關係詞，不寫完整第一人稱敘事，不捏造特定店家、日期、價格、個人感受、實驗數值或已發生成效。
因果內容的補述只可提出可能原因或處理建議，保留 may／could 等語氣，不當成已證明原因或已執行行動；流程內容可建議常見步驟，但不假定學生真的做過或確定其先後。
`.trim();

export const SENTENCE_SCAFFOLD_PROMPT_TEMPLATE = `
任務：{{task.title}}
學生確認後的概念圖：
{{student.finalConceptMapJson}}

學生自己寫的句子（index 從 0 開始）：
{{student.sentencesJson}}

請針對「每一個」學生句子，建立從少到多、建立在該句之上的三級口說鷹架，幫助學生把自己的句子說得更完整、更具體。
`.trim();

/**
 * Always appended to the stage 6 template: the per-sentence shape the UI
 * renders, and the rule that every hint builds on the student's own sentence.
 */
export const SENTENCE_SCAFFOLD_OUTPUT_CONTRACT = `
【固定研究輸出契約】
sentences 陣列必須對每一個學生句子各輸出一項，index 對應學生句子的 index，順序相同：
- question（第 1 級）：一個繁體中文引導問題，引導學生為「這一句」補充細節（在哪裡、看到什麼樣子、跟誰、感覺如何、為什麼）；不可直接給出英文答案。
- keywords（第 1 級）：2 至 4 個可加進「這一句」的英文詞或片語，附繁中翻譯，優先取自學生保留的概念圖。
- frame（第 2 級）：以學生「這一句」為基礎的英文句型框架，保留學生原本的意思，用 ___ 標出可以補充的位置，例如學生寫 "I saw horse drawings" 時給 "I saw ___ horse drawings on ___ in Dadaocheng."。
- example（第 3 級）：把學生「這一句」擴充改寫成一個完整、文法正確、國中生說得出口的英文句子，附繁中翻譯；必須保留學生原意與原本的主要詞彙。
transitions：3 至 5 個可把這些句子串成一段話的英文連接詞（例如 First、Then、Also）。
只能使用學生句子與學生保留的概念圖中的內容；不可加入學生沒有提到、概念圖中也沒有的經驗，不可直接糾正文法（第 3 級的示範句自然寫正確即可）。
`.trim();

export const GOOGLE_TRANSCRIPTION_SYSTEM_PROMPT =
  "You are a faithful English speech transcriber. Preserve learner wording, hesitations, and grammatical errors. Never rewrite or improve the speech.";

// Speech-to-text prompts are context, not instructions: naming a topic here
// makes the model "hear" that topic in silence or noise, so name none.
export const OPENAI_TRANSCRIPTION_PROMPT =
  "Taiwanese secondary-school English learner. Preserve the learner's actual words and errors.";

/**
 * Always appended to the transcription prompt, whatever the task's template
 * says: a silent or unintelligible recording must come back empty.
 */
export const TRANSCRIPTION_OUTPUT_CONTRACT =
  "Transcribe only words that are actually audible in the recording. If there is no intelligible speech (silence, background noise, breathing, or only non-English sounds), return an empty text and no segments. Never guess, complete, or invent speech from the task topic or from context.";

export const TRANSCRIPTION_PROMPT_TEMPLATE =
  "Transcribe the attached learner recording in English. Its measured duration is {{recording.durationSeconds}} seconds. Return timestamps bounded by that duration.";

export const SPEECH_EVALUATION_SYSTEM_PROMPT =
  "You analyze learner speech conservatively for education research. Return only schema-valid JSON and never invent acoustic measurements.";

export const SPEECH_EVALUATION_PROMPT_TEMPLATE = `
這是台灣國中生在「{{stage.id}}」階段的英語口說逐字稿：
{{recording.transcriptJson}}

錄音長度：{{recording.durationSeconds}} 秒
依空白切分的基礎語速估計：{{recording.wordsPerMinute}} WPM

請做研究用途的描述性分析：
- contentUnits：逐字稿中有明確意義、與經驗相關且不重複的內容單位數。
- wordsPerMinute：直接使用提供的基礎估計值。
- pauseCount：只根據逐字稿中明確的停頓或猶豫標記保守估計，不可虛構聲學資訊。
- vocabularyHighlights：列出最多 8 個學生實際說出的具內容意義英文詞或片語。
- organizationFeedbackZh：用繁中描述敘事組織現況，不給分數。
- nextStepZh：提供一項簡短可行的下次練習建議。
不要修寫逐字稿，也不要聲稱做過聲學量測。
`.trim();

export type TaskPromptConfig = {
  baseSystemPrompt: string;
  imageAnalysisTemplate: string;
  conceptExpansionTemplate: string;
  sentenceScaffoldTemplate: string;
  googleTranscriptionSystemPrompt: string;
  openaiTranscriptionPrompt: string;
  transcriptionTemplate: string;
  speechEvaluationSystemPrompt: string;
  speechEvaluationTemplate: string;
};

export const DEFAULT_TASK_PROMPT_CONFIG: TaskPromptConfig = {
  baseSystemPrompt: BASE_SYSTEM_PROMPT,
  imageAnalysisTemplate: IMAGE_ANALYSIS_PROMPT_TEMPLATE,
  conceptExpansionTemplate: CONCEPT_EXPANSION_PROMPT_TEMPLATE,
  sentenceScaffoldTemplate: SENTENCE_SCAFFOLD_PROMPT_TEMPLATE,
  googleTranscriptionSystemPrompt: GOOGLE_TRANSCRIPTION_SYSTEM_PROMPT,
  openaiTranscriptionPrompt: OPENAI_TRANSCRIPTION_PROMPT,
  transcriptionTemplate: TRANSCRIPTION_PROMPT_TEMPLATE,
  speechEvaluationSystemPrompt: SPEECH_EVALUATION_SYSTEM_PROMPT,
  speechEvaluationTemplate: SPEECH_EVALUATION_PROMPT_TEMPLATE,
};

function renderPromptTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
}

export function effectiveImageAnalysisTemplate(
  template = IMAGE_ANALYSIS_PROMPT_TEMPLATE,
): string {
  return `${template.trim()}\n\n${IMAGE_ANALYSIS_OUTPUT_CONTRACT}`;
}

/** Generalize only unchanged legacy defaults, keeping teacher edits intact. */
export function promptConfigForSpeakingTemplate(config: TaskPromptConfig, template?: SpeakingTemplate): TaskPromptConfig {
  if (!template) return config;
  return Object.fromEntries(Object.entries(config).map(([key, text]) => [key,
    text === DEFAULT_TASK_PROMPT_CONFIG[key as keyof TaskPromptConfig]
      ? text.replaceAll("一般的大稻埕知識", "一般背景知識").replaceAll("大稻埕情境", "本次任務情境")
      : text,
  ])) as TaskPromptConfig;
}

export function effectiveConceptExpansionTemplate(
  template = CONCEPT_EXPANSION_PROMPT_TEMPLATE,
): string {
  const requiredInputs = [
    !template.includes("{{student.conceptMapJson}}") ? "學生手繪概念圖附件資訊：\n{{student.conceptMapJson}}" : "",
    !template.includes("{{student.acceptedVocabularyJson}}") ? "學生已確認的情境詞彙：\n{{student.acceptedVocabularyJson}}" : "",
  ].filter(Boolean).join("\n\n");
  return `${template.trim()}${requiredInputs ? `\n\n${requiredInputs}` : ""}\n\n${CONCEPT_MAP_OUTPUT_CONTRACT}`;
}

export function imageAnalysisPrompt(input: {
  speakingTemplate?: SpeakingTemplate;
  taskTitle: string;
  studentLabels: string[];
}, template = IMAGE_ANALYSIS_PROMPT_TEMPLATE): string {
  return renderPromptTemplate(effectiveImageAnalysisTemplate(template), {
    "task.title": input.taskTitle,
    "student.labels": input.studentLabels.join(", ") || "沒有",
  }) + templateAnalysisContract(input.speakingTemplate);
}

export function conceptExpansionPrompt(input: {
  speakingTemplate?: SpeakingTemplate;
  taskTitle: string;
  taskDescription?: string;
  studentMap: unknown;
  acceptedVocabulary: unknown;
}, template = CONCEPT_EXPANSION_PROMPT_TEMPLATE): string {
  return renderPromptTemplate(effectiveConceptExpansionTemplate(template), {
    "task.title": input.taskTitle,
    "task.description": input.taskDescription?.trim() || "未提供活動簡介，請保守依主題與學生內容提出候選。",
    "student.conceptMapJson": JSON.stringify(input.studentMap),
    "student.acceptedVocabularyJson": JSON.stringify(input.acceptedVocabulary),
  }) + templateAnalysisContract(input.speakingTemplate, true);
}

export function sentenceScaffoldPrompt(input: {
  speakingTemplate?: SpeakingTemplate;
  taskTitle: string;
  finalConceptMap: unknown;
  studentSentences: string[];
  speakingOutline?: unknown;
}, template = SENTENCE_SCAFFOLD_PROMPT_TEMPLATE): string {
  const parsedMap = conceptMapSchema.safeParse(input.finalConceptMap);
  const base = renderPromptTemplate(effectiveSentenceScaffoldTemplate(template), {
    "task.title": input.taskTitle,
    "student.finalConceptMapJson": JSON.stringify(parsedMap.success ? conceptMapWithoutEnrichmentNotes(parsedMap.data) : input.finalConceptMap),
    "student.sentencesJson": JSON.stringify(
      input.studentSentences.map((sentence, index) => ({ index, sentence })),
    ),
  });
  if (!input.speakingOutline) return base;
  return `${base}\n\n學生確認的 Macro 講述順序與 Micro 節點：\n${JSON.stringify(input.speakingOutline)}\n${paragraphHintsContract(input.speakingTemplate)}`;
}

export function effectiveSentenceScaffoldTemplate(
  template = SENTENCE_SCAFFOLD_PROMPT_TEMPLATE,
): string {
  return `${template.trim()}\n\n${SENTENCE_SCAFFOLD_OUTPUT_CONTRACT}`;
}

export function speechTranscriptionPrompt(
  durationSeconds: number,
  template = TRANSCRIPTION_PROMPT_TEMPLATE,
): string {
  return `${renderPromptTemplate(template, {
    "recording.durationSeconds": durationSeconds,
  }).trim()}\n\n${TRANSCRIPTION_OUTPUT_CONTRACT}`;
}

export function speechEvaluationPrompt(input: {
  stage: string;
  transcript: string;
  durationSeconds: number;
  wordsPerMinute: number;
}, template = SPEECH_EVALUATION_PROMPT_TEMPLATE): string {
  return renderPromptTemplate(template, {
    "stage.id": input.stage,
    "recording.transcriptJson": JSON.stringify(input.transcript),
    "recording.durationSeconds": input.durationSeconds,
    "recording.wordsPerMinute": input.wordsPerMinute,
  });
}
