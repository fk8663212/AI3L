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

export function imageAnalysisPrompt(input: {
  taskTitle: string;
  studentLabels: string[];
}): string {
  return `
任務：${input.taskTitle}
學生在 AI 介入前自行標記的詞彙：
${input.studentLabels.join(", ") || "沒有"}

請分析附上的手繪圖，找出可支持口說敘事的人物、物件、事件、地點、感受與特質。
每一項建議都要給英文、繁中、分類、0 到 1 的信心、圖像證據與一個簡短自然例句。
最多 12 項，避免重複學生已知且沒有新增價值的項目。
`.trim();
}

export function conceptExpansionPrompt(input: {
  taskTitle: string;
  studentMap: unknown;
  acceptedVocabulary: unknown;
}): string {
  return `
任務：${input.taskTitle}
學生原始概念圖：
${JSON.stringify(input.studentMap)}

學生已接受或修改後的 AI 詞彙：
${JSON.stringify(input.acceptedVocabulary)}

請保留學生原始節點與關係，並提出少量可選的 AI 節點與關係，幫助學生建立連貫敘事。
AI 新增項目的 source 必須是 "ai"，學生原始項目的 source 必須是 "student"。
不要加入無法由學生作品支持的歷史或觀光知識。
`.trim();
}

export function sentenceScaffoldPrompt(input: {
  taskTitle: string;
  finalConceptMap: unknown;
  studentSentences: string[];
}): string {
  return `
任務：${input.taskTitle}
學生確認後的概念圖：
${JSON.stringify(input.finalConceptMap)}

學生目前自己的句子：
${JSON.stringify(input.studentSentences)}

建立漸進式英語口說鷹架：
- 5 至 10 個關鍵詞。
- 3 至 6 個只提供開頭、不代寫整句的 sentence starters。
- 最多 4 個與學生概念直接相關的示範句，附繁中翻譯。
- 3 至 5 個可連接敘事的 transition words。
示範句只作模型，不可聲稱學生做過未提供的事情。
`.trim();
}

export function speechEvaluationPrompt(input: {
  stage: string;
  transcript: string;
  durationSeconds: number;
  wordsPerMinute: number;
}): string {
  return `
這是台灣國中生在「${input.stage}」階段的英語口說逐字稿：
${JSON.stringify(input.transcript)}

錄音長度：${input.durationSeconds} 秒
依空白切分的基礎語速估計：${input.wordsPerMinute} WPM

請做研究用途的描述性分析：
- contentUnits：逐字稿中有明確意義、與經驗相關且不重複的內容單位數。
- wordsPerMinute：直接使用提供的基礎估計值。
- pauseCount：只根據逐字稿中明確的停頓或猶豫標記保守估計，不可虛構聲學資訊。
- vocabularyHighlights：列出最多 8 個學生實際說出的具內容意義英文詞或片語。
- organizationFeedbackZh：用繁中描述敘事組織現況，不給分數。
- nextStepZh：提供一項簡短可行的下次練習建議。
不要修寫逐字稿，也不要聲稱做過聲學量測。
`.trim();
}
