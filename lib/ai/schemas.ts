import { z } from "zod";

export const vocabularySuggestionSchema = z.object({
  id: z.string(),
  labelEn: z.string().min(1),
  labelZh: z.string().min(1),
  category: z.enum(["person", "object", "event", "place", "feeling", "quality"]),
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(1),
  example: z.string().min(1),
});

export const imageAnalysisSchema = z.object({
  sceneSummaryZh: z.string(),
  suggestions: z.array(vocabularySuggestionSchema).min(1).max(20),
  uncertaintyNote: z.string(),
});

export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;

export const conceptNodeSchema = z.object({
  id: z.string(),
  labelEn: z.string().min(1),
  labelZh: z.string().min(1),
  category: z.enum(["person", "object", "event", "place", "feeling", "quality"]),
  source: z.enum(["student", "ai"]),
});

export const conceptEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  relationEn: z.string().min(1),
  relationZh: z.string().min(1),
  source: z.enum(["student", "ai"]),
});

export const conceptMapSchema = z.object({
  nodes: z.array(conceptNodeSchema),
  edges: z.array(conceptEdgeSchema),
});

export type ConceptMap = z.infer<typeof conceptMapSchema>;

export const sentenceScaffoldSchema = z.object({
  keywords: z.array(
    z.object({
      word: z.string(),
      translation: z.string(),
      reason: z.string(),
    }),
  ),
  starters: z.array(z.string()).min(3).max(8),
  examples: z.array(
    z.object({
      sentence: z.string(),
      translation: z.string(),
      conceptsUsed: z.array(z.string()),
    }),
  ),
  transitions: z.array(z.string()),
});

export type SentenceScaffold = z.infer<typeof sentenceScaffoldSchema>;

export const transcriptSchema = z.object({
  language: z.string(),
  text: z.string(),
  segments: z.array(
    z.object({
      startSeconds: z.number().nonnegative(),
      endSeconds: z.number().nonnegative(),
      text: z.string(),
    }),
  ),
});

export type Transcript = z.infer<typeof transcriptSchema>;

export const speechEvaluationSchema = z.object({
  contentUnits: z.number().int().nonnegative(),
  wordsPerMinute: z.number().nonnegative(),
  pauseCount: z.number().int().nonnegative(),
  vocabularyHighlights: z.array(z.string()),
  organizationFeedbackZh: z.string(),
  nextStepZh: z.string(),
});

export type SpeechEvaluation = z.infer<typeof speechEvaluationSchema>;
