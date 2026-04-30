"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/provider/index.ts
var provider_exports = {};
__export(provider_exports, {
  GeminiProviderAdapter: () => GeminiProviderAdapter,
  OpenAICompatibleAdapter: () => OpenAICompatibleAdapter,
  OpenAIOAuthError: () => OpenAIOAuthError,
  OpenAIProviderAdapter: () => OpenAIProviderAdapter,
  OpenRouterProviderAdapter: () => OpenRouterProviderAdapter,
  ProviderID: () => ProviderID,
  ProviderRouter: () => ProviderRouter,
  builtInProviders: () => builtInProviders,
  clearRegisteredProviders: () => clearRegisteredProviders,
  defaultProviderPriority: () => defaultProviderPriority,
  getBuiltInModel: () => getBuiltInModel,
  getBuiltInProvider: () => getBuiltInProvider,
  getModel: () => getModel,
  getProvider: () => getProvider,
  isOAuthCredentialExpired: () => isOAuthCredentialExpired,
  listRegisteredProviders: () => listRegisteredProviders,
  refreshOpenAIToken: () => refreshOpenAIToken,
  registerProvider: () => registerProvider,
  startOpenAIAuth: () => startOpenAIAuth,
  unregisterProvider: () => unregisterProvider
});
module.exports = __toCommonJS(provider_exports);

// src/provider/schema.ts
var ProviderID = {
  Gemini: "gemini",
  OpenAI: "openai",
  OpenRouter: "openrouter"
};

// src/provider/auth/types.ts
function isOAuthCredentialExpired(credential, leewayMs = 6e4) {
  if (!credential.expiresAt) return false;
  const exp = Date.parse(credential.expiresAt);
  if (Number.isNaN(exp)) return false;
  return Date.now() + leewayMs >= exp;
}

// src/provider/auth/openai.ts
var import_node_child_process = require("child_process");
var crypto = __toESM(require("crypto"), 1);
var http = __toESM(require("http"), 1);
var CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
var ISSUER = "https://auth.openai.com";
var DEFAULT_PORT = 1455;
var REDIRECT_PATH = "/auth/callback";
var SCOPE = "openid profile email offline_access";
async function startOpenAIAuth(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`;
  const pkce = generatePKCE();
  const state = crypto.randomBytes(32).toString("base64url");
  const authorizeURL = buildAuthorizeURL({
    redirectUri,
    challenge: pkce.challenge,
    state,
    originator: options.originator ?? "ai-core"
  });
  options.onAuthorizeURL?.(authorizeURL);
  const callbackPromise = waitForCallback({
    port,
    expectedState: state,
    signal: options.signal
  });
  if (!options.manualOpen) {
    openBrowser(authorizeURL);
  }
  const code = await callbackPromise;
  return exchangeCodeForToken({
    code,
    verifier: pkce.verifier,
    redirectUri,
    label: options.label
  });
}
async function refreshOpenAIToken(refreshToken, options = {}) {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OpenAIOAuthError(
      `OpenAI OAuth refresh failed (${response.status})`,
      response.status,
      text
    );
  }
  const json = await response.json();
  return tokenResponseToCredential(json, options.label, refreshToken);
}
var OpenAIOAuthError = class extends Error {
  status;
  body;
  constructor(message, status, body) {
    super(message);
    this.name = "OpenAIOAuthError";
    this.status = status;
    this.body = body;
  }
};
function tokenResponseToCredential(json, label, fallbackRefreshToken) {
  const credential = {
    type: "oauth",
    provider: ProviderID.OpenAI,
    accessToken: json.access_token
  };
  const refreshToken = json.refresh_token ?? fallbackRefreshToken;
  if (refreshToken) credential.refreshToken = refreshToken;
  if (typeof json.expires_in === "number") {
    credential.expiresAt = new Date(Date.now() + json.expires_in * 1e3).toISOString();
  }
  if (label) credential.credentialLabel = label;
  return credential;
}
function buildAuthorizeURL(opts) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: opts.redirectUri,
    scope: SCOPE,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: opts.state,
    originator: opts.originator
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}
async function exchangeCodeForToken(opts) {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: CLIENT_ID,
      code_verifier: opts.verifier
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OpenAIOAuthError(
      `OpenAI OAuth token exchange failed (${response.status})`,
      response.status,
      text
    );
  }
  const json = await response.json();
  return tokenResponseToCredential(json, opts.label);
}
function generatePKCE() {
  const allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.randomBytes(43);
  let verifier = "";
  for (let i = 0; i < 43; i++) {
    verifier += allowed[bytes[i] % allowed.length];
  }
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
function waitForCallback(opts) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      if (error) {
        const message = errorDescription ? `${error}: ${errorDescription}` : error;
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage("Authorization failed", escapeHTML(message)));
        finish(() => {
          server.close();
          reject(new OpenAIOAuthError(`OpenAI OAuth authorization failed: ${message}`));
        });
        return;
      }
      if (!code || !state || state !== opts.expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage("Invalid callback", "Missing or mismatched state."));
        finish(() => {
          server.close();
          reject(new OpenAIOAuthError("OpenAI OAuth callback missing or invalid state/code"));
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
        callbackPage(
          "Authorization complete",
          "You can close this tab and return to the CLI."
        )
      );
      finish(() => {
        server.close();
        resolve(code);
      });
    });
    server.on("error", (err) => {
      finish(() => reject(err));
    });
    server.listen(opts.port, "127.0.0.1");
    if (opts.signal) {
      const onAbort = () => {
        finish(() => {
          server.close();
          reject(new OpenAIOAuthError("OpenAI OAuth flow aborted"));
        });
      };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
function callbackPage(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHTML(
    title
  )}</title><body style="font-family:system-ui;padding:2rem"><h1>${escapeHTML(
    title
  )}</h1><p>${body}</p></body>`;
}
function escapeHTML(s) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c] ?? c
  );
}
function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      (0, import_node_child_process.spawn)("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: true
      }).unref();
    } else if (platform === "darwin") {
      (0, import_node_child_process.spawn)("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      (0, import_node_child_process.spawn)("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
  }
}

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
function getBuiltInProvider(providerID) {
  return builtInProviders.find((provider) => provider.id === providerID);
}
function getBuiltInModel(modelID) {
  for (const provider of builtInProviders) {
    const model = provider.models.find((item) => item.id === modelID);
    if (model) return model;
  }
  return void 0;
}
var customProviders = /* @__PURE__ */ new Map();
function registerProvider(definition) {
  if (getBuiltInProvider(definition.id)) {
    throw new Error(
      `Cannot re-register built-in provider id "${definition.id}". Use a distinct id for custom providers.`
    );
  }
  customProviders.set(definition.id, definition);
}
function unregisterProvider(providerID) {
  return customProviders.delete(providerID);
}
function clearRegisteredProviders() {
  customProviders.clear();
}
function getProvider(providerID) {
  return getBuiltInProvider(providerID) ?? customProviders.get(providerID);
}
function getModel(modelID) {
  const builtIn = getBuiltInModel(modelID);
  if (builtIn) return builtIn;
  for (const provider of customProviders.values()) {
    const model = provider.models.find((item) => item.id === modelID);
    if (model) return model;
  }
  return void 0;
}
function listRegisteredProviders() {
  return [...builtInProviders, ...customProviders.values()];
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

// src/provider/adapters/gemini.ts
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
var GeminiProviderAdapter = class {
  provider = getBuiltInProvider("gemini");
  credential;
  client;
  constructor(pool, maxRetries = 3) {
    this.credential = { type: "pool", provider: "gemini", credentialLabel: "gemini-pool" };
    this.client = new GeminiClient(pool, { maxRetries });
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
};

// src/provider/adapters/openai-compatible.ts
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
    return {
      text,
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GeminiProviderAdapter,
  OpenAICompatibleAdapter,
  OpenAIOAuthError,
  OpenAIProviderAdapter,
  OpenRouterProviderAdapter,
  ProviderID,
  ProviderRouter,
  builtInProviders,
  clearRegisteredProviders,
  defaultProviderPriority,
  getBuiltInModel,
  getBuiltInProvider,
  getModel,
  getProvider,
  isOAuthCredentialExpired,
  listRegisteredProviders,
  refreshOpenAIToken,
  registerProvider,
  startOpenAIAuth,
  unregisterProvider
});
//# sourceMappingURL=index.cjs.map