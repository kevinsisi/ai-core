import type { GenerateParams, GenerateResponse } from "../../client/types.js";
import type { ApiKeyCredential, OAuthCredential, PoolCredential } from "../auth/index.js";
import type { ModelDefinition, ProviderDefinition } from "../schema.js";
import type { ProviderAdapter } from "../types.js";

export interface OpenCodeModelRef {
  id: string;
  providerID: string;
}

export interface OpenCodeAdapterOptions {
  baseURL?: string;
  agent?: string;
  title?: string;
  defaultModel: OpenCodeModelRef;
  basicAuth?: boolean;
}

type OpenCodeCredential = ApiKeyCredential | OAuthCredential | PoolCredential;

interface OpenCodeSessionResponse {
  id?: string;
}

interface OpenCodeTextPart {
  type: "text";
  text: string;
}

interface OpenCodeAssistantInfo {
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
  };
}

interface OpenCodeMessageResponse {
  info?: OpenCodeAssistantInfo;
  parts?: Array<OpenCodeTextPart | { type: string }>;
}

interface OpenCodeModelPayload {
  modelID: string;
  providerID: string;
}

function modelToPayload(model: OpenCodeModelRef): OpenCodeModelPayload {
  return { modelID: model.id, providerID: model.providerID };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function modelToID(model: OpenCodeModelRef): string {
  return `${model.providerID}/${model.id}`;
}

function parseModelRef(modelID: string, defaultProviderID: string): OpenCodeModelRef {
  const separator = modelID.indexOf("/");
  if (separator > 0 && separator < modelID.length - 1) {
    return {
      providerID: modelID.slice(0, separator),
      id: modelID.slice(separator + 1),
    };
  }

  return { providerID: defaultProviderID, id: modelID };
}

function synthesizeModel(model: OpenCodeModelRef): ModelDefinition {
  return {
    id: modelToID(model),
    provider: "opencode",
    name: modelToID(model),
    capabilities: {
      streaming: false,
      tools: false,
      reasoning: true,
      multimodalInput: false,
      multimodalOutput: false,
    },
  };
}

export class OpenCodeProviderAdapter implements ProviderAdapter {
  readonly provider: ProviderDefinition;
  readonly credential: OpenCodeCredential;

  private readonly baseURL: string;
  private readonly agent: string;
  private readonly title: string;
  private readonly defaultModel: OpenCodeModelRef;
  private readonly basicAuth: boolean;

  constructor(credential: OpenCodeCredential, options: OpenCodeAdapterOptions) {
    this.credential = credential;
    this.defaultModel = options.defaultModel;
    this.baseURL = trimTrailingSlash(
      options.baseURL ?? ("baseURL" in credential ? credential.baseURL : undefined) ?? "http://127.0.0.1:4096"
    );
    this.agent = options.agent ?? "general";
    this.title = options.title ?? "ai-core opencode session";
    this.basicAuth = options.basicAuth ?? false;
    this.provider = {
      id: "opencode",
      name: "OpenCode",
      authTypes: ["api", "oauth", "pool"],
      models: [synthesizeModel(options.defaultModel)],
    };
  }

  supports(modelID: string): boolean {
    return Boolean(this.resolveModel(modelID));
  }

  getModel(modelID: string): ModelDefinition | undefined {
    const model = this.resolveModel(modelID);
    return model ? synthesizeModel(model) : undefined;
  }

  async generateContent(params: GenerateParams): Promise<GenerateResponse> {
    if (params.images?.length) {
      throw new Error("OpenCode adapter does not support multimodal input yet");
    }

    const model = this.resolveModel(params.model);
    if (!model) {
      throw new Error(`OpenCode adapter cannot resolve model "${params.model}"`);
    }

    const session = await this.createSession(model);
    try {
      const message = await this.sendMessage(session.id, params, model);
      const text = (message.parts ?? [])
        .filter((part): part is OpenCodeTextPart => part.type === "text")
        .map((part) => part.text)
        .join("");
      const tokens = message.info?.tokens;

      return {
        text,
        usage: tokens
          ? {
              promptTokens: tokens.input ?? 0,
              completionTokens: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
              totalTokens: (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0),
            }
          : null,
      };
    } finally {
      this.deleteSession(session.id);
    }
  }

  async *streamContent(_params: GenerateParams): AsyncGenerator<string, void, unknown> {
    throw new Error("OpenCode adapter streaming is not implemented; use generateContent or add SSE support explicitly");
  }

  private resolveModel(modelID: string): OpenCodeModelRef | undefined {
    const model = parseModelRef(modelID, this.defaultModel.providerID);
    if (!model.id || !model.providerID) return undefined;
    return model;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.basicAuth && this.credential.type === "api" && this.credential.apiKey) {
      const encoded = Buffer.from(`opencode:${this.credential.apiKey}`).toString("base64");
      headers.Authorization = `Basic ${encoded}`;
    } else if (this.credential.type === "api" && this.credential.apiKey) {
      headers.Authorization = `Bearer ${this.credential.apiKey}`;
    } else if (this.credential.type === "oauth" && this.credential.accessToken) {
      headers.Authorization = `Bearer ${this.credential.accessToken}`;
    }
    return headers;
  }

  private async createSession(model: OpenCodeModelRef): Promise<{ id: string }> {
    const response = await fetch(`${this.baseURL}/session`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ title: this.title, agent: this.agent, model: modelToPayload(model) }),
    });
    const json = await this.readJson<OpenCodeSessionResponse>(response, "OpenCode create session");
    if (!json.id) {
      throw new Error("OpenCode create session response did not include session id");
    }
    return { id: json.id };
  }

  private async sendMessage(
    sessionID: string,
    params: GenerateParams,
    model: OpenCodeModelRef
  ): Promise<OpenCodeMessageResponse> {
    const response = await fetch(`${this.baseURL}/session/${encodeURIComponent(sessionID)}/message`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        agent: this.agent,
        model: modelToPayload(model),
        ...(params.systemInstruction && { system: params.systemInstruction }),
        parts: [{ type: "text", text: params.prompt }],
      }),
    });
    return this.readJson<OpenCodeMessageResponse>(response, "OpenCode send message");
  }

  private deleteSession(sessionID: string): void {
    fetch(`${this.baseURL}/session/${encodeURIComponent(sessionID)}`, {
      method: "DELETE",
      headers: this.buildHeaders(),
    }).catch((err: unknown) => {
      console.warn(`[opencode] deleteSession ${sessionID} failed:`, err);
    });
  }

  private async readJson<T>(response: Response, operation: string): Promise<T> {
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(text || `${operation} failed with status ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return (await response.json()) as T;
  }
}
