import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
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

  const response = await client.responses.create({
    model: input.modelId,
    instructions: input.system,
    input: [{ role: "user", content }],
    reasoning: { effort: "low" },
    max_output_tokens: 4_000,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: input.schemaName,
        schema: z.toJSONSchema(input.schema),
        strict: true,
      },
    },
  });

  return {
    value: input.schema.parse(JSON.parse(cleanJson(response.output_text))),
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
  const parts: Array<
    | { text: string }
    | { inlineData: { data: string; mimeType: string } }
  > = [{ text: input.prompt }];

  if (input.binary) {
    parts.push({
      inlineData: {
        data: Buffer.from(input.binary.bytes).toString("base64"),
        mimeType: input.binary.mimeType,
      },
    });
  }

  const response = await client.models.generateContent({
    model: input.modelId,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: input.system,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(input.schema),
      maxOutputTokens: 4_000,
    },
  });
  if (!response.text) throw new Error("Gemini returned an empty response.");

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
  if (input.provider === "openai") {
    const client = new OpenAI({ apiKey: input.apiKey });
    await client.models.retrieve(input.modelId);
    return;
  }

  const client = new GoogleGenAI({ apiKey: input.apiKey });
  await client.models.get({ model: input.modelId });
}

export async function transcribeAudio(input: {
  provider: AIProviderName;
  apiKey: string;
  modelId: string;
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  durationSeconds: number;
}): Promise<StructuredGeneration<Transcript>> {
  if (input.provider === "openai") {
    const client = new OpenAI({ apiKey: input.apiKey });
    const response = await client.audio.transcriptions.create({
      file: new File([Buffer.from(input.bytes)], input.filename, {
        type: input.mimeType,
      }),
      model: OPENAI_TRANSCRIPTION_MODEL,
      language: "en",
      prompt: OPENAI_TRANSCRIPTION_PROMPT,
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
    system: GOOGLE_TRANSCRIPTION_SYSTEM_PROMPT,
    prompt: speechTranscriptionPrompt(input.durationSeconds),
    binary: {
      bytes: input.bytes,
      mimeType: input.mimeType,
    },
  });
}
