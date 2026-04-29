import { toOpenAITools } from "../../client/tool-conversion.js";
import type { GenerateParams, GenerateResponse } from "../../client/types.js";
import type { ApiKeyCredential } from "../auth.js";
import { getBuiltInModel, getBuiltInProvider } from "../models.js";
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

function toOpenAIMessages(params: GenerateParams) {
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

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly provider = getBuiltInProvider("openai")!;

  readonly credential: ApiKeyCredential;

  constructor(credential: ApiKeyCredential) {
    this.credential = credential;
  }

  supports(modelID: string): boolean {
    return this.provider.models.some((model) => model.id === modelID);
  }

  getModel(modelID: string) {
    const model = getBuiltInModel(modelID);
    if (!model || model.provider !== this.provider.id) return undefined;
    return model;
  }

  async generateContent(params: GenerateParams): Promise<GenerateResponse> {
    if (params.images?.length) {
      throw new Error("OpenAIProviderAdapter phase 1 does not support multimodal input yet");
    }

    const model = params.model || this.provider.models[0].id;
    const baseURL = this.credential.baseURL ?? "https://api.openai.com/v1";
    const openAITools = toOpenAITools(params.tools);

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.credential.apiKey}`,
        "Content-Type": "application/json",
        ...(this.credential.organization && { "OpenAI-Organization": this.credential.organization }),
      },
      body: JSON.stringify({
        model,
        messages: toOpenAIMessages(params),
        ...(openAITools && { tools: openAITools }),
        ...(params.maxOutputTokens && { max_tokens: params.maxOutputTokens }),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(text || `OpenAI request failed with status ${response.status}`) as Error & {
        status?: number;
      };
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
}
