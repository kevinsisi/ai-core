import {
  GeminiClient,
  MaxToolRoundsExceededError,
  StreamInterruptedError,
  buildParts,
  getBuiltInModel,
  getBuiltInProvider,
  toGeminiTools,
  toOpenAITools
} from "./chunk-G7YCA5WR.js";
import {
  withRetry
} from "./chunk-YUQCRD55.js";
import {
  ProviderID
} from "./chunk-NIHYAC7Q.js";

// src/provider/adapters/gemini.ts
import { randomUUID } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
function isLikelyGeminiModel(modelID) {
  return /^gemini-/i.test(modelID);
}
function synthesizeGeminiModel(modelID) {
  return {
    id: modelID,
    provider: ProviderID.Gemini,
    name: modelID,
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: false
    }
  };
}
function isModelNotFoundError(message) {
  const lower = message.toLowerCase();
  return lower.includes("not found") || lower.includes("404") || lower.includes("not supported") || lower.includes("invalid model") || lower.includes("model") && lower.includes("does not exist");
}
function extractUsageFromResponse(response) {
  const meta = response.usageMetadata;
  if (!meta) return null;
  return {
    promptTokens: meta.promptTokenCount ?? 0,
    completionTokens: meta.candidatesTokenCount ?? 0,
    totalTokens: meta.totalTokenCount ?? 0
  };
}
async function callGeminiImageGen(apiKey, modelID, params) {
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: modelID });
  const parts = [];
  for (const image of params.referenceImages ?? []) {
    if (image.type === "inline") {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    } else {
      throw new Error(
        "GeminiProviderAdapter.imageGen: FileImagePart not yet supported; pass InlineImagePart with base64 data instead"
      );
    }
  }
  parts.push({ text: params.prompt });
  const resp = await model.generateContent({
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
  });
  const respParts = resp.response.candidates?.[0]?.content?.parts ?? [];
  const images = respParts.filter(
    (p) => Boolean(p.inlineData?.data && p.inlineData.mimeType)
  ).map((p) => ({ mimeType: p.inlineData.mimeType, data: p.inlineData.data }));
  if (images.length === 0) {
    throw new Error("Gemini image generation returned no image part");
  }
  const text = respParts.filter((p) => typeof p.text === "string").map((p) => p.text).join("");
  return {
    images,
    text: text || void 0,
    usage: extractUsageFromResponse(resp.response)
  };
}
async function runGeminiChatLoop(apiKey, params, ctx, push, maxRounds) {
  const genai = new GoogleGenerativeAI(apiKey);
  const tools = toGeminiTools(params.tools);
  const model = genai.getGenerativeModel({
    model: params.model,
    ...params.systemInstruction && { systemInstruction: params.systemInstruction },
    ...tools && { tools }
  });
  const history = (params.history ?? []).map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.parts }]
  }));
  const chat = model.startChat({ history });
  const initialParts = params.images?.length ? buildParts(params.prompt, params.images) : [{ text: params.prompt }];
  let fullText = "";
  let result = await chat.sendMessageStream(initialParts);
  let round = 0;
  while (true) {
    let sawToolCall = false;
    const functionResponses = [];
    for await (const chunk of result.stream) {
      const calls = chunk.functionCalls();
      if (calls && calls.length > 0) {
        sawToolCall = true;
        for (const fc of calls) {
          const id = randomUUID();
          const args = fc.args ?? {};
          push({ type: "tool_call", id, name: fc.name, args });
          const toolResult = ctx.onToolCall ? await ctx.onToolCall({ id, name: fc.name, args }) : "";
          functionResponses.push({
            functionResponse: { name: fc.name, response: { result: toolResult } }
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
    if (!fullText) {
      try {
        const fb = (await result.response).text();
        if (fb) {
          fullText = fb;
          push({ type: "text_delta", delta: fb });
        }
      } catch {
      }
    }
    break;
  }
  const response = await result.response;
  const usage = extractUsageFromResponse(response);
  if (usage) push({ type: "usage", usage });
  push({ type: "done", fullText });
}
async function* runGeminiChatWithTools(pool, maxRetries, params, ctx) {
  const queue = [];
  let resolveNext = null;
  let runError = null;
  let runDone = false;
  const push = (ev) => {
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
          }
        }
      );
    } catch (err) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("fatal") || message.includes("401") || message.includes("403")) {
        authFailure = true;
      }
      throw err;
    } finally {
      await pool.release(currentKey, failed, authFailure).catch(() => {
      });
    }
  })();
  driver.catch((err) => {
    runError = err;
  }).finally(() => {
    runDone = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  });
  while (true) {
    if (queue.length > 0) {
      yield queue.shift();
      continue;
    }
    if (runDone) {
      if (runError) throw runError;
      return;
    }
    await new Promise((r) => {
      resolveNext = r;
    });
  }
}
var GeminiProviderAdapter = class {
  provider = getBuiltInProvider("gemini");
  credential;
  client;
  pool;
  maxRetries;
  constructor(pool, maxRetries = 3) {
    this.credential = { type: "pool", provider: "gemini", credentialLabel: "gemini-pool" };
    this.client = new GeminiClient(pool, { maxRetries });
    this.pool = pool;
    this.maxRetries = maxRetries;
  }
  supports(modelID) {
    if (this.provider.models.some((model) => model.id === modelID)) return true;
    return isLikelyGeminiModel(modelID);
  }
  getModel(modelID) {
    const builtIn = getBuiltInModel(modelID);
    if (builtIn && builtIn.provider === this.provider.id) return builtIn;
    if (isLikelyGeminiModel(modelID)) return synthesizeGeminiModel(modelID);
    return void 0;
  }
  async generateContent(params) {
    return this.client.generateContent(params);
  }
  streamContent(params) {
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
  chatWithTools(params, ctx) {
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
  async imageGen(params) {
    const options = params.options ?? {};
    const candidateModels = [params.model];
    if (options.fallbackModel) candidateModels.push(options.fallbackModel);
    let lastError;
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
    throw lastError instanceof Error ? lastError : new Error("Gemini image generation: all candidate models failed");
  }
  async executeWithPool(modelID, params) {
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
          }
        }
      );
    } catch (err) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("fatal") || message.includes("401") || message.includes("403")) {
        authFailure = true;
      }
      throw err;
    } finally {
      await this.pool.release(currentKey, failed, authFailure).catch(() => {
      });
    }
  }
};

// src/provider/adapters/openai-compatible.ts
function parseToolArgs(value) {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return { raw: value };
  }
}
function extractToolCalls(response) {
  const calls = response.choices?.[0]?.message?.tool_calls ?? [];
  const mapped = calls.flatMap((call, index) => {
    const name = call.function?.name;
    if (!name) return [];
    return [{
      id: call.id ?? `openai-call-${index + 1}`,
      name,
      args: parseToolArgs(call.function?.arguments)
    }];
  });
  return mapped.length > 0 ? mapped : void 0;
}
function toOpenAIMessages(params) {
  const messages = [];
  if (params.systemInstruction) {
    messages.push({ role: "system", content: params.systemInstruction });
  }
  for (const message of params.history ?? []) {
    messages.push({
      role: message.role === "model" ? "assistant" : message.role,
      content: message.parts
    });
  }
  messages.push({ role: "user", content: params.prompt });
  return messages;
}
var OpenAICompatibleAdapter = class {
  credential;
  constructor(credential) {
    this.credential = credential;
  }
  supports(modelID) {
    return this.provider.models.some((model) => model.id === modelID);
  }
  getModel(modelID) {
    const model = this.provider.models.find((item) => item.id === modelID);
    return model;
  }
  get bearerToken() {
    return this.credential.type === "oauth" ? this.credential.accessToken : this.credential.apiKey;
  }
  buildHeaders() {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      "Content-Type": "application/json"
    };
  }
  get baseURL() {
    return this.credential.baseURL ?? this.defaultBaseURL;
  }
  buildRequestBody(params, stream) {
    const model = params.model || this.provider.models[0].id;
    const tools = toOpenAITools(params.tools, this.nativeToolProvider);
    return {
      model,
      messages: toOpenAIMessages(params),
      ...tools && { tools },
      ...params.maxOutputTokens && { max_tokens: params.maxOutputTokens },
      ...stream && { stream: true }
    };
  }
  async generateContent(params) {
    if (params.images?.length) {
      throw new Error(
        `${this.provider.name} adapter does not support multimodal input yet`
      );
    }
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildRequestBody(params, false))
    });
    if (!response.ok) {
      const text2 = await response.text();
      const error = new Error(
        text2 || `${this.provider.name} request failed with status ${response.status}`
      );
      error.status = response.status;
      throw error;
    }
    const json = await response.json();
    const firstContent = json.choices?.[0]?.message?.content;
    const text = Array.isArray(firstContent) ? firstContent.map((item) => item.text || "").join("") : firstContent ?? "";
    const toolCalls = extractToolCalls(json);
    return {
      text,
      ...toolCalls && { toolCalls },
      usage: json.usage ? {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
        totalTokens: json.usage.total_tokens ?? 0
      } : null
    };
  }
  async *streamContent(params) {
    if (params.images?.length) {
      throw new Error(
        `${this.provider.name} adapter does not support multimodal input yet`
      );
    }
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: { ...this.buildHeaders(), Accept: "text/event-stream" },
      body: JSON.stringify(this.buildRequestBody(params, true))
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(
        text || `${this.provider.name} stream request failed with status ${response.status}`
      );
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
        let newlineIndex;
        while ((newlineIndex = buffered.indexOf("\n")) !== -1) {
          const rawLine = buffered.slice(0, newlineIndex).replace(/\r$/, "");
          buffered = buffered.slice(newlineIndex + 1);
          if (!rawLine.startsWith("data:")) continue;
          const payload = rawLine.slice(5).trim();
          if (payload === "" || payload === "[DONE]") continue;
          let parsed;
          try {
            parsed = JSON.parse(payload);
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
};

// src/provider/adapters/openai.ts
function isLikelyOpenAIModel(modelID) {
  return /^gpt-/i.test(modelID) || /^o[134]([.\-]|$)/i.test(modelID) || /^chatgpt-/i.test(modelID);
}
var REASONING_FAMILIES = /^o[134]([.\-]|$)/i;
function synthesizeOpenAIModel(modelID) {
  return {
    id: modelID,
    provider: ProviderID.OpenAI,
    name: modelID,
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: REASONING_FAMILIES.test(modelID),
      multimodalInput: false,
      multimodalOutput: false
    }
  };
}
var OpenAIProviderAdapter = class extends OpenAICompatibleAdapter {
  provider = getBuiltInProvider("openai");
  defaultBaseURL = "https://api.openai.com/v1";
  nativeToolProvider = "openai";
  constructor(credential) {
    super(credential);
  }
  supports(modelID) {
    return super.supports(modelID) || isLikelyOpenAIModel(modelID);
  }
  getModel(modelID) {
    return super.getModel(modelID) ?? (isLikelyOpenAIModel(modelID) ? synthesizeOpenAIModel(modelID) : void 0);
  }
  buildHeaders() {
    const headers = super.buildHeaders();
    if (this.credential.type === "api" && this.credential.organization) {
      headers["OpenAI-Organization"] = this.credential.organization;
    }
    return headers;
  }
};

// src/provider/adapters/opencode.ts
import { readFile } from "fs/promises";
function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
function modelToID(model) {
  return `${model.providerID}/${model.id}`;
}
function modelToPayload(model) {
  return { modelID: model.id, providerID: model.providerID };
}
function parseModelRef(modelID, defaultProviderID) {
  const sep = modelID.indexOf("/");
  if (sep > 0 && sep < modelID.length - 1) {
    return { providerID: modelID.slice(0, sep), id: modelID.slice(sep + 1) };
  }
  const builtInModel = getBuiltInModel(modelID);
  if (builtInModel && builtInModel.provider !== "opencode") return void 0;
  return { providerID: defaultProviderID, id: modelID };
}
function synthesizeModel(model) {
  return {
    id: modelToID(model),
    provider: "opencode",
    name: modelToID(model),
    capabilities: {
      streaming: true,
      tools: false,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: false
    }
  };
}
function parseToolCallJson(value, index) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
    const payload = parsed;
    const name = typeof payload.name === "string" ? payload.name : void 0;
    if (!name) return void 0;
    const rawArgs = payload.args ?? payload.arguments;
    const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};
    return {
      id: typeof payload.id === "string" ? payload.id : `opencode-call-${index + 1}`,
      name,
      args
    };
  } catch {
    return void 0;
  }
}
function extractToolCallsFromText(text) {
  const toolCalls = [];
  let matched = false;
  const stripped = text.replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (_match, payload) => {
    matched = true;
    const call = parseToolCallJson(payload.trim(), toolCalls.length);
    if (call) toolCalls.push(call);
    return "";
  });
  if (!matched) return { text };
  return { text: stripped, ...toolCalls.length > 0 && { toolCalls } };
}
function isFunctionTool(tool) {
  return tool.type === "function";
}
function buildOpenCodeToolBlock(tools) {
  const functions = (tools ?? []).filter(isFunctionTool);
  if (functions.length === 0) return "";
  const lines = [
    "You have access to the following tools. To call a tool, embed this exact block in your response:",
    "",
    '<tool_call>{"name":"TOOL_NAME","args":{...}}</tool_call>',
    "",
    "Only call one tool at a time. After seeing the tool result, continue your response.",
    "",
    "Available tools:"
  ];
  for (const tool of functions) {
    const params = tool.parameters ?? {};
    const required = params.required ?? [];
    const propLines = Object.entries(params.properties ?? {}).map(
      ([k, v]) => `    - ${k}${required.includes(k) ? " (required)" : ""}: ${v?.description ?? ""}`
    ).join("\n");
    lines.push(`
- ${tool.name}: ${tool.description ?? ""}${propLines ? "\n" + propLines : ""}`);
  }
  return lines.join("\n");
}
function serializeHistory(history) {
  return history.map((msg) => `${msg.role === "model" ? "Assistant" : "User"}: ${msg.parts}`).join("\n\n");
}
async function imagePartToOpenCode(image) {
  if (image.type === "inline") {
    return {
      type: "file",
      mime: image.mimeType,
      url: `data:${image.mimeType};base64,${image.data}`
    };
  }
  const buf = await readFile(image.filePath);
  return {
    type: "file",
    mime: image.mimeType,
    url: `data:${image.mimeType};base64,${buf.toString("base64")}`,
    filename: image.filePath.split(/[\\/]/).pop()
  };
}
var OpenCodeProviderAdapter = class {
  provider;
  credential;
  baseURL;
  agent;
  title;
  defaultModel;
  basicAuth;
  constructor(credential, options) {
    this.credential = credential;
    this.defaultModel = options.defaultModel;
    this.baseURL = trimTrailingSlash(
      options.baseURL ?? ("baseURL" in credential ? credential.baseURL : void 0) ?? "http://127.0.0.1:4096"
    );
    this.agent = options.agent ?? "general";
    this.title = options.title ?? "ai-core opencode session";
    this.basicAuth = options.basicAuth ?? false;
    this.provider = {
      id: "opencode",
      name: "OpenCode",
      authTypes: ["api", "oauth", "pool"],
      models: [synthesizeModel(options.defaultModel)]
    };
  }
  supports(modelID) {
    return Boolean(this.resolveModel(modelID));
  }
  getModel(modelID) {
    const model = this.resolveModel(modelID);
    return model ? synthesizeModel(model) : void 0;
  }
  async generateContent(params) {
    const model = this.resolveModel(params.model);
    if (!model) {
      throw new Error(`OpenCode adapter cannot resolve model "${params.model}"`);
    }
    const session = await this.createSession(model);
    try {
      const message = await this.sendMessage(session.id, params, model);
      const rawText = (message.parts ?? []).filter((p) => p.type === "text" && !p.synthetic).map((p) => p.text).join("");
      const { text, toolCalls } = extractToolCallsFromText(rawText);
      const t = message.info?.tokens;
      return {
        text,
        ...toolCalls && { toolCalls },
        usage: t ? {
          promptTokens: t.input ?? 0,
          completionTokens: (t.output ?? 0) + (t.reasoning ?? 0),
          totalTokens: (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0)
        } : null
      };
    } finally {
      this.deleteSession(session.id);
    }
  }
  async *streamContent(params) {
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
  async *chatWithTools(params, ctx) {
    const model = this.resolveModel(params.model);
    if (!model) {
      throw new Error(`OpenCode adapter cannot resolve model "${params.model}"`);
    }
    const maxRounds = ctx.maxToolRounds ?? 5;
    const toolBlock = buildOpenCodeToolBlock(params.tools);
    const systemInstruction = toolBlock ? `${params.systemInstruction ?? ""}

---
${toolBlock}` : params.systemInstruction;
    const transcript = serializeHistory(params.history ?? []);
    let conversation = transcript ? `${transcript}

User: ${params.prompt}` : `User: ${params.prompt}`;
    const session = await this.createSession(model);
    let aggregated = "";
    try {
      for (let round = 0; round < maxRounds; round += 1) {
        const isFirst = round === 0;
        const callParams = {
          ...params,
          prompt: isFirst ? conversation : conversation + "\n\nAssistant:",
          systemInstruction,
          // Images only on the first round (subsequent rounds replay text only).
          ...isFirst ? {} : { images: void 0 }
        };
        const message = await this.sendMessage(session.id, callParams, model);
        const rawText = (message.parts ?? []).filter((p) => p.type === "text" && !p.synthetic).map((p) => p.text).join("");
        const { text, toolCalls } = extractToolCallsFromText(rawText);
        if (text) {
          aggregated += text;
          yield { type: "text_delta", delta: text };
        }
        if (!toolCalls || toolCalls.length === 0) {
          const usage = message.info?.tokens ? {
            promptTokens: message.info.tokens.input ?? 0,
            completionTokens: (message.info.tokens.output ?? 0) + (message.info.tokens.reasoning ?? 0),
            totalTokens: (message.info.tokens.input ?? 0) + (message.info.tokens.output ?? 0) + (message.info.tokens.reasoning ?? 0)
          } : null;
          if (usage) yield { type: "usage", usage };
          yield { type: "done", fullText: aggregated };
          return;
        }
        const toolResults = [];
        for (const call of toolCalls) {
          yield { type: "tool_call", id: call.id, name: call.name, args: call.args };
          const result = ctx.onToolCall ? await ctx.onToolCall(call) : "";
          toolResults.push(`[Tool "${call.name}" result]: ${result}`);
        }
        const assistantTurn = text ? text : "(calling tool)";
        conversation = `${conversation}

Assistant: ${assistantTurn}
${toolResults.join("\n")}`;
      }
      throw new MaxToolRoundsExceededError(maxRounds, maxRounds);
    } finally {
      this.deleteSession(session.id);
    }
  }
  // ── Private helpers ──────────────────────────────────────────────────────
  resolveModel(modelID) {
    const model = parseModelRef(modelID, this.defaultModel.providerID);
    if (!model?.id || !model.providerID) return void 0;
    return model;
  }
  buildHeaders() {
    const headers = { "Content-Type": "application/json" };
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
  async createSession(model) {
    const response = await fetch(`${this.baseURL}/session`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ title: this.title, agent: this.agent, model: modelToPayload(model) })
    });
    const json = await this.readJson(response, "create session");
    if (!json.id) throw new Error("OpenCode create session response missing id");
    return { id: json.id };
  }
  async sendMessage(sessionID, params, model) {
    const parts = [];
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
          ...params.systemInstruction && { system: params.systemInstruction },
          parts
        })
      }
    );
    return this.readJson(response, "send message");
  }
  deleteSession(sessionID) {
    fetch(`${this.baseURL}/session/${encodeURIComponent(sessionID)}`, {
      method: "DELETE",
      headers: this.buildHeaders()
    }).catch((err) => {
      console.warn(`[opencode] deleteSession ${sessionID} failed:`, err);
    });
  }
  async readJson(response, operation) {
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(
        text || `OpenCode ${operation} failed with HTTP ${response.status}`
      );
      error.status = response.status;
      throw error;
    }
    return await response.json();
  }
};

// src/provider/adapters/openrouter.ts
var OpenRouterProviderAdapter = class extends OpenAICompatibleAdapter {
  provider;
  defaultBaseURL = "https://openrouter.ai/api/v1";
  nativeToolProvider = "openrouter";
  referer;
  appTitle;
  constructor(credential, options = {}) {
    super(credential);
    const base = getBuiltInProvider("openrouter");
    this.provider = options.additionalModels?.length ? { ...base, models: [...base.models, ...options.additionalModels] } : base;
    this.referer = options.referer;
    this.appTitle = options.appTitle;
  }
  buildHeaders() {
    return {
      ...super.buildHeaders(),
      ...this.referer && { "HTTP-Referer": this.referer },
      ...this.appTitle && { "X-Title": this.appTitle }
    };
  }
};

export {
  GeminiProviderAdapter,
  OpenAICompatibleAdapter,
  OpenAIProviderAdapter,
  OpenCodeProviderAdapter,
  OpenRouterProviderAdapter
};
//# sourceMappingURL=chunk-5HBWSMHC.js.map