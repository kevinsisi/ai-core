import { toOpenAITools } from "../../client/tool-conversion.js";
import { StreamInterruptedError } from "../../client/types.js";
import type { GenerateParams, GenerateResponse } from "../../client/types.js";
import type { ApiKeyCredential } from "../auth.js";
import type { ModelDefinition, ProviderDefinition } from "../schema.js";
import type { ProviderAdapter } from "../types.js";

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
}

export function toOpenAIMessages(params: GenerateParams): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];

  if (params.systemInstruction) {
    messages.push({ role: "system", content: params.systemInstruction });
  }

  for (const message of params.history ?? []) {
    messages.push({
      role: message.role === "model" ? "assistant" : message.role,
      content: message.parts,
    });
  }

  messages.push({ role: "user", content: params.prompt });
  return messages;
}

/**
 * Shared transport for OpenAI-style /chat/completions endpoints.
 *
 * Subclasses provide the provider definition, default base URL, and any
 * additional headers (OpenRouter app attribution, organization scoping, etc.).
 * Tool conversion is keyed off `nativeToolProvider` so each subclass passes
 * through its own `provider-native` tools while still ignoring foreign ones.
 */
export abstract class OpenAICompatibleAdapter implements ProviderAdapter {
  abstract readonly provider: ProviderDefinition;
  readonly credential: ApiKeyCredential;

  protected abstract readonly defaultBaseURL: string;
  protected abstract readonly nativeToolProvider: string;

  constructor(credential: ApiKeyCredential) {
    this.credential = credential;
  }

  supports(modelID: string): boolean {
    return this.provider.models.some((model) => model.id === modelID);
  }

  getModel(modelID: string): ModelDefinition | undefined {
    const model = this.provider.models.find((item) => item.id === modelID);
    return model;
  }

  protected buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.credential.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  protected get baseURL(): string {
    return this.credential.baseURL ?? this.defaultBaseURL;
  }

  private buildRequestBody(params: GenerateParams, stream: boolean) {
    const model = params.model || this.provider.models[0].id;
    const tools = toOpenAITools(params.tools, this.nativeToolProvider);
    return {
      model,
      messages: toOpenAIMessages(params),
      ...(tools && { tools }),
      ...(params.maxOutputTokens && { max_tokens: params.maxOutputTokens }),
      ...(stream && { stream: true }),
    };
  }

  async generateContent(params: GenerateParams): Promise<GenerateResponse> {
    if (params.images?.length) {
      throw new Error(
        `${this.provider.name} adapter does not support multimodal input yet`
      );
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildRequestBody(params, false)),
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(
        text || `${this.provider.name} request failed with status ${response.status}`
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const json = (await response.json()) as OpenAIChatResponse;
    const firstContent = json.choices?.[0]?.message?.content;
    const text = Array.isArray(firstContent)
      ? firstContent.map((item) => item.text || "").join("")
      : (firstContent ?? "");

    return {
      text,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
            totalTokens: json.usage.total_tokens ?? 0,
          }
        : null,
    };
  }

  async *streamContent(params: GenerateParams): AsyncGenerator<string, void, unknown> {
    if (params.images?.length) {
      throw new Error(
        `${this.provider.name} adapter does not support multimodal input yet`
      );
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: { ...this.buildHeaders(), Accept: "text/event-stream" },
      body: JSON.stringify(this.buildRequestBody(params, true)),
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(
        text || `${this.provider.name} stream request failed with status ${response.status}`
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    if (!response.body) {
      throw new Error(`${this.provider.name} stream response has no body`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let chunksReceived = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffered.indexOf("\n")) !== -1) {
          const rawLine = buffered.slice(0, newlineIndex).replace(/\r$/, "");
          buffered = buffered.slice(newlineIndex + 1);
          if (!rawLine.startsWith("data:")) continue;

          const payload = rawLine.slice(5).trim();
          if (payload === "" || payload === "[DONE]") continue;

          let parsed: OpenAIStreamChunk;
          try {
            parsed = JSON.parse(payload) as OpenAIStreamChunk;
          } catch (err) {
            throw new StreamInterruptedError(chunksReceived, err);
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            chunksReceived += 1;
            yield delta;
          }
        }
      }
    } catch (err) {
      if (err instanceof StreamInterruptedError) throw err;
      throw new StreamInterruptedError(chunksReceived, err);
    } finally {
      reader.releaseLock();
    }
  }
}
