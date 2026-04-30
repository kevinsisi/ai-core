"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var client_exports = {};
__export(client_exports, {
  GeminiClient: () => GeminiClient,
  MultiProviderClient: () => MultiProviderClient,
  StreamInterruptedError: () => StreamInterruptedError,
  toGeminiTools: () => toGeminiTools,
  toOpenAITools: () => toOpenAITools
});
module.exports = __toCommonJS(client_exports);

// src/client/gemini-client.ts
var import_node_fs = require("fs");
var import_generative_ai = require("@google/generative-ai");

// src/retry/classify-error.ts
function shapeError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const status = err?.["status"] ?? err?.["httpStatusCode"] ?? 0;
  return { message, lower: message.toLowerCase(), status };
}
function classifyGeminiError(err) {
  const { lower, status } = shapeError(err);
  if (status === 401 || lower.includes("unauthenticated")) {
    return "auth";
  }
  if (status === 400 || status === 403 || lower.includes("api_key_invalid") || lower.includes("permission denied") || lower.includes("suspended") || lower.includes("consumer_suspended") || lower.includes("invalid argument") || lower.includes("invalid_argument")) {
    return "fatal";
  }
  if (status === 429 || lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("rate_limit") || lower.includes("rate limit") || lower.includes("ratelimitexceeded")) {
    if (lower.includes("quota") || lower.includes("resource_exhausted")) {
      return "quota";
    }
    return "rate-limit";
  }
  if (status >= 500 || lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("fetch failed") || lower.includes("network") || lower.includes("503") || lower.includes("500") || lower.includes("unavailable") || lower.includes("internal server")) {
    return "network";
  }
  return "unknown";
}
var classifyError = classifyGeminiError;

// src/retry/types.ts
var MaxRetriesExceededError = class extends Error {
  attempts;
  lastError;
  constructor(attempts, lastError) {
    const inner = lastError instanceof Error ? lastError.message : String(lastError);
    super(`Max retries exceeded after ${attempts} attempt(s): ${inner}`);
    this.name = "MaxRetriesExceededError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
};

// src/key-pool/types.ts
var NoAvailableKeyError = class extends Error {
  constructor(message = "No available API keys in pool") {
    super(message);
    this.name = "NoAvailableKeyError";
  }
};

// src/retry/with-retry.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRetry(fn, initialKey, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const classify = options.classifyError ?? classifyError;
  const initialBackoff = options.initialBackoffMs ?? 1e3;
  const maxBackoff = options.maxBackoffMs ?? 3e4;
  let currentKey = initialKey;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(currentKey);
    } catch (err) {
      lastError = err;
      const errorClass = classify(err);
      options.onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        errorClass,
        error: err
      });
      if (attempt >= maxRetries) break;
      switch (errorClass) {
        case "quota":
        case "rate-limit": {
          if (!options.rotateKey) {
            throw err;
          }
          try {
            currentKey = await options.rotateKey();
            options.onRetry?.({
              attempt: attempt + 1,
              maxRetries,
              errorClass,
              error: err,
              newKey: currentKey
            });
          } catch (rotateErr) {
            if (rotateErr instanceof NoAvailableKeyError) {
              throw rotateErr;
            }
            throw rotateErr;
          }
          break;
        }
        case "network": {
          const backoff = Math.min(
            initialBackoff * Math.pow(2, attempt),
            maxBackoff
          );
          await sleep(backoff);
          break;
        }
        case "auth":
        case "fatal":
        case "unknown":
          throw err;
      }
    }
  }
  throw new MaxRetriesExceededError(maxRetries + 1, lastError);
}

// src/client/tool-conversion.ts
function toGeminiTools(tools) {
  if (!tools || tools.length === 0) return void 0;
  const functionDeclarations = [];
  const passThrough = [];
  for (const tool of tools) {
    if (tool.type === "function") {
      functionDeclarations.push({
        name: tool.name,
        ...tool.description !== void 0 && { description: tool.description },
        ...tool.parameters !== void 0 && { parameters: tool.parameters }
      });
    } else if (tool.type === "provider-native" && tool.provider === "gemini") {
      passThrough.push(tool.config);
    }
  }
  const result = [];
  if (functionDeclarations.length > 0) {
    result.push({ functionDeclarations });
  }
  result.push(...passThrough);
  return result.length > 0 ? result : void 0;
}
function toOpenAITools(tools, nativeToolProvider = "openai") {
  if (!tools || tools.length === 0) return void 0;
  const result = [];
  for (const tool of tools) {
    if (tool.type === "function") {
      result.push({
        type: "function",
        function: {
          name: tool.name,
          ...tool.description !== void 0 && { description: tool.description },
          ...tool.parameters !== void 0 && { parameters: tool.parameters }
        }
      });
    } else if (tool.type === "provider-native" && tool.provider === nativeToolProvider) {
      result.push(tool.config);
    }
  }
  return result.length > 0 ? result : void 0;
}

// src/client/types.ts
var StreamInterruptedError = class extends Error {
  chunksReceived;
  constructor(chunksReceived, cause) {
    const inner = cause instanceof Error ? cause.message : String(cause ?? "unknown");
    super(
      `Stream interrupted after ${chunksReceived} chunk(s): ${inner}`
    );
    this.name = "StreamInterruptedError";
    this.chunksReceived = chunksReceived;
  }
};

// src/client/gemini-client.ts
function extractUsage(response) {
  const meta = response.usageMetadata;
  if (!meta) return null;
  return {
    promptTokens: meta.promptTokenCount ?? 0,
    completionTokens: meta.candidatesTokenCount ?? 0,
    totalTokens: meta.totalTokenCount ?? 0
  };
}
function buildHistory(history) {
  return history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.parts }]
  }));
}
function buildParts(prompt, images) {
  const parts = [{ text: prompt }];
  for (const image of images ?? []) {
    if (image.type === "inline") {
      parts.push({
        inlineData: { mimeType: image.mimeType, data: image.data }
      });
    } else {
      const data = (0, import_node_fs.readFileSync)(image.filePath).toString("base64");
      parts.push({
        inlineData: { mimeType: image.mimeType, data }
      });
    }
  }
  return parts;
}
var GeminiClient = class {
  pool;
  maxRetries;
  constructor(pool, options = {}) {
    this.pool = pool;
    this.maxRetries = options.maxRetries ?? 3;
  }
  startLeaseHeartbeat(apiKey) {
    let leaseError = null;
    const intervalMs = Math.max(
      250,
      Math.min(6e4, Math.floor(this.pool.getAllocationLeaseMs() / 2))
    );
    const timer = setInterval(() => {
      this.pool.renewLease(apiKey).then((renewed) => {
        if (!renewed) {
          leaseError = new Error(`Lost key lease for ${apiKey}`);
          clearInterval(timer);
        }
      }).catch((error) => {
        leaseError = error instanceof Error ? error : new Error(String(error));
        clearInterval(timer);
      });
    }, intervalMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    return {
      stop: () => clearInterval(timer),
      getError: () => leaseError
    };
  }
  /**
   * Generate content (non-streaming).
   * Automatically allocates a key, calls Gemini, releases the key.
   */
  async generateContent(params) {
    const [initialKey] = await this.pool.allocate(1);
    let currentKey = initialKey;
    let failed = false;
    let authFailure = false;
    let heartbeatKey = initialKey;
    let heartbeat = this.startLeaseHeartbeat(initialKey);
    try {
      const response = await withRetry(
        async (apiKey) => {
          currentKey = apiKey;
          if (apiKey !== heartbeatKey) {
            heartbeat.stop();
            heartbeat = this.startLeaseHeartbeat(apiKey);
            heartbeatKey = apiKey;
          }
          const genai = new import_generative_ai.GoogleGenerativeAI(apiKey);
          const geminiTools = toGeminiTools(params.tools);
          const model = genai.getGenerativeModel({
            model: params.model,
            ...params.systemInstruction && {
              systemInstruction: params.systemInstruction
            },
            ...geminiTools && { tools: geminiTools },
            ...params.maxOutputTokens && {
              generationConfig: { maxOutputTokens: params.maxOutputTokens }
            }
          });
          const content = params.images?.length ? buildParts(params.prompt, params.images) : params.prompt;
          if (params.history && params.history.length > 0) {
            const chat = model.startChat({
              history: buildHistory(params.history)
            });
            const result = await chat.sendMessage(params.prompt);
            const leaseError = heartbeat.getError();
            if (leaseError) throw leaseError;
            return result.response;
          } else {
            const result = await model.generateContent(content);
            const leaseError = heartbeat.getError();
            if (leaseError) throw leaseError;
            return result.response;
          }
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
            if (info.errorClass === "fatal") {
              authFailure = true;
            }
          }
        }
      );
      const text = response.text();
      const usage = extractUsage(response);
      return { text, usage };
    } catch (err) {
      failed = true;
      if (err instanceof Error && (err.message.includes("fatal") || err.message.includes("401") || err.message.includes("403"))) {
        authFailure = true;
      }
      throw err;
    } finally {
      heartbeat.stop();
      if (failed && currentKey !== initialKey) {
        await this.pool.release(currentKey, true, authFailure).catch(() => {
        });
      } else if (!failed) {
        await this.pool.release(currentKey, false).catch(() => {
        });
      } else {
        await this.pool.release(currentKey, true, authFailure).catch(() => {
        });
      }
    }
  }
  /**
   * Generate content as a stream.
   * Yields text chunks as they arrive.
   *
   * @throws StreamInterruptedError if the stream is interrupted mid-way.
   */
  async *streamContent(params) {
    const [key] = await this.pool.allocate(1);
    let chunksReceived = 0;
    let failed = false;
    const heartbeat = this.startLeaseHeartbeat(key);
    try {
      const genai = new import_generative_ai.GoogleGenerativeAI(key);
      const geminiTools = toGeminiTools(params.tools);
      const model = genai.getGenerativeModel({
        model: params.model,
        ...params.systemInstruction && {
          systemInstruction: params.systemInstruction
        },
        ...geminiTools && { tools: geminiTools }
      });
      const content = params.images?.length ? buildParts(params.prompt, params.images) : params.prompt;
      const result = await model.generateContentStream(content);
      for await (const chunk of result.stream) {
        const leaseError = heartbeat.getError();
        if (leaseError) {
          failed = true;
          throw new StreamInterruptedError(chunksReceived, leaseError);
        }
        const text = chunk.text();
        if (text) {
          chunksReceived++;
          yield text;
        }
      }
    } catch (err) {
      failed = true;
      if (err instanceof StreamInterruptedError) {
        throw err;
      }
      throw new StreamInterruptedError(chunksReceived, err);
    } finally {
      heartbeat.stop();
      await this.pool.release(key, failed).catch(() => {
      });
    }
  }
};

// src/provider/schema.ts
var ProviderID = {
  Gemini: "gemini",
  OpenAI: "openai",
  OpenRouter: "openrouter"
};

// src/provider/models.ts
var geminiModels = [
  {
    id: "gemini-2.5-flash",
    provider: ProviderID.Gemini,
    name: "Gemini 2.5 Flash",
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: false
    },
    contextWindow: 1e6,
    outputLimit: 65536,
    costTier: "low"
  }
];
var openAIModels = [
  {
    id: "gpt-4.1-mini",
    provider: ProviderID.OpenAI,
    name: "GPT-4.1 mini",
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: false,
      multimodalInput: false,
      multimodalOutput: false
    },
    contextWindow: 1e6,
    outputLimit: 32768,
    costTier: "medium"
  }
];
var openRouterModels = [
  {
    id: "openrouter/auto",
    provider: ProviderID.OpenRouter,
    name: "OpenRouter Auto",
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: false,
      multimodalInput: false,
      multimodalOutput: false
    },
    contextWindow: 128e3,
    outputLimit: 32768,
    costTier: "medium"
  }
];
var builtInProviders = [
  {
    id: ProviderID.OpenAI,
    name: "OpenAI",
    authTypes: ["api"],
    models: openAIModels
  },
  {
    id: ProviderID.Gemini,
    name: "Gemini",
    authTypes: ["pool"],
    models: geminiModels
  },
  {
    id: ProviderID.OpenRouter,
    name: "OpenRouter",
    authTypes: ["api"],
    models: openRouterModels
  }
];
var defaultProviderPriority = [ProviderID.OpenAI, ProviderID.Gemini];

// src/provider/router.ts
function credentialRef(adapter) {
  const label = adapter.credential.credentialLabel;
  if (label && label.trim() !== "") return label;
  if (adapter.credential.type === "api") {
    const suffix = adapter.credential.apiKey.slice(-4);
    return `api:${suffix}`;
  }
  if (adapter.credential.type === "oauth") {
    return "oauth";
  }
  return "pool";
}
function matchesCapabilities(model, required) {
  if (!required) return true;
  return Object.entries(required).every(([key, value]) => {
    if (typeof value !== "boolean") return true;
    return model.capabilities[key] === value;
  });
}
var ProviderRouter = class {
  constructor(adapters) {
    this.adapters = adapters;
  }
  adapters;
  select(policy = {}) {
    return this.selectAdapter(policy).selection;
  }
  /**
   * Select an adapter and execute generateContent against it.
   *
   * If the caller did not set `policy.preferredModel`, `params.model` is used
   * as the model preference so the routing target matches the explicit request.
   *
   * No silent provider/model fallback: when the resolved selection picks a
   * different model than the caller asked for, the policy must have opted in
   * via `allowCrossProviderFallback` / `allowCrossModelFallback`.
   */
  async execute(params, policy = {}) {
    const effectivePolicy = {
      ...policy,
      preferredModel: policy.preferredModel ?? params.model
    };
    const { adapter, selection } = this.selectAdapter(effectivePolicy);
    const response = await adapter.generateContent({ ...params, model: selection.model });
    return { selection, response };
  }
  /**
   * Mirror of execute() for streaming. Selection runs eagerly so the caller
   * can inspect which provider/model resolved before iterating the stream.
   */
  executeStream(params, policy = {}) {
    const effectivePolicy = {
      ...policy,
      preferredModel: policy.preferredModel ?? params.model,
      requiredCapabilities: { streaming: true, ...policy.requiredCapabilities ?? {} }
    };
    const { adapter, selection } = this.selectAdapter(effectivePolicy);
    const stream = adapter.streamContent({ ...params, model: selection.model });
    return { selection, stream };
  }
  selectAdapter(policy) {
    const preferredProviders = policy.preferredProviders ?? [...defaultProviderPriority];
    const orderedProviders = [
      ...preferredProviders,
      ...(policy.allowCrossProviderFallback ? policy.fallbackProviders : []) ?? []
    ];
    const seen = /* @__PURE__ */ new Set();
    const uniqueProviders = orderedProviders.filter((providerID) => {
      if (seen.has(providerID)) return false;
      seen.add(providerID);
      return true;
    });
    for (const providerID of uniqueProviders) {
      const providerAdapters = this.adapters.filter((item) => item.provider.id === providerID);
      if (providerAdapters.length === 0) continue;
      const adaptersToTry = policy.allowSameProviderCredentialFallback ? providerAdapters : providerAdapters.slice(0, 1);
      for (const adapter of adaptersToTry) {
        if (policy.preferredModel) {
          const model = adapter.getModel(policy.preferredModel);
          if (model && matchesCapabilities(model, policy.requiredCapabilities)) {
            return {
              adapter,
              selection: {
                provider: providerID,
                model: model.id,
                credentialType: adapter.credential.type,
                credentialRef: credentialRef(adapter)
              }
            };
          }
          if (!policy.allowCrossModelFallback) {
            continue;
          }
        }
        const models = adapter.provider.models.filter(
          (model) => adapter.supports(model.id) && matchesCapabilities(model, policy.requiredCapabilities)
        );
        if (models.length === 0) {
          continue;
        }
        return {
          adapter,
          selection: {
            provider: providerID,
            model: models[0].id,
            credentialType: adapter.credential.type,
            credentialRef: credentialRef(adapter)
          }
        };
      }
    }
    throw new Error("No provider/model combination matches the routing policy");
  }
};

// src/client/multi-provider-client.ts
var MultiProviderClient = class {
  router;
  defaultPolicy;
  onSelect;
  constructor(options) {
    this.router = new ProviderRouter(options.adapters);
    this.defaultPolicy = options.defaultPolicy ?? {};
    this.onSelect = options.onSelect;
  }
  mergePolicy(policy) {
    if (!policy) return this.defaultPolicy;
    return { ...this.defaultPolicy, ...policy };
  }
  async generateContent(params, policy) {
    const { selection, response } = await this.router.execute(
      params,
      this.mergePolicy(policy)
    );
    this.onSelect?.(selection, params);
    return response;
  }
  async *streamContent(params, policy) {
    const { selection, stream } = this.router.executeStream(
      params,
      this.mergePolicy(policy)
    );
    this.onSelect?.(selection, params);
    yield* stream;
  }
  /**
   * Escape hatch for callers that need the routing selection alongside the
   * response (e.g. cost attribution, A/B telemetry).
   */
  generateWithSelection(params, policy) {
    return this.router.execute(params, this.mergePolicy(policy));
  }
  streamWithSelection(params, policy) {
    return this.router.executeStream(params, this.mergePolicy(policy));
  }
  getRouter() {
    return this.router;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GeminiClient,
  MultiProviderClient,
  StreamInterruptedError,
  toGeminiTools,
  toOpenAITools
});
//# sourceMappingURL=index.cjs.map