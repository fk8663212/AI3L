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
  const client = new OpenAI({ apiKey: input.apiKey });
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
  const client = new GoogleGenAI({ apiKey: input.apiKey });
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

  let response;
  try {
    response = await client.models.generateContent({
      model: input.modelId,
      contents: [{ role: "user", parts: partsForPrompt(input.prompt) }],
      config: {
        systemInstruction: input.system,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        maxOutputTokens: 8_000,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
    });
  } catch (error) {
    const status =
      typeof error === "object" &&
      error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : undefined;
    const message =
      error instanceof Error ? error.message.toLowerCase() : "";
    const invalidSchemaRequest =
      status === 400 &&
      (message.includes("invalid_argument") ||
        message.includes("invalid argument"));
    if (!invalidSchemaRequest) throw error;

    const compatibilityPrompt = `${input.prompt}

Return only JSON matching this schema exactly:
${JSON.stringify(schema)}`;
    response = await client.models.generateContent({
      model: input.modelId,
      contents: [
        { role: "user", parts: partsForPrompt(compatibilityPrompt) },
      ],
      config: {
        systemInstruction: input.system,
        responseMimeType: "application/json",
        maxOutputTokens: 8_000,
      },
    });
  }
  if (!response.text) {
    const finishReason = response.candidates?.[0]?.finishReason;
    throw new Error(
      `Gemini returned no structured output${
        finishReason ? ` (finish reason: ${finishReason})` : ""
      }.`,
    );
  }

  return {
    value: input.schema.parse(JSON.parse(cleanJson(response.text))),
    providerResponseId: response.responseId,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    },
  };
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
    const client = new OpenAI({ apiKey: input.apiKey });
    await client.models.retrieve(input.modelId);
  } else {
    const client = new GoogleGenAI({ apiKey: input.apiKey });
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
    const client = new OpenAI({ apiKey: input.apiKey });
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
