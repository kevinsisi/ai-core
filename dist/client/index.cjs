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
  CapabilityNotSupportedError: () => CapabilityNotSupportedError,
  GeminiClient: () => GeminiClient,
  MaxToolRoundsExceededError: () => MaxToolRoundsExceededError,
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
var CapabilityNotSupportedError = class extends Error {
  constructor(provider, capability) {
    super(`${provider} does not support capability ${capability}`);
    this.name = "CapabilityNotSupportedError";
  }
};
var MaxToolRoundsExceededError = class extends Error {
  constructor(roundsCompleted, cap) {
    super(`Tool-call loop exceeded ${cap} rounds (completed ${roundsCompleted})`);
    this.roundsCompleted = roundsCompleted;
    this.cap = cap;
    this.name = "MaxToolRoundsExceededError";
  }
  roundsCompleted;
  cap;
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
function extractToolCalls(response) {
  const calls = [];
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const call = part.functionCall;
      if (!call?.name) continue;
      calls.push({
        id: `gemini-call-${calls.length + 1}`,
        name: call.name,
        args: call.args ? { ...call.args } : {}
      });
    }
  }
  return calls.length > 0 ? calls : void 0;
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
      const toolCalls = extractToolCalls(response);
      return { text, usage, ...toolCalls && { toolCalls } };
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
  OpenCode: "opencode",
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
  },
  {
    id: "gemini-3-pro-image-preview",
    provider: ProviderID.Gemini,
    name: "Gemini 3 Pro Image Preview",
    capabilities: {
      streaming: false,
      tools: false,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: true,
      imageOutput: true
    },
    costTier: "high"
  },
  {
    id: "gemini-2.5-flash-image",
    provider: ProviderID.Gemini,
    name: "Gemini 2.5 Flash Image",
    capabilities: {
      streaming: false,
      tools: false,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: true,
      imageOutput: true
    },
    costTier: "medium"
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
var openCodeModels = [
  {
    id: "opencode/deepseek-v4-flash-free",
    provider: ProviderID.OpenCode,
    name: "OpenCode DeepSeek V4 Flash Free",
    capabilities: {
      streaming: false,
      tools: false,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: false
    },
    costTier: "low"
  }
];
var builtInProviders = [
  {
    id: ProviderID.OpenCode,
    name: "OpenCode",
    authTypes: ["api", "oauth", "pool"],
    models: openCodeModels
  },
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
var defaultProviderPriority = [ProviderID.OpenCode, ProviderID.Gemini, ProviderID.OpenAI];
function getBuiltInModel(modelID) {
  for (const provider of builtInProviders) {
    const model = provider.models.find((item) => item.id === modelID);
    if (model) return model;
  }
  return void 0;
}

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
function supportsRequiredMethod(adapter, method) {
  if (!method) return true;
  const fn = adapter[method];
  return typeof fn === "function";
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
    const candidates = this.selectAdapterCandidates(effectivePolicy);
    let lastError;
    for (let index = 0; index < candidates.length; index += 1) {
      const { adapter, selection } = candidates[index];
      try {
        const response = await adapter.generateContent({ ...params, model: selection.model });
        return { selection, response };
      } catch (err) {
        lastError = err;
        if (!this.canTryNextCandidate(candidates, index, effectivePolicy)) {
          throw err;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Provider execution failed");
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
  executeChatWithTools(params, ctx, policy = {}) {
    const effectivePolicy = {
      ...policy,
      preferredModel: policy.preferredModel ?? params.model,
      requiredCapabilities: { tools: true, ...policy.requiredCapabilities ?? {} },
      requiredMethod: "chatWithTools"
    };
    const { adapter, selection } = this.selectAdapter(effectivePolicy);
    if (!adapter.chatWithTools) {
      throw new CapabilityNotSupportedError(selection.provider, "chatWithTools");
    }
    const stream = adapter.chatWithTools({ ...params, model: selection.model }, ctx);
    return { selection, stream };
  }
  async executeImageGen(params, policy = {}) {
    const effectivePolicy = {
      ...policy,
      preferredModel: policy.preferredModel ?? params.model,
      requiredCapabilities: { imageOutput: true, ...policy.requiredCapabilities ?? {} },
      requiredMethod: "imageGen"
    };
    const candidates = this.selectAdapterCandidates(effectivePolicy);
    let lastError;
    for (let index = 0; index < candidates.length; index += 1) {
      const { adapter, selection } = candidates[index];
      if (!adapter.imageGen) {
        lastError = new CapabilityNotSupportedError(selection.provider, "imageGen");
        continue;
      }
      try {
        const response = await adapter.imageGen({ ...params, model: selection.model });
        return { selection, response };
      } catch (err) {
        lastError = err;
        if (!this.canTryNextCandidate(candidates, index, effectivePolicy)) {
          throw err;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new CapabilityNotSupportedError("provider", "imageGen");
  }
  selectAdapter(policy) {
    const [candidate] = this.selectAdapterCandidates(policy);
    if (!candidate) {
      throw new Error("No provider/model combination matches the routing policy");
    }
    return candidate;
  }
  selectAdapterCandidates(policy) {
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
    const preferredBuiltInModel = policy.preferredModel ? getBuiltInModel(policy.preferredModel) : void 0;
    for (const providerID of uniqueProviders) {
      if (preferredBuiltInModel && preferredBuiltInModel.provider !== providerID && !policy.allowCrossProviderFallback) {
        continue;
      }
      const providerAdapters = this.adapters.filter((item) => item.provider.id === providerID).filter((item) => supportsRequiredMethod(item, policy.requiredMethod));
      if (providerAdapters.length === 0) continue;
      const adaptersToTry = policy.allowSameProviderCredentialFallback ? providerAdapters : providerAdapters.slice(0, 1);
      for (const adapter of adaptersToTry) {
        if (policy.preferredModel) {
          const model = adapter.getModel(policy.preferredModel);
          if (model && matchesCapabilities(model, policy.requiredCapabilities)) {
            const candidate2 = {
              adapter,
              selection: {
                provider: providerID,
                model: model.id,
                credentialType: adapter.credential.type,
                credentialRef: credentialRef(adapter)
              }
            };
            if (!policy.allowCrossProviderFallback && !policy.allowSameProviderCredentialFallback) {
              return [candidate2];
            }
            return [
              candidate2,
              ...this.selectFallbackCandidates(policy, uniqueProviders, providerID, adapter)
            ];
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
        const candidate = {
          adapter,
          selection: {
            provider: providerID,
            model: models[0].id,
            credentialType: adapter.credential.type,
            credentialRef: credentialRef(adapter)
          }
        };
        if (!policy.allowCrossProviderFallback && !policy.allowSameProviderCredentialFallback) {
          return [candidate];
        }
        return [
          candidate,
          ...this.selectFallbackCandidates(policy, uniqueProviders, providerID, adapter)
        ];
      }
    }
    throw new Error("No provider/model combination matches the routing policy");
  }
  selectFallbackCandidates(policy, orderedProviders, selectedProviderID, selectedAdapter) {
    const candidates = [];
    for (const providerID of orderedProviders) {
      const providerChanged = providerID !== selectedProviderID;
      if (providerChanged && !policy.allowCrossProviderFallback) continue;
      const providerAdapters = this.adapters.filter((item) => item.provider.id === providerID).filter((item) => supportsRequiredMethod(item, policy.requiredMethod));
      const adaptersToTry = policy.allowSameProviderCredentialFallback ? providerAdapters : providerAdapters.slice(0, 1);
      for (const adapter of adaptersToTry) {
        if (adapter === selectedAdapter) continue;
        if (!providerChanged && !policy.allowSameProviderCredentialFallback) continue;
        const model = policy.preferredModel ? adapter.getModel(policy.preferredModel) : void 0;
        if (model && matchesCapabilities(model, policy.requiredCapabilities)) {
          candidates.push({
            adapter,
            selection: {
              provider: providerID,
              model: model.id,
              credentialType: adapter.credential.type,
              credentialRef: credentialRef(adapter)
            }
          });
          continue;
        }
        if (policy.preferredModel && !policy.allowCrossModelFallback) continue;
        const [fallbackModel] = adapter.provider.models.filter(
          (item) => adapter.supports(item.id) && matchesCapabilities(item, policy.requiredCapabilities)
        );
        if (!fallbackModel) continue;
        candidates.push({
          adapter,
          selection: {
            provider: providerID,
            model: fallbackModel.id,
            credentialType: adapter.credential.type,
            credentialRef: credentialRef(adapter)
          }
        });
      }
    }
    return candidates;
  }
  canTryNextCandidate(candidates, currentIndex, policy) {
    const current = candidates[currentIndex];
    const next = candidates[currentIndex + 1];
    if (!current || !next) return false;
    if (current.selection.provider !== next.selection.provider) {
      return policy.allowCrossProviderFallback === true;
    }
    return policy.allowSameProviderCredentialFallback === true;
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
  /**
   * Image generation. Routed to the first chain provider whose adapter
   * implements `imageGen`; throws `CapabilityNotSupportedError` when no
   * candidate supports it.
   *
   * The provider-specific options bag (`params.options`) is passed through
   * verbatim — Gemini honors `{ fallbackModel, dedicatedKey }`; other
   * adapters ignore.
   */
  async imageGen(params, policy) {
    const { selection, response } = await this.router.executeImageGen(
      params,
      this.mergePolicy(policy)
    );
    this.onSelect?.(selection, { model: params.model, prompt: params.prompt });
    return response;
  }
  imageGenWithSelection(params, policy) {
    return this.router.executeImageGen(params, this.mergePolicy(policy));
  }
  /**
   * Streaming chat with provider-specific function-call loop. Provider is
   * selected once at the start of the call; mid-loop provider fallback is
   * not supported (chat state lives inside the adapter's session).
   *
   * Caller supplies `ctx.onToolCall` to execute tools the model invokes;
   * the adapter feeds results back into the next round. The loop is capped
   * by `ctx.maxToolRounds` (default 5).
   */
  async *chatWithTools(params, ctx, policy) {
    const { selection, stream } = this.router.executeChatWithTools(
      params,
      ctx,
      this.mergePolicy(policy)
    );
    this.onSelect?.(selection, params);
    yield* stream;
  }
  chatWithToolsAndSelection(params, ctx, policy) {
    return this.router.executeChatWithTools(params, ctx, this.mergePolicy(policy));
  }
  getRouter() {
    return this.router;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CapabilityNotSupportedError,
  GeminiClient,
  MaxToolRoundsExceededError,
  MultiProviderClient,
  StreamInterruptedError,
  toGeminiTools,
  toOpenAITools
});
//# sourceMappingURL=index.cjs.map