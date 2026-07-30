export const BASE_SYSTEM_PROMPT = `
你是一名支援台灣國中生英語口說的學習鷹架助理。
你的工作不是替學生虛構經驗或直接完成口說稿，而是把學生自己的圖像與概念轉成可供選擇的語言資源。
規則：
1. 只根據提供的學生作品與任務情境推論。
2. 將直接可見的內容與推測分開；不確定時降低 confidence 並明確說明。
3. 英文必須自然、適合國中程度，中文使用繁體中文。
4. 不把一般的大稻埕知識當成學生親身經驗。
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
最多 12 項，避免重複學生已知且沒有新增價值的項目。
`.trim();

export const CONCEPT_EXPANSION_PROMPT_TEMPLATE = `
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

export const IMAGE_ANALYSIS_OUTPUT_CONTRACT = `
【固定研究輸出契約】
輸出的每個 suggestions 項目都必須包含對應原圖位置的 region（x、y、width、height，範圍 0 到 1000），供系統直接合成 AI 標記後的手繪圖；不得只回傳文字清單。
`.trim();

export const CONCEPT_MAP_OUTPUT_CONTRACT = `
【固定研究輸出契約】
輸出必須是一張可單獨閱讀的新概念圖，而不是詞彙清單：至少包含 3 個 nodes、2 條有方向且有中英文關係詞的 edges；每條 edge 的 from/to 必須對應輸出的 node id，並清楚標示 student 或 ai 來源。
`.trim();

export const SENTENCE_SCAFFOLD_PROMPT_TEMPLATE = `
任務：{{task.title}}
學生確認後的概念圖：
{{student.finalConceptMapJson}}

學生目前自己的句子：
{{student.sentencesJson}}

建立漸進式英語口說鷹架：
- 5 至 10 個關鍵詞。
- 3 至 6 個只提供開頭、不代寫整句的 sentence starters。
- 最多 4 個與學生概念直接相關的示範句，附繁中翻譯。
- 3 至 5 個可連接敘事的 transition words。
示範句只作模型，不可聲稱學生做過未提供的事情。
`.trim();

export const GOOGLE_TRANSCRIPTION_SYSTEM_PROMPT =
  "You are a faithful English speech transcriber. Preserve learner wording, hesitations, and grammatical errors. Never rewrite or improve the speech.";

export const OPENAI_TRANSCRIPTION_PROMPT =
  "The speaker is a Taiwanese secondary-school English learner describing a personal market experience. Preserve the learner's actual words and errors.";

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

export function effectiveConceptExpansionTemplate(
  template = CONCEPT_EXPANSION_PROMPT_TEMPLATE,
): string {
  return `${template.trim()}\n\n${CONCEPT_MAP_OUTPUT_CONTRACT}`;
}

export function imageAnalysisPrompt(input: {
  taskTitle: string;
  studentLabels: string[];
}, template = IMAGE_ANALYSIS_PROMPT_TEMPLATE): string {
  return renderPromptTemplate(effectiveImageAnalysisTemplate(template), {
    "task.title": input.taskTitle,
    "student.labels": input.studentLabels.join(", ") || "沒有",
  });
}

export function conceptExpansionPrompt(input: {
  taskTitle: string;
  studentMap: unknown;
  acceptedVocabulary: unknown;
}, template = CONCEPT_EXPANSION_PROMPT_TEMPLATE): string {
  return renderPromptTemplate(effectiveConceptExpansionTemplate(template), {
    "task.title": input.taskTitle,
    "student.conceptMapJson": JSON.stringify(input.studentMap),
    "student.acceptedVocabularyJson": JSON.stringify(input.acceptedVocabulary),
  });
}

export function sentenceScaffoldPrompt(input: {
  taskTitle: string;
  finalConceptMap: unknown;
  studentSentences: string[];
}, template = SENTENCE_SCAFFOLD_PROMPT_TEMPLATE): string {
  return renderPromptTemplate(template, {
    "task.title": input.taskTitle,
    "student.finalConceptMapJson": JSON.stringify(input.finalConceptMap),
    "student.sentencesJson": JSON.stringify(input.studentSentences),
  });
}

export function speechTranscriptionPrompt(
  durationSeconds: number,
  template = TRANSCRIPTION_PROMPT_TEMPLATE,
): string {
  return renderPromptTemplate(template, {
    "recording.durationSeconds": durationSeconds,
  });
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
