/**
 * Repairs the small, predictable slips models make in image-analysis output
 * before it is validated, so one out-of-range number does not throw away an
 * otherwise good analysis:
 *
 * - confidence given as a percentage (85) or outside 0..1
 * - region values outside 0..1000, a zero width or height, or a box that
 *   runs past the edge
 * - a missing id, example or evidence text
 * - suggestions with no English or Chinese label (dropped), and more than 20
 *
 * Anything else that is wrong still fails validation.
 */

const CATEGORIES = new Set(["person", "object", "event", "place", "feeling", "quality"]);
const MAX_SUGGESTIONS = 20;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function confidence(value: unknown): number {
  const parsed = number(value);
  if (parsed === null) return 0.5;
  return clamp(parsed > 1 ? parsed / 100 : parsed, 0, 1);
}

function region(value: unknown) {
  const source = record(value) ?? {};
  const x = clamp(number(source.x) ?? 0, 0, 999);
  const y = clamp(number(source.y) ?? 0, 0, 999);
  const width = clamp(number(source.width) ?? 1, 1, 1000 - x);
  const height = clamp(number(source.height) ?? 1, 1, 1000 - y);
  return { x, y, width, height };
}

export function normalizeImageAnalysisOutput(raw: unknown): unknown {
  const source = record(raw);
  if (!source || !Array.isArray(source.suggestions)) return raw;

  const seen = new Set<string>();
  const suggestions = source.suggestions
    .map(record)
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && text(item.labelEn) && text(item.labelZh)),
    )
    .slice(0, MAX_SUGGESTIONS)
    .map((item, index) => {
      let id = text(item.id) || `s${index + 1}`;
      if (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);
      const labelEn = text(item.labelEn);
      return {
        id,
        labelEn,
        labelZh: text(item.labelZh),
        category: CATEGORIES.has(text(item.category)) ? text(item.category) : "object",
        confidence: confidence(item.confidence),
        evidence: text(item.evidence) || "圖中可見。",
        example: text(item.example) || `I can see ${labelEn}.`,
        region: region(item.region),
      };
    });

  return {
    sceneSummaryZh: text(source.sceneSummaryZh),
    suggestions,
    uncertaintyNote: text(source.uncertaintyNote),
  };
}

/**
 * Ties each stage 6 hint ladder to the student's real sentence: the index
 * decides which sentence it belongs to, the sentence text comes from the
 * student (never the model), and out-of-range or duplicate entries are
 * dropped.
 */
export function normalizeSentenceScaffoldOutput(studentSentences: readonly string[]) {
  return (raw: unknown): unknown => {
    const source = record(raw);
    if (!source || !Array.isArray(source.sentences)) return raw;
    const seen = new Set<number>();
    const sentences = source.sentences
      .map(record)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item, position) => {
        const parsed = number(item.index);
        return { item, index: parsed === null ? position : Math.round(parsed) };
      })
      .filter(({ index }) => index >= 0 && index < studentSentences.length && !seen.has(index) && Boolean(seen.add(index)))
      .sort((left, right) => left.index - right.index)
      .map(({ item, index }) => {
        const example = record(item.example) ?? {};
        return {
          index,
          original: studentSentences[index],
          question: text(item.question),
          keywords: (Array.isArray(item.keywords) ? item.keywords : [])
            .map(record)
            .filter((entry): entry is Record<string, unknown> => Boolean(entry && text(entry.word)))
            .slice(0, 5)
            .map((entry) => ({ word: text(entry.word), translation: text(entry.translation) })),
          frame: text(item.frame),
          example: { sentence: text(example.sentence), translation: text(example.translation) },
        };
      });
    const transitions = (Array.isArray(source.transitions) ? source.transitions : [])
      .map(text)
      .filter(Boolean)
      .slice(0, 8);
    return { sentences, transitions };
  };
}
