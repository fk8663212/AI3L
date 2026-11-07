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

export const annotationRegionSchema = z.object({
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
  width: z.number().min(1).max(1000),
  height: z.number().min(1).max(1000),
});

export const imageAnnotationSchema = vocabularySuggestionSchema.extend({
  region: annotationRegionSchema,
});

export const imageAnalysisSchema = z.object({
  sceneSummaryZh: z.string(),
  suggestions: z.array(vocabularySuggestionSchema).min(1).max(20),
  uncertaintyNote: z.string(),
});

export const imageAnalysisGenerationSchema = z.object({
  sceneSummaryZh: z.string(),
  suggestions: z.array(imageAnnotationSchema).min(1).max(20),
  uncertaintyNote: z.string(),
});

export const annotatedImageSchema = z.object({
  sourceImageArtifactId: z.string().uuid(),
  annotations: z.array(imageAnnotationSchema).min(1).max(20),
});

export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;
export type ImageAnnotation = z.infer<typeof imageAnnotationSchema>;
export type AnnotatedImage = z.infer<typeof annotatedImageSchema>;

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

/**
 * A concept map as stored and shown. The AI output uses the plain node and
 * edge shapes; a map the student has adjusted can also carry positions
 * (percent of the drawing area) and an "edited" flag on changed items.
 */
export const mapNodeSchema = conceptNodeSchema.extend({
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  edited: z.boolean().optional(),
});

export const mapEdgeSchema = conceptEdgeSchema.extend({
  edited: z.boolean().optional(),
});

export const conceptMapSchema = z.object({
  nodes: z.array(mapNodeSchema),
  edges: z.array(mapEdgeSchema),
});

export const generatedConceptMapSchema = z.object({
  nodes: z.array(conceptNodeSchema).min(3).max(20),
  edges: z.array(conceptEdgeSchema).min(2).max(40),
});

export type ConceptMap = z.infer<typeof conceptMapSchema>;

/**
 * Stage 6 scaffold: one hint ladder per student sentence, built on that
 * sentence. Level 1 is a guiding question plus keywords, level 2 a sentence
 * frame from the student's own sentence, level 3 an example rewrite of it.
 */
export const sentenceHintSchema = z.object({
  /** 0-based position of the student's sentence. */
  index: z.number().int().min(0),
  /** The student's sentence the hints were built for (set by the server). */
  original: z.string(),
  question: z.string().min(1),
  keywords: z
    .array(z.object({ word: z.string().min(1), translation: z.string() }))
    .max(5),
  frame: z.string().min(1),
  example: z.object({ sentence: z.string().min(1), translation: z.string() }),
});

export const sentenceScaffoldSchema = z.object({
  sentences: z.array(sentenceHintSchema).min(1).max(20),
  transitions: z.array(z.string()).max(8),
  paragraphHints: z.array(z.object({
    sectionId: z.string().min(1),
    keywords: z.array(z.object({ word: z.string().min(1), translation: z.string() })).min(1).max(5),
    sentenceStart: z.string().min(1).max(300),
  })).max(6).optional(),
});

export type SentenceHint = z.infer<typeof sentenceHintSchema>;

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
