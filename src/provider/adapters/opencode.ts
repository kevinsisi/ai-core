/**
 * OpenCodeProviderAdapter
 *
 * Connects to an OpenCode server (https://opencode.ai) running in server mode.
 * The server exposes a session-based HTTP API at port 4096. Authentication is
 * managed by the server itself (OAuth tokens stored in auth.json on the server);
 * this adapter only needs the server URL and an optional server password.
 *
 * ## How the OpenCode session API works
 *
 *   POST   /session                          → create session, get { id }
 *   POST   /session/{id}/message             → send message parts, get response parts
 *   DELETE /session/{id}                     → clean up (fire-and-forget)
 *
 * ## Message parts (input)
 *
 *   Text:  { type: "text", text: string }
 *   Image: { type: "file", mime: string, url: "data:<mime>;base64,<b64>", filename?: string }
 *
 * ## Message parts (output)
 *
 *   Text responses appear as parts with type === "text" and synthetic !== true.
 *   Token usage is in the top-level `info.tokens` field.
 *
 * ## Model reference format
 *
 *   OpenCode models are addressed as "<providerID>/<modelID>", e.g.:
 *     "opencode/deepseek-v4-flash-free"   — free zen model, no auth needed
 *     "openai/gpt-5.5"                    — requires OpenAI OAuth on the server
 *     "openai/gpt-4o"                     — requires OpenAI OAuth on the server
 *
 *   Pass these as the `model` field in GenerateParams. The adapter splits on the
 *   first "/" to get providerID and modelID for the API payload.
 *
 * ## Multimodal support
 *
 *   Images are supported when the underlying model supports vision (e.g. gpt-5.5,
 *   gpt-4o). Pass `images` in GenerateParams as InlineImagePart objects. The
 *   adapter converts them to OpenCode file parts with base64 data URLs.
 *
 * ## Conversation history
 *
 *   OpenCode sessions maintain history internally. For multi-turn conversations,
 *   create a persistent session (keep sessionID across calls) and use the
 *   sessionID-aware constructor option. For single-turn use (default), a new
 *   session is created per call and deleted after.
 *
 * ## Server password
 *
 *   If OPENCODE_SERVER_PASSWORD is set on the server, pass it as the `apiKey`
 *   in an ApiKeyCredential with `basicAuth: true`. Leave credential as a
 *   PoolCredential with no key for open servers.
 */

import { readFile } from "node:fs/promises";
import type { GenerateParams, GenerateResponse, ImagePart } from "../../client/types.js";
import type { ApiKeyCredential, OAuthCredential, PoolCredential } from "../auth/index.js";
import { getBuiltInModel } from "../models.js";
import type { ModelDefinition, ProviderDefinition } from "../schema.js";
import type { ProviderAdapter } from "../types.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface OpenCodeModelRef {
  /** The downstream provider id, e.g. "opencode", "openai", "google". */
  providerID: string;
  /** The model id within that provider, e.g. "deepseek-v4-flash-free", "gpt-5.5". */
  id: string;
}

export interface OpenCodeAdapterOptions {
  /**
   * Base URL of the OpenCode server, e.g. "http://localhost:4096".
   * Defaults to "http://127.0.0.1:4096".
   */
  baseURL?: string;
  /**
   * OpenCode agent mode. Defaults to "general".
   * Other values: "build", "code", etc.
   */
  agent?: string;
  /** Session title shown in the OpenCode UI. */
  title?: string;
  /**
   * Default model used when the caller does not specify a providerID prefix.
   * e.g. { providerID: "opencode", id: "deepseek-v4-flash-free" }
   */
  defaultModel: OpenCodeModelRef;
  /**
   * Set to true when the server has OPENCODE_SERVER_PASSWORD configured.
   * When true, sends HTTP Basic Auth using "opencode:<apiKey>".
   * When false (default), sends Bearer token or no auth.
   */
  basicAuth?: boolean;
}

type OpenCodeCredential = ApiKeyCredential | OAuthCredential | PoolCredential;

// ── OpenCode API response shapes ───────────────────────────────────────────

interface OpenCodeSessionResponse {
  id?: string;
}

interface OpenCodeTextPart {
  type: "text";
  text: string;
  synthetic?: boolean;
}

interface OpenCodeFilePart {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
}

type OpenCodeInputPart = OpenCodeTextPart | OpenCodeFilePart;

interface OpenCodeAssistantInfo {
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
  };
}

interface OpenCodeMessageResponse {
  info?: OpenCodeAssistantInfo;
  parts?: Array<OpenCodeTextPart | { type: string; synthetic?: boolean }>;
}

interface OpenCodeModelPayload {
  modelID: string;
  providerID: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function modelToID(model: OpenCodeModelRef): string {
  return `${model.providerID}/${model.id}`;
}

function modelToPayload(model: OpenCodeModelRef): OpenCodeModelPayload {
  return { modelID: model.id, providerID: model.providerID };
}

function parseModelRef(modelID: string, defaultProviderID: string): OpenCodeModelRef | undefined {
  const sep = modelID.indexOf("/");
  if (sep > 0 && sep < modelID.length - 1) {
    return { providerID: modelID.slice(0, sep), id: modelID.slice(sep + 1) };
  }
  const builtInModel = getBuiltInModel(modelID);
  if (builtInModel && builtInModel.provider !== "opencode") return undefined;
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
      multimodalInput: true,
      multimodalOutput: false,
    },
  };
}

async function imagePartToOpenCode(image: ImagePart): Promise<OpenCodeFilePart> {
  if (image.type === "inline") {
    return {
      type: "file",
      mime: image.mimeType,
      url: `data:${image.mimeType};base64,${image.data}`,
    };
  }
  // type === "file": read from disk and encode
  const buf = await readFile(image.filePath);
  return {
    type: "file",
    mime: image.mimeType,
    url: `data:${image.mimeType};base64,${buf.toString("base64")}`,
    filename: image.filePath.split(/[\\/]/).pop(),
  };
}

// ── Adapter ────────────────────────────────────────────────────────────────

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
      options.baseURL ??
        ("baseURL" in credential ? credential.baseURL : undefined) ??
        "http://127.0.0.1:4096",
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
    const model = this.resolveModel(params.model);
    if (!model) {
      throw new Error(`OpenCode adapter cannot resolve model "${params.model}"`);
    }

    const session = await this.createSession(model);
    try {
      const message = await this.sendMessage(session.id, params, model);

      const text = (message.parts ?? [])
        .filter((p): p is OpenCodeTextPart => p.type === "text" && !p.synthetic)
        .map((p) => p.text)
        .join("");

      const t = message.info?.tokens;
      return {
        text,
        usage: t
          ? {
              promptTokens: t.input ?? 0,
              completionTokens: (t.output ?? 0) + (t.reasoning ?? 0),
              totalTokens: (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0),
            }
          : null,
      };
    } finally {
      this.deleteSession(session.id);
    }
  }

  async *streamContent(_params: GenerateParams): AsyncGenerator<string, void, unknown> {
    throw new Error(
      "OpenCodeProviderAdapter does not support streaming. Use generateContent instead.",
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private resolveModel(modelID: string): OpenCodeModelRef | undefined {
    const model = parseModelRef(modelID, this.defaultModel.providerID);
    if (!model?.id || !model.providerID) return undefined;
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
    const json = await this.readJson<OpenCodeSessionResponse>(response, "create session");
    if (!json.id) throw new Error("OpenCode create session response missing id");
    return { id: json.id };
  }

  private async sendMessage(
    sessionID: string,
    params: GenerateParams,
    model: OpenCodeModelRef,
  ): Promise<OpenCodeMessageResponse> {
    const parts: OpenCodeInputPart[] = [];

    // Attach images first (before text, matching web UI convention)
    if (params.images?.length) {
      const imageParts = await Promise.all(params.images.map(imagePartToOpenCode));
      parts.push(...imageParts);
    }

    parts.push({ type: "text", text: params.prompt });

    const response = await fetch(
      `${this.baseURL}/session/${encodeURIComponent(sessionID)}/message`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          agent: this.agent,
          model: modelToPayload(model),
          ...(params.systemInstruction && { system: params.systemInstruction }),
          parts,
        }),
      },
    );
    return this.readJson<OpenCodeMessageResponse>(response, "send message");
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
      const error = new Error(
        text || `OpenCode ${operation} failed with HTTP ${response.status}`,
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return (await response.json()) as T;
  }
}
