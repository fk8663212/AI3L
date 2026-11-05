export type SpeechMeasures = {
  durationSeconds: number | null;
  wordCount: number | null;
  wordsPerMinute: number | null;
  contentUnits: number | null;
  pauseCount: number | null;
};

export type PrePostRow = {
  sessionId: string;
  studentLabel: string | null;
  completed: boolean;
  currentStage: string;
  pre: SpeechMeasures;
  post: SpeechMeasures;
};

export const MEASURES = [
  "durationSeconds",
  "wordCount",
  "wordsPerMinute",
  "contentUnits",
  "pauseCount",
] as const satisfies ReadonlyArray<keyof SpeechMeasures>;

export type Measure = (typeof MEASURES)[number];

export const MEASURE_LABELS: Record<Measure, string> = {
  durationSeconds: "錄音長度（秒）",
  wordCount: "字數",
  wordsPerMinute: "語速（WPM）",
  contentUnits: "內容單位",
  pauseCount: "停頓次數",
};

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Pulls the descriptive measures out of one recording's stored artifacts. */
export function measuresFrom(input: {
  audio?: Record<string, unknown>;
  transcript?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
}): SpeechMeasures {
  const text =
    typeof input.transcript?.text === "string" ? input.transcript.text : null;
  return {
    durationSeconds: numberOrNull(input.audio?.durationSeconds),
    wordCount: text === null ? null : countWords(text),
    wordsPerMinute: numberOrNull(input.evaluation?.wordsPerMinute),
    contentUnits: numberOrNull(input.evaluation?.contentUnits),
    pauseCount: numberOrNull(input.evaluation?.pauseCount),
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function mean(values: number[]): number | null {
  return values.length
    ? round2(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

export type MeasureSummary = {
  pairs: number;
  preMean: number | null;
  postMean: number | null;
  meanChange: number | null;
};

/**
 * Descriptive summary over students who have both a pre- and a posttest value
 * for a measure (paired), so the two means compare the same students.
 */
export function summarizePrePost(rows: PrePostRow[]): Record<Measure, MeasureSummary> {
  return Object.fromEntries(
    MEASURES.map((measure) => {
      const pairs = rows.flatMap((row) => {
        const pre = row.pre[measure];
        const post = row.post[measure];
        return pre === null || post === null ? [] : [{ pre, post }];
      });
      return [
        measure,
        {
          pairs: pairs.length,
          preMean: mean(pairs.map((pair) => pair.pre)),
          postMean: mean(pairs.map((pair) => pair.post)),
          meanChange: mean(pairs.map((pair) => pair.post - pair.pre)),
        },
      ];
    }),
  ) as Record<Measure, MeasureSummary>;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Neutralise spreadsheet formulas (a cell starting with = + - @), then quote.
  const safe = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return /[",\n\r]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function prePostCsv(rows: PrePostRow[]): string {
  const header = [
    "student_label",
    "session_id",
    "completed",
    "current_stage",
    ...MEASURES.flatMap((measure) => [
      `pre_${measure}`,
      `post_${measure}`,
      `change_${measure}`,
    ]),
  ];
  const lines = rows.map((row) =>
    [
      row.studentLabel,
      row.sessionId,
      row.completed,
      row.currentStage,
      ...MEASURES.flatMap((measure) => {
        const pre = row.pre[measure];
        const post = row.post[measure];
        return [pre, post, pre === null || post === null ? null : round2(post - pre)];
      }),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}
