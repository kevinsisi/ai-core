import { randomUUID } from "node:crypto";
import { GoogleGenerativeAI, type FunctionResponsePart, type Part } from "@google/generative-ai";
import { GeminiClient, buildParts } from "../../client/gemini-client.js";
import type { KeyPool } from "../../key-pool/key-pool.js";
import { withRetry } from "../../retry/with-retry.js";
import { toGeminiTools } from "../../client/tool-conversion.js";
import { MaxToolRoundsExceededError } from "../../client/types.js";
import type { PoolCredential } from "../auth/index.js";
import { getBuiltInModel, getBuiltInProvider } from "../models.js";
import { ProviderID, type ModelDefinition } from "../schema.js";
import type { ProviderAdapter } from "../types.js";
import type {
  ChatEvent,
  ChatToolContext,
  GenerateParams,
  GenerateResponse,
  ImageGenParams,
  ImageGenResponse,
  TokenUsage,
} from "../../client/types.js";

/**
 * Heuristic match for Google Gemini model ids: `gemini-2.5-flash`,
 * `gemini-2.5-pro`, `gemini-3-flash-experimental`, etc. Lets the adapter
 * route to any current or future Gemini model without requiring an ai-core
 * release per new model.
 */
function isLikelyGeminiModel(modelID: string): boolean {
  return /^gemini-/i.test(modelID);
}

function synthesizeGeminiModel(modelID: string): ModelDefinition {
  return {
    id: modelID,
    provider: ProviderID.Gemini,
    name: modelID,
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: false,
    },
  };
}

function isModelNotFoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("404") ||
    lower.includes("not supported") ||
    lower.includes("invalid model") ||
    (lower.includes("model") && lower.includes("does not exist"))
  );
}

function extractUsageFromResponse(response: {
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

interface InlineDataPart {
  inlineData?: { mimeType?: string; data?: string };
  text?: string;
}

async function callGeminiImageGen(
  apiKey: string,
  modelID: string,
  params: ImageGenParams,
): Promise<ImageGenResponse> {
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: modelID });

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  for (const image of params.referenceImages ?? []) {
    if (image.type === "inline") {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    } else {
      // FileImagePart — adapters can read the file at the boundary if needed.
      // For now, defer to inline-only (callers can base64-encode before passing).
      throw new Error(
        "GeminiProviderAdapter.imageGen: FileImagePart not yet supported; pass InlineImagePart with base64 data instead",
      );
    }
  }
  parts.push({ text: params.prompt });

  const resp = await model.generateContent({
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as Record<string, unknown>,
  });

  const respParts = (resp.response.candidates?.[0]?.content?.parts ?? []) as InlineDataPart[];
  const images = respParts
    .filter((p): p is { inlineData: { mimeType: string; data: string } } =>
      Boolean(p.inlineData?.data && p.inlineData.mimeType),
    )
    .map((p) => ({ mimeType: p.inlineData.mimeType, data: p.inlineData.data }));
  if (images.length === 0) {
    throw new Error("Gemini image generation returned no image part");
  }

  const text = respParts
    .filter((p): p is { text: string } => typeof p.text === "string")
    .map((p) => p.text)
    .join("");

  return {
    images,
    text: text || undefined,
    usage: extractUsageFromResponse(resp.response),
  };
}

async function runGeminiChatLoop(
  apiKey: string,
  params: GenerateParams,
  ctx: ChatToolContext,
  push: (ev: ChatEvent) => void,
  maxRounds: number,
): Promise<void> {
  const genai = new GoogleGenerativeAI(apiKey);
  const tools = toGeminiTools(params.tools);
  const model = genai.getGenerativeModel({
    model: params.model,
    ...(params.systemInstruction && { systemInstruction: params.systemInstruction }),
    ...(tools && { tools }),
  });
  const history = (params.history ?? []).map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.parts }],
  }));
  const chat = model.startChat({ history });

  const initialParts: Part[] = params.images?.length
    ? buildParts(params.prompt, params.images)
    : [{ text: params.prompt }];

  let fullText = "";
  let result = await chat.sendMessageStream(initialParts);
  let round = 0;

  while (true) {
    let sawToolCall = false;
    const functionResponses: FunctionResponsePart[] = [];

    for await (const chunk of result.stream) {
      const calls = chunk.functionCalls();
      if (calls && calls.length > 0) {
        sawToolCall = true;
        for (const fc of calls) {
          const id = randomUUID();
          const args = (fc.args as Record<string, unknown>) ?? {};
          push({ type: "tool_call", id, name: fc.name, args });
          const toolResult = ctx.onToolCall
            ? await ctx.onToolCall({ id, name: fc.name, args })
            : "";
          functionResponses.push({
            functionResponse: { name: fc.name, response: { result: toolResult } },
          });
        }
      } else {
        const text = chunk.text();
        if (text) {
          fullText += text;
          push({ type: "text_delta", delta: text });
        }
      }
    }

    if (sawToolCall && functionResponses.length > 0) {
      round += 1;
      if (round >= maxRounds) {
        throw new MaxToolRoundsExceededError(round, maxRounds);
      }
      result = await chat.sendMessageStream(functionResponses);
      continue;
    }

    // Empty-chunk fallback after function call (Gemini SDK quirk: streaming
    // chunks after a tool response are sometimes blank, but the aggregated
    // response object has the full text).
    if (!fullText) {
      try {
        const fb = (await result.response).text();
        if (fb) {
          fullText = fb;
          push({ type: "text_delta", delta: fb });
        }
      } catch {
        // ignore — fall through to terminal events
      }
    }
    break;
  }

  const response = await result.response;
  const usage = extractUsageFromResponse(response);
  if (usage) push({ type: "usage", usage });
  push({ type: "done", fullText });
}

async function* runGeminiChatWithTools(
  pool: KeyPool,
  maxRetries: number,
  params: GenerateParams,
  ctx: ChatToolContext,
): AsyncIterable<ChatEvent> {
  const queue: ChatEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let runError: unknown = null;
  let runDone = false;

  const push = (ev: ChatEvent) => {
    queue.push(ev);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  const maxRounds = ctx.maxToolRounds ?? 5;

  const driver = (async () => {
    const [initialKey] = await pool.allocate(1);
    let currentKey = initialKey;
    let failed = false;
    let authFailure = false;

    try {
      await withRetry(
        async (apiKey) => {
          currentKey = apiKey;
          await runGeminiChatLoop(apiKey, params, ctx, push, maxRounds);
        },
        initialKey,
        {
          maxRetries,
          rotateKey: async () => {
            await pool.release(currentKey, true, authFailure);
            const [nextKey] = await pool.allocate(1);
            return nextKey;
          },
          onRetry: (info) => {
            if (info.errorClass === "fatal") authFailure = true;
          },
        },
      );
    } catch (err) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("fatal") ||
        message.includes("401") ||
        message.includes("403")
      ) {
        authFailure = true;
      }
      throw err;
    } finally {
      await pool.release(currentKey, failed, authFailure).catch(() => {});
    }
  })();

  driver
    .catch((err) => {
      runError = err;
    })
    .finally(() => {
      runDone = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r();
      }
    });

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (runDone) {
      if (runError) throw runError;
      return;
    }
    await new Promise<void>((r) => {
      resolveNext = r;
    });
  }
}

export class GeminiProviderAdapter implements ProviderAdapter {
  readonly provider = getBuiltInProvider("gemini")!;

  readonly credential: PoolCredential;

  private readonly client: GeminiClient;

  private readonly pool: KeyPool;

  private readonly maxRetries: number;

  constructor(pool: KeyPool, maxRetries = 3) {
    this.credential = { type: "pool", provider: "gemini", credentialLabel: "gemini-pool" };
    this.client = new GeminiClient(pool, { maxRetries });
    this.pool = pool;
    this.maxRetries = maxRetries;
  }

  supports(modelID: string): boolean {
    if (this.provider.models.some((model) => model.id === modelID)) return true;
    return isLikelyGeminiModel(modelID);
  }

  getModel(modelID: string): ModelDefinition | undefined {
    const builtIn = getBuiltInModel(modelID);
    if (builtIn && builtIn.provider === this.provider.id) return builtIn;
    if (isLikelyGeminiModel(modelID)) return synthesizeGeminiModel(modelID);
    return undefined;
  }

  async generateContent(params: GenerateParams): Promise<GenerateResponse> {
    return this.client.generateContent(params);
  }

  streamContent(params: GenerateParams): AsyncGenerator<string, void, unknown> {
    return this.client.streamContent(params);
  }

  /**
   * Streaming chat with native Gemini function-calling. Loop runs inside
   * the adapter: the model stream is consumed, `functionCalls()` are turned
   * into ChatEvents and dispatched to `ctx.onToolCall`, results are pushed
   * back as `FunctionResponsePart`, and streaming continues. Caps at
   * `ctx.maxToolRounds ?? 5` rounds; throws `MaxToolRoundsExceededError`
   * if the model keeps invoking tools past the cap.
   *
   * Preserves the v2.22.x "empty chunk after function call" SDK quirk:
   * when the post-tool-call stream produces no text chunks, the aggregated
   * `result.response.text()` is emitted as a single `text_delta`.
   */
  chatWithTools(params: GenerateParams, ctx: ChatToolContext): AsyncIterable<ChatEvent> {
    return runGeminiChatWithTools(this.pool, this.maxRetries, params, ctx);
  }

  /**
   * Image generation via Gemini's `responseModalities: ['IMAGE', 'TEXT']`
   * mode. Two model attempts max (`params.model` then `options.fallbackModel`)
   * — only the model-not-found-class error triggers the fallback; other
   * errors propagate immediately.
   *
   * `options.dedicatedKey` bypasses the pool entirely: a one-off
   * `GoogleGenerativeAI` client is constructed, no retry beyond the
   * fallback-model attempt, and the pool is left untouched. Used by
   * sheet-to-car's plate-redaction "paid key" pattern.
   */
  async imageGen(params: ImageGenParams): Promise<ImageGenResponse> {
    const options = params.options ?? {};
    const candidateModels = [params.model];
    if (options.fallbackModel) candidateModels.push(options.fallbackModel);

    let lastError: unknown;
    for (let i = 0; i < candidateModels.length; i++) {
      const modelID = candidateModels[i];
      const isLast = i === candidateModels.length - 1;
      try {
        if (options.dedicatedKey) {
          return await callGeminiImageGen(options.dedicatedKey, modelID, params);
        }
        return await this.executeWithPool(modelID, params);
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!isLast && isModelNotFoundError(msg)) continue;
        throw err;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Gemini image generation: all candidate models failed");
  }

  private async executeWithPool(
    modelID: string,
    params: ImageGenParams,
  ): Promise<ImageGenResponse> {
    const [initialKey] = await this.pool.allocate(1);
    let currentKey = initialKey;
    let failed = false;
    let authFailure = false;

    try {
      return await withRetry(
        async (apiKey) => {
          currentKey = apiKey;
          return callGeminiImageGen(apiKey, modelID, params);
        },
        initialKey,
        {
          maxRetries: this.maxRetries,
          rotateKey: async () => {
            await this.pool.release(currentKey, true, authFailure);
            const [nextKey] = await this.pool.allocate(1);
            return nextKey;
          },
          onRetry: (info) => {
            if (info.errorClass === "fatal") authFailure = true;
          },
        },
      );
    } catch (err) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("fatal") ||
        message.includes("401") ||
        message.includes("403")
      ) {
        authFailure = true;
      }
      throw err;
    } finally {
      await this.pool.release(currentKey, failed, authFailure).catch(() => {});
    }
  }
}
