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
  if (template.id === "problem_solution") return `${common}
依內容選擇 organization：有解決策略或行動的問題探討用 problem_solution；只分析原因與影響、未提供解法時用 causal。
problem_solution 建議：問題現況與背景 → 核心成因分析（有依據時）→ 解決策略與行動 → 預期成效或已觀察結果（有資料時）。
causal 建議：現象與背景 → 有依據的原因 → 影響與結果；不要硬加學生未提供的解決策略。
因果必須有已確認的關係詞或明確資料支持。時間先後、同時出現、節點陣列順序、圖上位置或只有箭頭方向都不是因果證據，不能把相關性寫成因果。
保留「可能原因」與「已確認原因」、建議行動與已執行行動的差別。預期成效不能寫成已觀察結果，段落名稱也要清楚區分；不得捏造成因、解法、成功成效、檢驗數字或學生經歷。
問題解決內容缺少成因、解法或成效的依據時放入 informationGaps，略過沒有資料的段落，不強迫湊滿四段，保留學生已確認的內容。
organization 為 causal 時，未提供解法或行動不算資料缺漏，不得將缺少解法列入 informationGaps，也不要要求學生補出解法；只列出與原因、影響有關的必要缺漏。
`.trim();
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
  if (template.id === "problem_solution")
    return `${heading}優先辨識可見的問題現況、相關條件、人物、物件、行動與結果。不能只憑圖片推斷成因，時間先後、共現或箭頭方向都不等於因果。以學生明確提供的因果關係為依據；可能原因與建議處理須保守標示、交由學生審核，不能當成已確認事實或已執行行動。區分預期成效與已觀察結果，不捏造成因、解法、成效或數字。`;
  return template.id === "chronological"
    ? `${heading}優先辨識材料、工具、動作、事件、條件、結果及明確的先後線索。可呈現多個畫面或歷史事件；不能由圖片左右位置推斷時間，也不能捏造未畫出的步驟、原因、故障、日期或實驗結果。不確定的內容要保守標示，新增關係仍須讓學生審核。`
    : `${heading}依可見場景與學生確認內容辨識場所、人物、物件與空間關係；不要推測未提供的遊覽路線。`;
}

export function paragraphHintsContract(template?: SpeakingTemplate) {
  if (template?.id === "problem_solution") return `${PARAGRAPH_HINTS_CONTRACT}
此任務採因果／問題解決順序。依學生確認的段落與證據選擇銜接：問題可用 One problem is …；已確認因果才用 Because … 或 As a result, …；學生已提出的可能原因用 One possible cause is …；解法用 To solve this problem, …。
依學生資料區分建議行動與已執行行動。預期成效用 This could help …，已有觀察證據的結果才用 The result was …；不能把預期寫成已發生成效。
organization 為 causal 時不強加解法。以上證據與語氣規則也適用於逐句提示、示範改寫、翻譯與 transitions，保留學生原句中的不確定語氣。句首必須留白，不得補出學生未提供的原因、處理方式、結果或數字；缺少因果依據時不要用因果銜接詞把關係說成事實。`;
  return `${PARAGRAPH_HINTS_CONTRACT}${
    template?.id === "chronological"
      ? "\n此任務採時間／流程順序。依學生確認的段落與實際內容選擇 First、Next、Then、Finally 或適合事件敘述的時間銜接；句首仍須留白，不得補出學生未提供的步驟、日期、故障處理或檢驗結果。"
      : ""
  }`;
}
