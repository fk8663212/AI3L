export const SPEAKING_OUTLINE_TEMPLATE = `
依學生已確認的概念圖，安排適合口說的 Macro 講述順序，通常 3 至 5 段，最多 6 段；內容較少時可以減少。
每段包含唯一 id、簡短 titleZh、titleEn，以及該段 Micro 子圖使用的 nodeIds。
只能使用概念圖現有的節點 id；每個節點至少出現一次，也可以在開場或總結重複使用。
順序應有開場、具體內容和收束，段落名稱必須根據實際內容，不能套用固定市場或美食情節。
不要產生關鍵詞提示、句首、例句，也不能增加節點、關係、學生經驗或完整講稿。
`.trim();

export function speakingOutlineTemplate(template?: SpeakingTemplate) {
  if (!template) return SPEAKING_OUTLINE_TEMPLATE;
  const preset = SPEAKING_TEMPLATES[template.id];
  const common = `${SPEAKING_OUTLINE_TEMPLATE}\n講述模板：${preset.label}（${template.id}@${template.version}）。\n每個節點至少安排到一段，段落名稱與順序依學生內容調整。informationGaps 用繁體中文列出需要學生補充或確認的資料；沒有缺漏時輸出空陣列。不要為缺少的資料建立空段落或虛構概念。`;
  if (template.id === "spatial")
    return `${common}\n建議路徑：${preset.sequence}。只使用學生內容支持的場所與特色，不推測未提供的遊覽路線。`;
  return `${common}
依內容選擇 organization：實作、實驗或料理用 procedural；歷史或事件敘述用 chronological。
procedural 建議：準備工作 → 核心操作／步驟（可分成多段）→ 突發狀況與排除（學生有提供時）→ 最終產出與檢驗（有依據時）。
chronological 建議：背景／起點 → 事件先後發展 → 結果／回顧；不要硬套材料、組裝或故障排除。
先後必須有已確認概念、關係或明確時間線索支持，不能把節點陣列順序、圖上的左右位置當作時間證據。
缺少必要的先後或結果資料時放入 informationGaps，保留已知內容；沒有突發狀況就略過，不得捏造故障、成功結果、日期、檢驗數字或學生經歷。
`.trim();
}

export function speakingOutlinePrompt(
  title: string,
  map: unknown,
  template?: SpeakingTemplate,
) {
  return `${speakingOutlineTemplate(template)}\n任務：${title}\n已確認概念圖：\n${JSON.stringify(map)}`;
}

export const PARAGRAPH_HINTS_CONTRACT =
  "另在 paragraphHints 中，依段落順序為每段輸出 sectionId、1 至 5 個 keywords（word、translation）與簡短英文 sentenceStart。每個段落恰好一項；句首以 … 或 ___ 結尾，留給學生補充細節，不要給完整答案。關鍵詞與句首只能建立在該段已確認的概念及學生句子上，不要新增經驗或產生整篇講稿。";
import {
  SPEAKING_TEMPLATES,
  type SpeakingTemplate,
} from "@/lib/domain/speaking-templates";

export function templateAnalysisContract(template?: SpeakingTemplate) {
  if (!template) return "";
  const heading = `\n【講述模板：${SPEAKING_TEMPLATES[template.id].label} ${template.version}】\n`;
  return template.id === "chronological"
    ? `${heading}優先辨識材料、工具、動作、事件、條件、結果及明確的先後線索。可呈現多個畫面或歷史事件；不能由圖片左右位置推斷時間，也不能捏造未畫出的步驟、原因、故障、日期或實驗結果。不確定的內容要保守標示，新增關係仍須讓學生審核。`
    : `${heading}依可見場景與學生確認內容辨識場所、人物、物件與空間關係；不要推測未提供的遊覽路線。`;
}

export function paragraphHintsContract(template?: SpeakingTemplate) {
  return `${PARAGRAPH_HINTS_CONTRACT}${
    template?.id === "chronological"
      ? "\n此任務採時間／流程順序。依學生確認的段落與實際內容選擇 First、Next、Then、Finally 或適合事件敘述的時間銜接；句首仍須留白，不得補出學生未提供的步驟、日期、故障處理或檢驗結果。"
      : ""
  }`;
}
