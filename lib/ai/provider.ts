import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z, type ZodType } from "zod";
import {
  transcriptSchema,
  type Transcript,
} from "@/lib/ai/schemas";
import {
  GOOGLE_TRANSCRIPTION_SYSTEM_PROMPT,
  OPENAI_TRANSCRIPTION_PROMPT,
  speechTranscriptionPrompt,
} from "@/lib/ai/prompts";

export type AIProviderName = "openai" | "google";

export type BinaryInput = {
  bytes: Uint8Array;
  mimeType: string;
};

export const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
// Image analysis with thinking can take well over 30 s; the routes allow 180 s.
export const AI_REQUEST_TIMEOUT_MS = 90_000;
/** Includes the model's thinking tokens, so leave room for the JSON itself. */
const GOOGLE_MAX_OUTPUT_TOKENS = 16_000;

function openAIClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });
}

function googleAIClient(apiKey: string): GoogleGenAI {
  // No retryOptions: setting them routes every call through the SDK's retry
  // wrapper, which replaces any 4xx answer with "Non-retryable exception
  // <statusText> sending request" and drops the status and Google's message.
  // Without them the SDK makes one request and throws its ApiError, so the
  // schema fallback and the quota/key/model messages can see the status.
  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: AI_REQUEST_TIMEOUT_MS },
  });
}

export type StructuredGeneration<T> = {
  value: T;
  providerResponseId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

type GenerateInput<T> = {
  provider: AIProviderName;
  apiKey: string;
  modelId: string;
  schemaName: string;
  schema: ZodType<T>;
  system: string;
  prompt: string;
  binary?: BinaryInput;
  /** Repairs predictable slips in the model output before validation. */
  normalize?: (raw: unknown) => unknown;
};

const GOOGLE_JSON_SCHEMA_KEYS = new Set([
  "$id",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "required",
  "propertyOrdering",
]);

function sanitizeGoogleSchemaNode(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (key === "const") {
      sanitized.enum = [entry];
      continue;
    }
    if (key === "properties" || key === "$defs") {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        sanitized[key] = Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).map(
            ([name, child]) => [name, sanitizeGoogleSchemaNode(child)],
          ),
        );
      }
      continue;
    }
    if (key === "items") {
      sanitized[key] = sanitizeGoogleSchemaNode(entry);
      continue;
    }
    if (key === "prefixItems" || key === "anyOf" || key === "oneOf") {
      if (Array.isArray(entry)) {
        sanitized[key] = entry.map(sanitizeGoogleSchemaNode);
      }
      continue;
    }
    if (GOOGLE_JSON_SCHEMA_KEYS.has(key)) {
      sanitized[key] = entry;
    }
  }
  return sanitized;
}

export function googleResponseJsonSchema(schema: ZodType<unknown>): unknown {
  return sanitizeGoogleSchemaNode(z.toJSONSchema(schema));
}

function cleanJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return trimmed;
}

async function generateOpenAI<T>(
  input: GenerateInput<T>,
): Promise<StructuredGeneration<T>> {
  const client = openAIClient(input.apiKey);
  const content: OpenAI.Responses.ResponseInputContent[] = [
    { type: "input_text", text: input.prompt },
  ];
  if (input.binary) {
    if (!input.binary.mimeType.startsWith("image/")) {
      throw new Error("OpenAI structured generation only accepts image binary input.");
    }
    const dataUrl = `data:${input.binary.mimeType};base64,${Buffer.from(
      input.binary.bytes,
    ).toString("base64")}`;
    content.push({
      type: "input_image",
      detail: "high",
      image_url: dataUrl,
    });
  }

  const supportsReasoning =
    input.modelId.startsWith("gpt-5") || /^o\d/u.test(input.modelId);
  const response = await client.responses.parse({
    model: input.modelId,
    instructions: input.system,
    input: [{ role: "user", content }],
    ...(supportsReasoning ? { reasoning: { effort: "low" as const } } : {}),
    max_output_tokens: 8_000,
    store: false,
    text: {
      format: zodTextFormat(input.schema, input.schemaName),
    },
  });
  if (!response.output_parsed) {
    const reason =
      response.incomplete_details?.reason ??
      response.status ??
      "no parsed structured output";
    throw new Error(`OpenAI returned an incomplete response: ${reason}.`);
  }

  return {
    value: input.schema.parse(response.output_parsed),
    providerResponseId: response.id,
    usage: {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
  };
}

async function generateGoogle<T>(
  input: GenerateInput<T>,
): Promise<StructuredGeneration<T>> {
  const client = googleAIClient(input.apiKey);
  const schema = googleResponseJsonSchema(input.schema);
  const imageParts: Array<
    { inlineData: { data: string; mimeType: string } }
  > = [];

  if (input.binary) {
    imageParts.push({
      inlineData: {
        data: Buffer.from(input.binary.bytes).toString("base64"),
        mimeType: input.binary.mimeType,
      },
    });
  }

  const partsForPrompt = (
    prompt: string,
  ): Array<
    | { text: string }
    | { inlineData: { data: string; mimeType: string } }
  > => [{ text: prompt }, ...imageParts];

  // Retry unusable output once, with the same provider/model and a stricter
  // formatting instruction. Never retry key, quota, safety or transport errors.
  const deadline = Date.now() + AI_REQUEST_TIMEOUT_MS;
  let useSchema = true;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const schemaPrompt = `${input.prompt}\n\nReturn one complete JSON object matching this schema exactly. Escape quotation marks inside strings. Do not include Markdown or explanations.\n${JSON.stringify(schema)}`;

  async function request(prompt: string) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new Error("Gemini structured output timed out.");
    return client.models.generateContent({
      model: input.modelId,
      contents: [{ role: "user", parts: partsForPrompt(prompt) }],
      config: {
        httpOptions: { timeout },
        systemInstruction: input.system,
        responseMimeType: "application/json",
        ...(useSchema ? {
          responseJsonSchema: schema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        } : {}),
        maxOutputTokens: GOOGLE_MAX_OUTPUT_TOKENS,
      },
    });
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await request(attempt === 0 && useSchema ? input.prompt : schemaPrompt);
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? error.status : undefined;
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (!useSchema || status !== 400 || (!message.includes("invalid_argument") && !message.includes("invalid argument"))) throw error;
      useSchema = false;
      response = await request(schemaPrompt);
    }
    const usage = response.usageMetadata;
    if (usage?.promptTokenCount !== undefined) inputTokens = (inputTokens ?? 0) + usage.promptTokenCount;
    if (usage?.candidatesTokenCount !== undefined) outputTokens = (outputTokens ?? 0) + usage.candidatesTokenCount;
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`Gemini did not complete structured output (finish reason: ${finishReason}).`);
    }
    if (!response.text && finishReason !== "MAX_TOKENS") {
      throw new Error("Gemini returned no structured output.");
    }

    try {
      if (finishReason === "MAX_TOKENS") throw new Error("Output exceeded the token limit.");
      const raw: unknown = JSON.parse(cleanJson(response.text!));
      const value = input.schema.parse(input.normalize ? input.normalize(raw) : raw);
      return {
        value,
        providerResponseId: response.responseId,
        usage: { inputTokens, outputTokens },
      };
    } catch (error) {
      if (attempt === 0) continue;
      const detail = error instanceof z.ZodError
        ? error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : error instanceof Error ? error.message : String(error);
      throw new Error(`Gemini output for ${input.schemaName} was unusable after 2 attempts${
        finishReason && finishReason !== "STOP" ? ` (finish reason: ${finishReason})` : ""
      }: ${detail}`.slice(0, 500));
    }
  }
  throw new Error("Gemini returned no usable structured output.");
}

export async function generateStructured<T>(
  input: GenerateInput<T>,
): Promise<StructuredGeneration<T>> {
  return input.provider === "openai"
    ? generateOpenAI(input)
    : generateGoogle(input);
}

export async function testProviderConnection(input: {
  provider: AIProviderName;
  apiKey: string;
  modelId: string;
}): Promise<void> {
  const connectionTestSchema = z.object({
    ok: z.literal(true),
  });
  if (input.provider === "openai") {
    const client = openAIClient(input.apiKey);
    await client.models.retrieve(input.modelId);
  } else {
    const client = googleAIClient(input.apiKey);
    await client.models.get({ model: input.modelId });
  }

  await generateStructured({
    ...input,
    schemaName: "connection_test",
    schema: connectionTestSchema,
    system: "Return the requested structured test response only.",
    prompt: 'Return {"ok":true}.',
  });
}

export async function transcribeAudio(input: {
  provider: AIProviderName;
  apiKey: string;
  modelId: string;
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  durationSeconds: number;
  googleSystemPrompt?: string;
  openaiPrompt?: string;
  transcriptionTemplate?: string;
}): Promise<StructuredGeneration<Transcript>> {
  if (input.provider === "openai") {
    const client = openAIClient(input.apiKey);
    const response = await client.audio.transcriptions.create({
      file: new File([Buffer.from(input.bytes)], input.filename, {
        type: input.mimeType,
      }),
      model: OPENAI_TRANSCRIPTION_MODEL,
      language: "en",
      prompt: input.openaiPrompt ?? OPENAI_TRANSCRIPTION_PROMPT,
      response_format: "json",
    });
    const text = response.text.trim();
    return {
      value: transcriptSchema.parse({
        language: "en",
        text,
        segments: text
          ? [
              {
                startSeconds: 0,
                endSeconds: input.durationSeconds,
                text,
              },
            ]
          : [],
      }),
    };
  }

  return generateStructured({
    provider: "google",
    apiKey: input.apiKey,
    modelId: input.modelId,
    schemaName: "speech_transcript",
    schema: transcriptSchema,
    system: input.googleSystemPrompt ?? GOOGLE_TRANSCRIPTION_SYSTEM_PROMPT,
    prompt: speechTranscriptionPrompt(
      input.durationSeconds,
      input.transcriptionTemplate,
    ),
    binary: {
      bytes: input.bytes,
      mimeType: input.mimeType,
    },
  });
}
