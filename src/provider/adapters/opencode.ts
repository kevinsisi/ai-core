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
 * ## Streaming
 *
 *   OpenCode currently returns a completed assistant message instead of token
 *   deltas. `streamContent()` exposes that response as a pseudo-stream by
 *   yielding the completed text once, so SSE consumers can keep one routed path.
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
import { MaxToolRoundsExceededError } from "../../client/types.js";
import type {
  ChatEvent,
  ChatToolContext,
  GenerateParams,
  GenerateResponse,
  ImagePart,
  ToolCall,
  Tool,
  FunctionTool,
} from "../../client/types.js";
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
  /**
   * OpenAI-compatible chat-completions endpoint used for NATIVE function calling
   * in chatWithTools() — far more reliable than the legacy <tool_call> prompt
   * hack (free Zen models emit tool_calls natively but routinely refuse to
   * hand-write the XML). Defaults to the OpenCode Zen endpoint. Native calling is
   * only attempted when the credential is an api-key Bearer token (not basicAuth);
   * otherwise, or if the first native call fails, the legacy prompt protocol runs.
   */
  nativeToolsURL?: string;
  /**
   * OpenCode model variant passed to `POST /session` as `model.variant`.
   * Controls reasoning effort / quality tier (e.g. "default", "medium",
   * "high") for models that expose multiple variants. Defaults to "default".
   * Per the OpenCode HTTP contract, variant only appears in the session-
   * creation payload; message payloads remain `{ providerID, modelID }`.
   */
  variant?: string;
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

interface OpenCodeSessionModelPayload {
  id: string;
  providerID: string;
  variant: string;
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

/**
 * Session-creation payload uses a different key shape than message payloads:
 *   POST /session            → model: { providerID, id, variant }
 *   POST /session/.../message → model: { providerID, modelID }
 *
 * Mixing them up returns OpenCode `{"_tag":"BadRequest"}` (e.g. session sent
 * with `modelID` instead of `id`, or message sent with `id` instead of
 * `modelID`). See home-basic/opencode/README.md "Consumer API Contract".
 */
function modelToSessionPayload(model: OpenCodeModelRef, variant = "default"): OpenCodeSessionModelPayload {
  return { id: model.id, providerID: model.providerID, variant };
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
      streaming: true,
      tools: true,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: false,
    },
  };
}

function parseToolCallJson(value: string, index: number): ToolCall | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const payload = parsed as Record<string, unknown>;
    const name = typeof payload.name === "string" ? payload.name : undefined;
    if (!name) return undefined;
    const rawArgs = payload.args ?? payload.arguments;
    const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
    return {
      id: typeof payload.id === "string" ? payload.id : `opencode-call-${index + 1}`,
      name,
      args,
    };
  } catch {
    return undefined;
  }
}

function extractToolCallsFromText(text: string): { text: string; toolCalls?: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let matched = false;
  const stripped = text.replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (_match, payload: string) => {
    matched = true;
    const call = parseToolCallJson(payload.trim(), toolCalls.length);
    if (call) toolCalls.push(call);
    return "";
  });
  if (!matched) return { text };
  return { text: stripped, ...(toolCalls.length > 0 && { toolCalls }) };
}

function isFunctionTool(tool: Tool): tool is FunctionTool {
  return tool.type === "function";
}

function buildOpenCodeToolBlock(tools: Tool[] | undefined): string {
  const functions = (tools ?? []).filter(isFunctionTool);
  if (functions.length === 0) return "";
  const lines: string[] = [
    "You have access to the following tools. To call a tool, embed this exact block in your response:",
    "",
    '<tool_call>{"name":"TOOL_NAME","args":{...}}</tool_call>',
    "",
    "Only call one tool at a time. After seeing the tool result, continue your response.",
    "",
    "Available tools:",
  ];
  for (const tool of functions) {
    const params = (tool.parameters ?? {}) as {
      required?: string[];
      properties?: Record<string, { description?: string }>;
    };
    const required = params.required ?? [];
    const propLines = Object.entries(params.properties ?? {})
      .map(
        ([k, v]) =>
          `    - ${k}${required.includes(k) ? " (required)" : ""}: ${v?.description ?? ""}`,
      )
      .join("\n");
    lines.push(`\n- ${tool.name}: ${tool.description ?? ""}${propLines ? "\n" + propLines : ""}`);
  }
  return lines.join("\n");
}

function serializeHistory(history: { role: "user" | "model"; parts: string }[]): string {
  return history
    .map((msg) => `${msg.role === "model" ? "Assistant" : "User"}: ${msg.parts}`)
    .join("\n\n");
}

// ── Native OpenAI-style function calling (preferred over the <tool_call> hack) ─
class NativeUnsupportedError extends Error {}

interface OAINativeToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

function toNativeTools(tools: Tool[] | undefined): unknown[] | undefined {
  const fns = (tools ?? []).filter(isFunctionTool);
  if (fns.length === 0) return undefined;
  return fns.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.parameters ?? { type: "object", properties: {} },
    },
  }));
}

function buildNativeMessages(params: GenerateParams): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  if (params.systemInstruction) messages.push({ role: "system", content: params.systemInstruction });
  for (const turn of params.history ?? []) {
    messages.push({ role: turn.role === "model" ? "assistant" : "user", content: turn.parts });
  }
  messages.push({ role: "user", content: params.prompt });
  return messages;
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
  private readonly variant: string;
  private readonly nativeToolsURL: string;

  constructor(credential: OpenCodeCredential, options: OpenCodeAdapterOptions) {
    this.credential = credential;
    this.defaultModel = options.defaultModel;
    this.nativeToolsURL =
      options.nativeToolsURL ?? "https://opencode.ai/zen/v1/chat/completions";
    this.baseURL = trimTrailingSlash(
      options.baseURL ??
        ("baseURL" in credential ? credential.baseURL : undefined) ??
        "http://127.0.0.1:4096",
    );
    this.agent = options.agent ?? "general";
    this.title = options.title ?? "ai-core opencode session";
    this.basicAuth = options.basicAuth ?? false;
    this.variant = options.variant ?? "default";
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

      const rawText = (message.parts ?? [])
        .filter((p): p is OpenCodeTextPart => p.type === "text" && !p.synthetic)
        .map((p) => p.text)
        .join("");
      const { text, toolCalls } = extractToolCallsFromText(rawText);

      const t = message.info?.tokens;
      return {
        text,
        ...(toolCalls && { toolCalls }),
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

  async *streamContent(params: GenerateParams): AsyncGenerator<string, void, unknown> {
    const response = await this.generateContent(params);
    if (response.text) yield response.text;
  }

  /**
   * Streaming chat with tool-use orchestration. OpenCode's session API is
   * one-shot request/response, so streaming here means: each round's full
   * assistant text is emitted as a single `text_delta` event, then a
   * `done` event closes the iterable.
   *
   * Function calling is implemented through the prompt: a tool description
   * block is appended to the system prompt, and the model is instructed to
   * emit `<tool_call>{...}</tool_call>` blocks. Each round, the adapter
   * extracts those, dispatches via `ctx.onToolCall`, appends the result
   * to the conversation, and sends the next message.
   */
  async *chatWithTools(
    params: GenerateParams,
    ctx: ChatToolContext,
  ): AsyncIterable<ChatEvent> {
    const model = this.resolveModel(params.model);
    if (!model) {
      throw new Error(`OpenCode adapter cannot resolve model "${params.model}"`);
    }

    // Prefer native OpenAI-style function calling (reliable on every free Zen
    // model). Falls back to the legacy <tool_call> prompt protocol below if no
    // Bearer api-key is configured or the first native request fails.
    if (this.credential.type === "api" && this.credential.apiKey && !this.basicAuth) {
      try {
        const events = await this.collectNativeToolChat(params, ctx, model);
        for (const ev of events) yield ev;
        return;
      } catch (e) {
        if (!(e instanceof NativeUnsupportedError)) throw e;
        // fall through to the legacy prompt protocol
      }
    }

    const maxRounds = ctx.maxToolRounds ?? 5;
    const toolBlock = buildOpenCodeToolBlock(params.tools);
    const systemInstruction = toolBlock
      ? `${params.systemInstruction ?? ""}\n\n---\n${toolBlock}`
      : params.systemInstruction;

    const transcript = serializeHistory(params.history ?? []);
    let conversation = transcript
      ? `${transcript}\n\nUser: ${params.prompt}`
      : `User: ${params.prompt}`;

    const session = await this.createSession(model);
    let aggregated = "";

    try {
      for (let round = 0; round < maxRounds; round += 1) {
        const isFirst = round === 0;
        const callParams: GenerateParams = {
          ...params,
          prompt: isFirst ? conversation : conversation + "\n\nAssistant:",
          systemInstruction,
          // Images only on the first round (subsequent rounds replay text only).
          ...(isFirst ? {} : { images: undefined }),
        };
        const message = await this.sendMessage(session.id, callParams, model);
        const rawText = (message.parts ?? [])
          .filter((p): p is OpenCodeTextPart => p.type === "text" && !p.synthetic)
          .map((p) => p.text)
          .join("");
        const { text, toolCalls } = extractToolCallsFromText(rawText);

        if (text) {
          aggregated += text;
          yield { type: "text_delta", delta: text };
        }

        if (!toolCalls || toolCalls.length === 0) {
          const usage = message.info?.tokens
            ? {
                promptTokens: message.info.tokens.input ?? 0,
                completionTokens:
                  (message.info.tokens.output ?? 0) + (message.info.tokens.reasoning ?? 0),
                totalTokens:
                  (message.info.tokens.input ?? 0) +
                  (message.info.tokens.output ?? 0) +
                  (message.info.tokens.reasoning ?? 0),
              }
            : null;
          if (usage) yield { type: "usage", usage };
          yield { type: "done", fullText: aggregated };
          return;
        }

        // Round produced one or more tool calls — dispatch them, append the
        // results to the running conversation, and loop.
        const toolResults: string[] = [];
        for (const call of toolCalls) {
          yield { type: "tool_call", id: call.id, name: call.name, args: call.args };
          const result = ctx.onToolCall ? await ctx.onToolCall(call) : "";
          toolResults.push(`[Tool "${call.name}" result]: ${result}`);
        }

        const assistantTurn = text ? text : "(calling tool)";
        conversation = `${conversation}\n\nAssistant: ${assistantTurn}\n${toolResults.join("\n")}`;
      }

      throw new MaxToolRoundsExceededError(maxRounds, maxRounds);
    } finally {
      this.deleteSession(session.id);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Native OpenAI-compatible function calling against `nativeToolsURL`. Collects
   * all ChatEvents; throws NativeUnsupportedError if the FIRST request fails so
   * chatWithTools() can fall back to the prompt protocol without double-running
   * any tool.
   */
  private async collectNativeToolChat(
    params: GenerateParams,
    ctx: ChatToolContext,
    model: OpenCodeModelRef,
  ): Promise<ChatEvent[]> {
    const cred = this.credential;
    if (cred.type !== "api" || !cred.apiKey) {
      throw new NativeUnsupportedError("no api-key credential for native tool calling");
    }
    const apiKey = cred.apiKey;
    const events: ChatEvent[] = [];
    const messages = buildNativeMessages(params);
    const tools = toNativeTools(params.tools);
    const maxRounds = ctx.maxToolRounds ?? 5;
    let aggregated = "";

    for (let round = 0; round <= maxRounds; round += 1) {
      const body: Record<string, unknown> = { model: model.id, messages };
      if (tools) {
        body.tools = tools;
        body.tool_choice = "auto";
      }
      let res: Response;
      try {
        res = await fetch(this.nativeToolsURL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (round === 0) throw new NativeUnsupportedError((e as Error).message);
        throw e;
      }
      if (!res.ok) {
        const errText = await res.text();
        if (round === 0) throw new NativeUnsupportedError(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
        events.push({ type: "text_delta", delta: `\n[tool step failed: HTTP ${res.status}]` });
        break;
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: OAINativeToolCall[] } }>;
      };
      const message = data.choices?.[0]?.message;
      const rawCalls = message?.tool_calls ?? [];

      if (rawCalls.length === 0) {
        const content = (message?.content ?? "").trim();
        if (content) {
          aggregated += content;
          events.push({ type: "text_delta", delta: content });
        }
        break;
      }

      messages.push({ role: "assistant", content: message?.content ?? null, tool_calls: rawCalls });
      for (const rc of rawCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(rc.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        const call: ToolCall = { id: rc.id, name: rc.function.name, args };
        events.push({ type: "tool_call", id: call.id, name: call.name, args: call.args });
        const result = ctx.onToolCall ? await ctx.onToolCall(call) : "";
        messages.push({ role: "tool", tool_call_id: rc.id, content: result });
      }
    }

    events.push({ type: "done", fullText: aggregated });
    return events;
  }

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
      body: JSON.stringify({ title: this.title, agent: this.agent, model: modelToSessionPayload(model, this.variant) }),
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
