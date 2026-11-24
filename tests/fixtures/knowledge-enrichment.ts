import type { ConceptMap } from "@/lib/ai/schemas";

export const jiaoxiEnrichmentMap: ConceptMap = {
  nodes: [
    { id: "trip", labelEn: "my trip", labelZh: "我的旅行", category: "event", source: "student", enrichment: null },
    { id: "jiaoxi", labelEn: "Jiaoxi", labelZh: "礁溪", category: "place", source: "student", enrichment: null },
    { id: "hot-spring", labelEn: "hot spring bath", labelZh: "泡溫泉", category: "event", source: "ai", enrichment: {
      kind: "background_knowledge", reasonZh: "溫泉體驗與礁溪旅遊主題相關，但學生的圖還沒有提到。", questionZh: "你這次有泡溫泉嗎？",
    } },
  ],
  edges: [
    { id: "destination", from: "trip", to: "jiaoxi", relationEn: "was in", relationZh: "地點是", source: "student", enrichment: null },
    { id: "possible-bath", from: "jiaoxi", to: "hot-spring", relationEn: "may include", relationZh: "可能包含", source: "ai", enrichment: {
      kind: "background_knowledge", reasonZh: "將可能的溫泉體驗連回學生提到的旅遊地點。", questionZh: "泡溫泉符合這次在礁溪的活動嗎？",
    } },
  ],
};
