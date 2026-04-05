import { readFileSync } from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Part } from "@google/generative-ai";
import type { KeyPool } from "../key-pool/key-pool.js";
import { withRetry } from "../retry/with-retry.js";
import type {
  GenerateParams,
  GenerateResponse,
  ChatMessage,
  ClientOptions,
  TokenUsage,
  ImagePart,
} from "./types.js";
import { StreamInterruptedError } from "./types.js";

// ── Helpers ────────────────────────────────────────────────────────────

function extractUsage(response: {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}): TokenUsage | null {
  const meta = response.usageMetadata;
  if (!meta) return null;
  return {
    promptTokens: meta.promptTokenCount ?? 0,
    completionTokens: meta.candidatesTokenCount ?? 0,
    totalTokens: meta.totalTokenCount ?? 0,
  };
}

function buildHistory(history: ChatMessage[]) {
  return history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.parts }],
  }));
}

/**
 * Build a Part[] for a multimodal request.
 * Returns an array with a TextPart followed by one InlineDataPart per image.
 * File-path images are read synchronously and base64-encoded.
 */
export function buildParts(prompt: string, images?: ImagePart[]): Part[] {
  const parts: Part[] = [{ text: prompt }];

  for (const image of images ?? []) {
    if (image.type === "inline") {
      parts.push({
        inlineData: { mimeType: image.mimeType, data: image.data },
      });
    } else {
      const data = readFileSync(image.filePath).toString("base64");
      parts.push({
        inlineData: { mimeType: image.mimeType, data },
      });
    }
  }

  return parts;
}

// ── GeminiClient ───────────────────────────────────────────────────────

/**
 * Thin wrapper around @google/generative-ai that handles:
 * - Key allocation and release via KeyPool
 * - Retry + key rotation via withRetry
 * - Usage tracking (returned in response, caller decides what to do with it)
 * - Multimodal content (text + images) via GenerateParams.images
 */
export class GeminiClient {
  private readonly pool: KeyPool;
  private readonly maxRetries: number;

  constructor(pool: KeyPool, options: ClientOptions = {}) {
    this.pool = pool;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /**
   * Generate content (non-streaming).
   * Automatically allocates a key, calls Gemini, releases the key.
   */
  async generateContent(params: GenerateParams): Promise<GenerateResponse> {
    // Allocate one key upfront; withRetry will rotate via pool.allocate if needed
    const [initialKey] = await this.pool.allocate(1);

    let currentKey = initialKey;
    let failed = false;
    let authFailure = false;

    try {
      const response = await withRetry(
        async (apiKey) => {
          currentKey = apiKey;
          const genai = new GoogleGenerativeAI(apiKey);
          const model = genai.getGenerativeModel({
            model: params.model,
            ...(params.systemInstruction && {
              systemInstruction: params.systemInstruction,
            }),
            ...(params.tools && { tools: params.tools }),
            ...(params.maxOutputTokens && {
              generationConfig: { maxOutputTokens: params.maxOutputTokens },
            }),
          });

          const content = params.images?.length
            ? buildParts(params.prompt, params.images)
            : params.prompt;

          if (params.history && params.history.length > 0) {
            const chat = model.startChat({
              history: buildHistory(params.history),
            });
            const result = await chat.sendMessage(params.prompt);
            return result.response;
          } else {
            const result = await model.generateContent(content);
            return result.response;
          }
        },
        initialKey,
        {
          maxRetries: this.maxRetries,
          rotateKey: async () => {
            // Release the failed key with cooldown before rotating
            await this.pool.release(currentKey, true);
            const [nextKey] = await this.pool.allocate(1);
            return nextKey;
          },
          onRetry: (info) => {
            if (info.errorClass === "fatal") {
              authFailure = true;
            }
          },
        }
      );

      const text = response.text();
      const usage = extractUsage(response);
      return { text, usage };
    } catch (err) {
      failed = true;
      if (
        err instanceof Error &&
        (err.message.includes("fatal") ||
          err.message.includes("401") ||
          err.message.includes("403"))
      ) {
        authFailure = true;
      }
      throw err;
    } finally {
      // Release the last key used (currentKey may have been rotated)
      if (failed && currentKey !== initialKey) {
        // rotateKey already released initialKey; release currentKey too
        await this.pool.release(currentKey, true, authFailure).catch(() => {});
      } else if (!failed) {
        await this.pool.release(currentKey, false).catch(() => {});
      } else {
        await this.pool.release(currentKey, true, authFailure).catch(() => {});
      }
    }
  }

  /**
   * Generate content as a stream.
   * Yields text chunks as they arrive.
   *
   * @throws StreamInterruptedError if the stream is interrupted mid-way.
   */
  async *streamContent(
    params: GenerateParams
  ): AsyncGenerator<string, void, unknown> {
    const [key] = await this.pool.allocate(1);
    let chunksReceived = 0;
    let failed = false;

    try {
      const genai = new GoogleGenerativeAI(key);
      const model = genai.getGenerativeModel({
        model: params.model,
        ...(params.systemInstruction && {
          systemInstruction: params.systemInstruction,
        }),
        ...(params.tools && { tools: params.tools }),
      });

      const content = params.images?.length
        ? buildParts(params.prompt, params.images)
        : params.prompt;

      const result = await model.generateContentStream(content);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          chunksReceived++;
          yield text;
        }
      }
    } catch (err) {
      failed = true;
      throw new StreamInterruptedError(chunksReceived, err);
    } finally {
      await this.pool.release(key, failed).catch(() => {});
    }
  }
}
