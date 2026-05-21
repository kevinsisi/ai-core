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
  OpenCodeProviderAdapter: () => OpenCodeProviderAdapter,
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
  OpenCode: "opencode",
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

// src/provider/adapters/gemini.ts
var import_node_crypto = require("crypto");
var import_generative_ai2 = require("@google/generative-ai");

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
  const genai = new import_generative_ai2.GoogleGenerativeAI(apiKey);
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
  const genai = new import_generative_ai2.GoogleGenerativeAI(apiKey);
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
          const id = (0, import_node_crypto.randomUUID)();
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
function extractToolCalls2(response) {
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
    const toolCalls = extractToolCalls2(json);
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
var import_promises = require("fs/promises");
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
      streaming: false,
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
  const buf = await (0, import_promises.readFile)(image.filePath);
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
  async *streamContent(_params) {
    throw new Error(
      "OpenCodeProviderAdapter does not support streaming. Use generateContent instead."
    );
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GeminiProviderAdapter,
  OpenAICompatibleAdapter,
  OpenAIOAuthError,
  OpenAIProviderAdapter,
  OpenCodeProviderAdapter,
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