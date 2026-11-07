export const SPEAKING_OUTLINE_TEMPLATE = `
依學生已確認的概念圖，安排適合口說的 Macro 講述順序，通常 3 至 5 段，最多 6 段；內容較少時可以減少。
每段包含唯一 id、簡短 titleZh、titleEn，以及該段 Micro 子圖使用的 nodeIds。
只能使用概念圖現有的節點 id；每個節點至少出現一次，也可以在開場或總結重複使用。
順序應有開場、具體內容和收束，段落名稱必須根據實際內容，不能套用固定市場或美食情節。
不要產生關鍵詞提示、句首、例句，也不能增加節點、關係、學生經驗或完整講稿。
`.trim();

export function speakingOutlinePrompt(title: string, map: unknown) {
  return `${SPEAKING_OUTLINE_TEMPLATE}\n任務：${title}\n已確認概念圖：\n${JSON.stringify(map)}`;
}

export const PARAGRAPH_HINTS_CONTRACT =
  "另在 paragraphHints 中，依段落順序為每段輸出 sectionId、1 至 5 個 keywords（word、translation）與簡短英文 sentenceStart。每個段落恰好一項；句首以 … 或 ___ 結尾，留給學生補充細節，不要給完整答案。關鍵詞與句首只能建立在該段已確認的概念及學生句子上，不要新增經驗或產生整篇講稿。";
