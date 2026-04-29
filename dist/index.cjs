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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AgentRuntime: () => AgentRuntime,
  GeminiClient: () => GeminiClient,
  GeminiProviderAdapter: () => GeminiProviderAdapter,
  KeyPool: () => KeyPool,
  LeaseHeartbeat: () => LeaseHeartbeat,
  MaxRetriesExceededError: () => MaxRetriesExceededError,
  NoAvailableKeyError: () => NoAvailableKeyError,
  OpenAICompatibleAdapter: () => OpenAICompatibleAdapter,
  OpenAIProviderAdapter: () => OpenAIProviderAdapter,
  OpenRouterProviderAdapter: () => OpenRouterProviderAdapter,
  ProviderID: () => ProviderID,
  ProviderRouter: () => ProviderRouter,
  SqliteAdapter: () => SqliteAdapter,
  StepRunner: () => StepRunner,
  StreamInterruptedError: () => StreamInterruptedError,
  builtInProviders: () => builtInProviders,
  classifyError: () => classifyError,
  classifyGeminiError: () => classifyGeminiError,
  classifyOpenAIError: () => classifyOpenAIError,
  clearRegisteredProviders: () => clearRegisteredProviders,
  defaultProviderPriority: () => defaultProviderPriority,
  getBuiltInModel: () => getBuiltInModel,
  getBuiltInProvider: () => getBuiltInProvider,
  getModel: () => getModel,
  getProvider: () => getProvider,
  getProviderClassifier: () => getProviderClassifier,
  listRegisteredProviders: () => listRegisteredProviders,
  planPreferredKeys: () => planPreferredKeys,
  registerProvider: () => registerProvider,
  registerProviderClassifier: () => registerProviderClassifier,
  toGeminiTools: () => toGeminiTools,
  toOpenAITools: () => toOpenAITools,
  unregisterProvider: () => unregisterProvider,
  unregisterProviderClassifier: () => unregisterProviderClassifier,
  withRetry: () => withRetry
});
module.exports = __toCommonJS(index_exports);

// src/key-pool/types.ts
var NoAvailableKeyError = class extends Error {
  constructor(message = "No available API keys in pool") {
    super(message);
    this.name = "NoAvailableKeyError";
  }
};

// src/key-pool/key-pool.ts
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
var KeyPool = class {
  adapter;
  defaultCooldownMs;
  authCooldownMs;
  allocationLeaseMs;
  /** In-memory cache; reloaded on first use or after invalidation */
  cache = null;
  /** Active allocations in the current process; fewer is better. */
  inFlight = /* @__PURE__ */ new Map();
  /** Last allocation timestamp to avoid repeatedly hammering the same key. */
  lastAllocatedAt = /* @__PURE__ */ new Map();
  /** Lease token held by this process for each allocated key. */
  leaseTokens = /* @__PURE__ */ new Map();
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    this.defaultCooldownMs = options.defaultCooldownMs ?? 6e4;
    this.authCooldownMs = options.authCooldownMs ?? 30 * 6e4;
    this.allocationLeaseMs = options.allocationLeaseMs ?? 5 * 6e4;
  }
  // ── Internal helpers ───────────────────────────────────────────────
  async getKeys(forceReload = false) {
    if (!this.cache || forceReload) {
      this.cache = await this.adapter.getKeys();
    }
    return this.cache;
  }
  availableKeys(keys) {
    const now = Date.now();
    return keys.filter(
      (k) => k.isActive && k.cooldownUntil <= now && k.leaseUntil <= now && (this.inFlight.get(k.key) ?? 0) === 0
    );
  }
  findByKey(keys, key) {
    return keys.find((k) => k.key === key);
  }
  rankAvailable(keys) {
    const grouped = /* @__PURE__ */ new Map();
    for (const key of keys) {
      const inFlight = this.inFlight.get(key.key) ?? 0;
      const lastAllocatedAt = this.lastAllocatedAt.get(key.key) ?? 0;
      const rankKey = `${inFlight}:${key.usageCount}:${lastAllocatedAt}`;
      const group = grouped.get(rankKey);
      if (group) {
        group.push(key);
      } else {
        grouped.set(rankKey, [key]);
      }
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => {
      const [aInFlight, aUsage, aLast] = a.split(":").map(Number);
      const [bInFlight, bUsage, bLast] = b.split(":").map(Number);
      if (aInFlight !== bInFlight) return aInFlight - bInFlight;
      if (aUsage !== bUsage) return aUsage - bUsage;
      return aLast - bLast;
    }).flatMap(([, group]) => shuffle(group));
  }
  async clearLease(key) {
    const keys = await this.getKeys(true);
    const record = this.findByKey(keys, key);
    if (!record) {
      this.releaseLocalTracking(key);
      return;
    }
    const expectedLeaseToken = this.leaseTokens.get(key);
    if (!expectedLeaseToken || record.leaseToken !== expectedLeaseToken) {
      this.releaseLocalTracking(key);
      return;
    }
    record.leaseUntil = 0;
    record.leaseToken = null;
    try {
      await this.adapter.updateKey(record, expectedLeaseToken);
    } finally {
      this.releaseLocalTracking(key);
    }
  }
  releaseLocalTracking(key) {
    this.leaseTokens.delete(key);
    const inFlight = this.inFlight.get(key) ?? 0;
    if (inFlight <= 1) {
      this.inFlight.delete(key);
    } else {
      this.inFlight.set(key, inFlight - 1);
    }
  }
  // ── Public API ─────────────────────────────────────────────────────
  /**
   * Allocate a single key, preferring the specified key when it is healthy and leasable.
   * Falls back to the normal ranked allocation order when the preferred key cannot be used.
   */
  async allocatePreferred(preferredKey, options = {}) {
    const keys = await this.getKeys(true);
    const available = this.availableKeys(keys);
    if (available.length === 0) {
      throw new NoAvailableKeyError();
    }
    const ranked = this.rankAvailable(available);
    const allowFallback = options.allowFallback ?? true;
    const ordered = preferredKey ? allowFallback ? [
      ...ranked.filter((key) => key.key === preferredKey),
      ...ranked.filter((key) => key.key !== preferredKey)
    ] : ranked.filter((key) => key.key === preferredKey) : ranked;
    const now = Date.now();
    for (const selected of ordered) {
      const leaseUntil = now + this.allocationLeaseMs;
      const leaseToken = `${selected.id}:${leaseUntil}:${Math.random().toString(36).slice(2)}`;
      const acquired = await this.adapter.acquireLease(
        selected.id,
        leaseUntil,
        leaseToken,
        now
      );
      if (!acquired) continue;
      selected.leaseUntil = leaseUntil;
      selected.leaseToken = leaseToken;
      const key = selected.key;
      this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
      this.lastAllocatedAt.set(key, now);
      this.leaseTokens.set(key, leaseToken);
      return {
        key,
        usedPreferred: Boolean(preferredKey) && key === preferredKey
      };
    }
    throw new NoAvailableKeyError(
      preferredKey && !allowFallback ? `Preferred key could not be leased: ${preferredKey}` : "No preferred or fallback key could be leased"
    );
  }
  /**
   * Allocate up to `count` available keys using load-aware ranking.
   * Throws NoAvailableKeyError if zero keys are available or the request
   * asks for more keys than are currently available.
   */
  async allocate(count) {
    const keys = await this.getKeys(true);
    const available = this.availableKeys(keys);
    if (available.length === 0) {
      throw new NoAvailableKeyError();
    }
    if (count > available.length) {
      throw new NoAvailableKeyError(
        `Requested ${count} key(s), but only ${available.length} available in pool`
      );
    }
    const ranked = this.rankAvailable(available);
    const now = Date.now();
    const result = [];
    for (const selected of ranked) {
      if (result.length >= count) break;
      const leaseUntil = now + this.allocationLeaseMs;
      const leaseToken = `${selected.id}:${leaseUntil}:${Math.random().toString(36).slice(2)}`;
      const acquired = await this.adapter.acquireLease(
        selected.id,
        leaseUntil,
        leaseToken,
        now
      );
      if (!acquired) continue;
      selected.leaseUntil = leaseUntil;
      selected.leaseToken = leaseToken;
      const key = selected.key;
      result.push(key);
      this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
      this.lastAllocatedAt.set(key, now + result.length - 1);
      this.leaseTokens.set(key, leaseToken);
    }
    if (result.length !== count) {
      for (const key of result) {
        await this.clearLease(key);
      }
      throw new NoAvailableKeyError(
        `Requested ${count} key(s), but only ${result.length} could be leased`
      );
    }
    return result;
  }
  /**
   * Release a key after use.
   * @param key - The API key string
   * @param failed - If true, sets cooldown; if false, increments usageCount
   * @param authFailure - If true, uses longer auth cooldown (default: false)
   */
  async release(key, failed, authFailure = false) {
    const keys = await this.getKeys(true);
    const record = this.findByKey(keys, key);
    if (!record) {
      this.releaseLocalTracking(key);
      return;
    }
    const expectedLeaseToken = this.leaseTokens.get(key);
    if (!expectedLeaseToken) {
      this.releaseLocalTracking(key);
      return;
    }
    if (expectedLeaseToken && record.leaseToken !== expectedLeaseToken) {
      this.releaseLocalTracking(key);
      return;
    }
    if (failed) {
      const duration = authFailure ? this.authCooldownMs : this.defaultCooldownMs;
      record.cooldownUntil = Date.now() + duration;
    } else {
      record.usageCount += 1;
    }
    record.leaseUntil = 0;
    record.leaseToken = null;
    try {
      await this.adapter.updateKey(record, expectedLeaseToken);
    } finally {
      this.releaseLocalTracking(key);
    }
  }
  getAllocationLeaseMs() {
    return this.allocationLeaseMs;
  }
  async renewLease(key) {
    const keys = await this.getKeys(true);
    const record = this.findByKey(keys, key);
    const leaseToken = this.leaseTokens.get(key);
    if (!record || !leaseToken || record.leaseToken !== leaseToken) {
      this.leaseTokens.delete(key);
      return false;
    }
    const leaseUntil = Date.now() + this.allocationLeaseMs;
    const renewed = await this.adapter.renewLease(
      record.id,
      leaseUntil,
      leaseToken,
      Date.now()
    );
    if (!renewed) {
      this.leaseTokens.delete(key);
      return false;
    }
    record.leaseUntil = leaseUntil;
    return true;
  }
  async releaseLease(key) {
    await this.clearLease(key);
  }
  /**
   * Permanently deactivate a key (e.g., suspended by Google).
   */
  async block(key) {
    const keys = await this.getKeys(true);
    const record = this.findByKey(keys, key);
    if (!record) return;
    record.isActive = false;
    await this.adapter.updateKey(record, record.leaseToken);
  }
  /**
   * Force-reload keys from storage on next allocate().
   */
  invalidate() {
    this.cache = null;
  }
  /**
   * Return all keys with current status (for diagnostics / admin UI).
   */
  async status() {
    return this.getKeys(true);
  }
};

// src/key-pool/sqlite-adapter.ts
var SqliteAdapter = class {
  db;
  leaseColumnsReady = null;
  constructor(db) {
    this.db = db;
  }
  /** Create the api_keys table if it doesn't exist */
  static createTable(db) {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        key           TEXT    NOT NULL UNIQUE,
        is_active     INTEGER NOT NULL DEFAULT 1,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        lease_until   INTEGER NOT NULL DEFAULT 0,
        lease_token   TEXT,
        usage_count   INTEGER NOT NULL DEFAULT 0
      )
    `).run();
    try {
      db.prepare(
        "ALTER TABLE api_keys ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0"
      ).run();
    } catch {
    }
    try {
      db.prepare("ALTER TABLE api_keys ADD COLUMN lease_token TEXT").run();
    } catch {
    }
  }
  ensureLeaseColumns() {
    if (this.leaseColumnsReady === true) return true;
    try {
      const columns = this.db.prepare("PRAGMA table_info(api_keys)").all();
      const hasLeaseUntil = columns.some((column) => column.name === "lease_until");
      const hasLeaseToken = columns.some((column) => column.name === "lease_token");
      if (!hasLeaseUntil) {
        this.db.prepare(
          "ALTER TABLE api_keys ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0"
        ).run();
      }
      if (!hasLeaseToken) {
        this.db.prepare("ALTER TABLE api_keys ADD COLUMN lease_token TEXT").run();
      }
      this.leaseColumnsReady = true;
      return true;
    } catch (error) {
      this.leaseColumnsReady = null;
      throw new Error(
        `ai-core key pool requires lease_until and lease_token columns: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async getKeys() {
    this.ensureLeaseColumns();
    const rows = this.db.prepare(
      "SELECT id, key, is_active, cooldown_until, lease_until, lease_token, usage_count FROM api_keys"
    ).all();
    return rows.map(rowToApiKey);
  }
  async acquireLease(keyId, leaseUntil, leaseToken, now) {
    this.ensureLeaseColumns();
    const result = this.db.prepare(
      `UPDATE api_keys
         SET lease_until = ?, lease_token = ?
         WHERE id = ? AND is_active = 1 AND cooldown_until <= ? AND lease_until <= ?`
    ).run(leaseUntil, leaseToken, keyId, now, now);
    return (result.changes ?? 0) > 0;
  }
  async renewLease(keyId, leaseUntil, leaseToken, now) {
    this.ensureLeaseColumns();
    const result = this.db.prepare(
      `UPDATE api_keys
         SET lease_until = ?
         WHERE id = ? AND lease_token = ? AND lease_until > ?`
    ).run(leaseUntil, keyId, leaseToken, now);
    return (result.changes ?? 0) > 0;
  }
  async updateKey(key, expectedLeaseToken) {
    this.ensureLeaseColumns();
    if (expectedLeaseToken === void 0) {
      this.db.prepare(
        `UPDATE api_keys
           SET is_active = ?, cooldown_until = ?, lease_until = ?, lease_token = ?, usage_count = ?
           WHERE id = ?`
      ).run(
        key.isActive ? 1 : 0,
        key.cooldownUntil,
        key.leaseUntil,
        key.leaseToken,
        key.usageCount,
        key.id
      );
      return;
    }
    this.db.prepare(
      `UPDATE api_keys
         SET is_active = ?, cooldown_until = ?, lease_until = ?, lease_token = ?, usage_count = ?
         WHERE id = ? AND ((? IS NULL AND lease_token IS NULL) OR lease_token = ?)`
    ).run(
      key.isActive ? 1 : 0,
      key.cooldownUntil,
      key.leaseUntil,
      key.leaseToken,
      key.usageCount,
      key.id,
      expectedLeaseToken,
      expectedLeaseToken
    );
  }
  /** Insert a new key (convenience helper). */
  insertKey(key) {
    this.db.prepare(
      "INSERT OR IGNORE INTO api_keys (key) VALUES (?)"
    ).run(key);
  }
};
function rowToApiKey(row) {
  return {
    id: row.id,
    key: row.key,
    isActive: row.is_active === 1,
    cooldownUntil: row.cooldown_until,
    leaseUntil: row.lease_until ?? 0,
    leaseToken: row.lease_token ?? null,
    usageCount: row.usage_count
  };
}

// src/retry/classify-error.ts
function shapeError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const status = err?.["status"] ?? err?.["httpStatusCode"] ?? 0;
  return { message, lower: message.toLowerCase(), status };
}
function classifyGeminiError(err) {
  const { lower, status } = shapeError(err);
  if (status === 401 || status === 400 || status === 403 || lower.includes("api_key_invalid") || lower.includes("permission denied") || lower.includes("suspended") || lower.includes("consumer_suspended") || lower.includes("invalid argument") || lower.includes("invalid_argument")) {
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
function classifyOpenAIError(err) {
  const { lower, status } = shapeError(err);
  if (status === 401 || status === 400 || status === 403 || lower.includes("invalid_api_key") || lower.includes("invalid api key") || lower.includes("incorrect api key") || lower.includes("account_deactivated") || lower.includes("permission_denied")) {
    return "fatal";
  }
  if (status === 429 || lower.includes("insufficient_quota") || lower.includes("billing_hard_limit") || lower.includes("quota") || lower.includes("rate_limit_exceeded") || lower.includes("rate limit") || lower.includes("tokens_per_min")) {
    if (lower.includes("insufficient_quota") || lower.includes("quota") || lower.includes("billing_hard_limit")) {
      return "quota";
    }
    return "rate-limit";
  }
  if (status >= 500 || lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("fetch failed") || lower.includes("network") || lower.includes("server_error") || lower.includes("service_unavailable") || lower.includes("internal server")) {
    return "network";
  }
  return "unknown";
}
var classifyError = classifyGeminiError;
var providerClassifiers = /* @__PURE__ */ new Map([
  ["gemini", classifyGeminiError],
  ["openai", classifyOpenAIError],
  ["openrouter", classifyOpenAIError]
]);
function registerProviderClassifier(providerID, classifier) {
  providerClassifiers.set(providerID, classifier);
}
function unregisterProviderClassifier(providerID) {
  return providerClassifiers.delete(providerID);
}
function getProviderClassifier(providerID) {
  return providerClassifiers.get(providerID) ?? classifyError;
}

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
        case "fatal":
        case "unknown":
          throw err;
      }
    }
  }
  throw new MaxRetriesExceededError(maxRetries + 1, lastError);
}

// src/client/gemini-client.ts
var import_node_fs = require("fs");
var import_generative_ai = require("@google/generative-ai");

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

// src/agent-runtime/agent-runtime.ts
var AgentRuntime = class {
  activeTask = null;
  pendingAction = null;
  now;
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
  }
  startTask(input) {
    const task = {
      id: input.id,
      objective: input.objective,
      status: "active",
      currentStep: input.currentStep ?? null,
      checkpoints: input.checkpoints.map((checkpoint) => ({ ...checkpoint })),
      blockers: [],
      requirementLog: [],
      metadata: cloneValue(input.metadata),
      updatedAt: this.now()
    };
    this.activeTask = task;
    this.clearPendingAction();
    return this.snapshotTaskRequired();
  }
  getActiveTask() {
    return this.snapshotTask();
  }
  setCurrentStep(step) {
    const task = this.requireActiveTask();
    task.currentStep = step;
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }
  updateCheckpoint(id, status) {
    const task = this.requireActiveTask();
    task.checkpoints = task.checkpoints.map(
      (checkpoint) => checkpoint.id === id ? { ...checkpoint, status } : checkpoint
    );
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }
  addCheckpoint(checkpoint) {
    const task = this.requireActiveTask();
    task.checkpoints = [...task.checkpoints, { ...checkpoint }];
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }
  mergeRequirement(message) {
    const task = this.requireActiveTask();
    task.requirementLog = [...task.requirementLog, message];
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }
  addBlocker(blocker) {
    const task = this.requireActiveTask();
    if (!task.blockers.includes(blocker)) {
      task.blockers = [...task.blockers, blocker];
      task.updatedAt = this.now();
    }
    return this.snapshotTaskRequired();
  }
  clearBlocker(blocker) {
    const task = this.requireActiveTask();
    task.blockers = task.blockers.filter((entry) => entry !== blocker);
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }
  applyInterrupt(event) {
    const task = this.requireActiveTask();
    const stamped = event.at ?? this.now();
    switch (event.kind) {
      case "status_question":
      case "clarification":
        task.updatedAt = stamped;
        break;
      case "requirement_update":
        task.requirementLog = [...task.requirementLog, event.message];
        task.updatedAt = stamped;
        break;
      case "redirect":
        task.status = "paused";
        task.updatedAt = stamped;
        this.clearPendingAction();
        break;
      case "cancel":
        task.status = "cancelled";
        task.updatedAt = stamped;
        this.cancelPendingAction();
        break;
      default:
        return this.snapshotTask();
    }
    return this.snapshotTask();
  }
  resumeTask() {
    const task = this.requireActiveTask();
    if (task.status === "paused") {
      task.status = "active";
      task.updatedAt = this.now();
    }
    return this.snapshotTaskRequired();
  }
  createPendingAction(input) {
    const createdAt = this.now();
    this.pendingAction = {
      actionName: input.actionName,
      args: cloneValue(input.args),
      sourceTurnId: input.sourceTurnId,
      prompt: input.prompt,
      createdAt,
      expiresAt: input.ttlMs == null ? null : createdAt + input.ttlMs,
      consumedAt: null,
      cancelledAt: null
    };
    return this.getPendingActionRequired();
  }
  getPendingAction() {
    if (!this.pendingAction) {
      return null;
    }
    if (this.isPendingActionExpired(this.pendingAction)) {
      this.pendingAction = null;
      return null;
    }
    return {
      ...this.pendingAction,
      args: cloneValue(this.pendingAction.args)
    };
  }
  consumePendingAction() {
    const pending = this.getPendingAction();
    if (!pending) {
      return null;
    }
    this.pendingAction = {
      ...pending,
      consumedAt: this.now()
    };
    return {
      ...this.pendingAction,
      args: cloneValue(this.pendingAction.args)
    };
  }
  cancelPendingAction() {
    const pending = this.getPendingAction();
    if (!pending) {
      return null;
    }
    this.pendingAction = {
      ...pending,
      cancelledAt: this.now()
    };
    return {
      ...this.pendingAction,
      args: cloneValue(this.pendingAction.args)
    };
  }
  clearPendingAction() {
    this.pendingAction = null;
  }
  canCompleteTask() {
    if (!this.activeTask) {
      return {
        ok: false,
        incompleteCheckpointIds: [],
        activeBlockers: [],
        status: null
      };
    }
    const incompleteCheckpointIds = this.activeTask.checkpoints.filter((checkpoint) => checkpoint.status !== "completed" && checkpoint.status !== "cancelled").map((checkpoint) => checkpoint.id);
    return {
      ok: this.activeTask.status === "active" && incompleteCheckpointIds.length === 0 && this.activeTask.blockers.length === 0,
      incompleteCheckpointIds,
      activeBlockers: [...this.activeTask.blockers],
      status: this.activeTask.status
    };
  }
  completeTask() {
    const result = this.canCompleteTask();
    if (!result.ok) {
      throw new Error("cannot complete task while checkpoints or blockers remain");
    }
    const task = this.requireActiveTask();
    task.status = "completed";
    task.updatedAt = this.now();
    this.clearPendingAction();
    return this.snapshotTaskRequired();
  }
  snapshot() {
    return {
      activeTask: this.getActiveTask(),
      pendingAction: this.getPendingAction()
    };
  }
  requireActiveTask() {
    if (!this.activeTask) {
      throw new Error("no active task");
    }
    return this.activeTask;
  }
  snapshotTask() {
    if (!this.activeTask) {
      return null;
    }
    return {
      ...this.activeTask,
      checkpoints: this.activeTask.checkpoints.map((checkpoint) => ({ ...checkpoint })),
      blockers: [...this.activeTask.blockers],
      requirementLog: [...this.activeTask.requirementLog],
      metadata: cloneValue(this.activeTask.metadata)
    };
  }
  snapshotTaskRequired() {
    const snapshot = this.snapshotTask();
    if (!snapshot) {
      throw new Error("no active task");
    }
    return snapshot;
  }
  getPendingActionRequired() {
    const pending = this.getPendingAction();
    if (!pending) {
      throw new Error("no pending action");
    }
    return pending;
  }
  isPendingActionExpired(action) {
    if (action.expiresAt == null) {
      return action.cancelledAt != null || action.consumedAt != null;
    }
    return action.cancelledAt != null || action.consumedAt != null || action.expiresAt <= this.now();
  }
};
function cloneValue(value) {
  return structuredClone(value);
}

// src/step-orchestration/planner.ts
function rankHealthyKeys(keys) {
  return [...keys].sort((a, b) => {
    if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount;
    if (a.cooldownUntil !== b.cooldownUntil) return a.cooldownUntil - b.cooldownUntil;
    if (a.leaseUntil !== b.leaseUntil) return a.leaseUntil - b.leaseUntil;
    return a.id - b.id;
  });
}
async function planPreferredKeys(pool, steps) {
  const now = Date.now();
  const healthyKeys = rankHealthyKeys(
    (await pool.status()).filter(
      (key) => key.isActive && key.cooldownUntil <= now && key.leaseUntil <= now
    )
  );
  const unusedHealthyKeys = [...healthyKeys];
  return steps.map((step) => {
    if (step.preferredKey) {
      const explicitPreferred = unusedHealthyKeys.find((key) => key.key === step.preferredKey);
      if (explicitPreferred) {
        const index = unusedHealthyKeys.findIndex((key) => key.key === explicitPreferred.key);
        if (index >= 0) unusedHealthyKeys.splice(index, 1);
        return {
          stepId: step.id,
          stepName: step.name,
          preferredKey: explicitPreferred.key,
          sharedFallbackRequired: false
        };
      }
      return {
        stepId: step.id,
        stepName: step.name,
        preferredKey: step.preferredKey,
        sharedFallbackRequired: true
      };
    }
    const nextHealthy = unusedHealthyKeys.shift();
    if (nextHealthy) {
      return {
        stepId: step.id,
        stepName: step.name,
        preferredKey: nextHealthy.key,
        sharedFallbackRequired: false
      };
    }
    return {
      stepId: step.id,
      stepName: step.name,
      preferredKey: null,
      sharedFallbackRequired: true
    };
  });
}

// src/step-orchestration/lease-heartbeat.ts
var LeaseHeartbeat = class {
  constructor(pool, apiKey, intervalMs) {
    this.pool = pool;
    this.currentKey = apiKey;
    this.intervalMs = intervalMs ?? Math.max(250, Math.min(6e4, Math.floor(pool.getAllocationLeaseMs() / 2)));
    this.start();
  }
  pool;
  timer = null;
  leaseError = null;
  currentKey;
  intervalMs;
  start() {
    this.stop();
    this.leaseError = null;
    this.timer = setInterval(() => {
      this.pool.renewLease(this.currentKey).then((renewed) => {
        if (!renewed) {
          this.leaseError = new Error(`Lost key lease for ${this.currentKey}`);
          this.stop();
        }
      }).catch((error) => {
        this.leaseError = error instanceof Error ? error : new Error(String(error));
        this.stop();
      });
    }, this.intervalMs);
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }
  switchKey(apiKey) {
    if (apiKey === this.currentKey) return;
    this.currentKey = apiKey;
    this.start();
  }
  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
  getError() {
    return this.leaseError;
  }
};

// src/step-orchestration/step-runner.ts
function withTimeout(promise, timeoutMs, stepName) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step "${stepName}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    })
  ]);
}
var StepRunner = class {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.options = options;
  }
  pool;
  options;
  async runStep(step) {
    const [result] = await this.runSteps([step]);
    return result;
  }
  async runSteps(steps) {
    const plan = await planPreferredKeys(this.pool, steps);
    const results = [];
    for (const [index, step] of steps.entries()) {
      const assignment = plan[index];
      const startedAt = Date.now();
      if (assignment.sharedFallbackRequired && !step.allowSharedFallback) {
        throw new NoAvailableKeyError(
          `Step "${step.name}" requires shared fallback but allowSharedFallback is false`
        );
      }
      let retryCount = 0;
      let sharedFallbackUsed = assignment.sharedFallbackRequired;
      let finalErrorClass = null;
      const initialAllocation = this.normalizeAcquireResult(
        step,
        assignment.preferredKey,
        await this.acquireInitialKey(step, assignment.preferredKey)
      );
      let currentKey = initialAllocation.key;
      sharedFallbackUsed = sharedFallbackUsed || initialAllocation.sharedFallbackUsed;
      const heartbeat = new LeaseHeartbeat(this.pool, currentKey);
      try {
        const value = await withRetry(
          async (apiKey) => {
            currentKey = apiKey;
            heartbeat.switchKey(apiKey);
            const leaseError = heartbeat.getError();
            if (leaseError) throw leaseError;
            const runPromise = step.run(apiKey);
            const result = step.timeoutMs ?? this.options.defaultTimeoutMs ? await withTimeout(runPromise, step.timeoutMs ?? this.options.defaultTimeoutMs, step.name) : await runPromise;
            const postCallLeaseError = heartbeat.getError();
            if (postCallLeaseError) throw postCallLeaseError;
            return result;
          },
          currentKey,
          {
            maxRetries: step.maxRetries ?? this.options.maxRetries ?? 3,
            initialBackoffMs: this.options.initialBackoffMs,
            maxBackoffMs: this.options.maxBackoffMs,
            rotateKey: async () => {
              retryCount += 1;
              const next = await this.rotateKey(step, currentKey, retryCount, finalErrorClass);
              sharedFallbackUsed = sharedFallbackUsed || next.sharedFallbackUsed;
              currentKey = next.key;
              heartbeat.switchKey(currentKey);
              return currentKey;
            },
            onRetry: (info) => {
              finalErrorClass = info.errorClass;
            }
          }
        );
        await this.releaseKey({
          pool: this.pool,
          step,
          key: currentKey,
          failed: false,
          authFailure: false,
          errorClass: finalErrorClass
        });
        results.push({
          value,
          metadata: {
            stepId: step.id,
            stepName: step.name,
            preferredKey: assignment.preferredKey,
            keyUsed: currentKey,
            preferredKeyUsed: assignment.preferredKey === currentKey,
            sharedFallbackUsed,
            retryCount,
            durationMs: Date.now() - startedAt,
            finalErrorClass
          }
        });
      } catch (error) {
        const authFailure = finalErrorClass === "fatal";
        await this.releaseKey({
          pool: this.pool,
          step,
          key: currentKey,
          failed: true,
          authFailure,
          errorClass: finalErrorClass
        }).catch(() => {
        });
        throw error;
      } finally {
        heartbeat.stop();
      }
    }
    return results;
  }
  async acquireInitialKey(step, preferredKey) {
    if (this.options.acquireInitialKey) {
      return this.options.acquireInitialKey({
        pool: this.pool,
        step,
        preferredKey
      });
    }
    const allocation = await this.pool.allocatePreferred(preferredKey, {
      allowFallback: step.allowSharedFallback ?? false
    });
    return {
      key: allocation.key,
      usedPreferred: allocation.usedPreferred,
      sharedFallbackUsed: Boolean(preferredKey) && !allocation.usedPreferred
    };
  }
  async rotateKey(step, currentKey, retryCount, errorClass) {
    if (!(step.allowSharedFallback ?? false)) {
      throw new NoAvailableKeyError(
        `Step "${step.name}" requires key rotation, but shared fallback is disabled`
      );
    }
    if (this.options.rotateKey) {
      const result = await this.options.rotateKey({
        pool: this.pool,
        step,
        currentKey,
        retryCount,
        errorClass
      });
      return {
        key: result.key,
        sharedFallbackUsed: result.sharedFallbackUsed || result.key !== currentKey
      };
    }
    await this.pool.release(currentKey, true, errorClass === "fatal");
    const next = await this.pool.allocatePreferred(null, { allowFallback: true });
    return {
      key: next.key,
      sharedFallbackUsed: true
    };
  }
  async releaseKey(context) {
    if (this.options.releaseKey) {
      return this.options.releaseKey(context);
    }
    await this.pool.release(context.key, context.failed, context.authFailure);
  }
  normalizeAcquireResult(step, preferredKey, result) {
    const usedPreferred = preferredKey ? result.key === preferredKey : false;
    const sharedFallbackUsed = result.sharedFallbackUsed || Boolean(preferredKey) && result.key !== preferredKey;
    if (sharedFallbackUsed && !(step.allowSharedFallback ?? false)) {
      throw new NoAvailableKeyError(
        `Step "${step.name}" requires shared fallback but allowSharedFallback is false`
      );
    }
    return {
      key: result.key,
      usedPreferred,
      sharedFallbackUsed
    };
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

// src/provider/adapters/gemini.ts
var GeminiProviderAdapter = class {
  provider = getBuiltInProvider("gemini");
  credential;
  client;
  constructor(pool, maxRetries = 3) {
    this.credential = { type: "pool", provider: "gemini", credentialLabel: "gemini-pool" };
    this.client = new GeminiClient(pool, { maxRetries });
  }
  supports(modelID) {
    return this.provider.models.some((model) => model.id === modelID);
  }
  getModel(modelID) {
    const model = getBuiltInModel(modelID);
    if (!model || model.provider !== this.provider.id) return void 0;
    return model;
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
  buildHeaders() {
    return {
      Authorization: `Bearer ${this.credential.apiKey}`,
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
var OpenAIProviderAdapter = class extends OpenAICompatibleAdapter {
  provider = getBuiltInProvider("openai");
  defaultBaseURL = "https://api.openai.com/v1";
  nativeToolProvider = "openai";
  constructor(credential) {
    super(credential);
  }
  buildHeaders() {
    return {
      ...super.buildHeaders(),
      ...this.credential.organization && {
        "OpenAI-Organization": this.credential.organization
      }
    };
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
  AgentRuntime,
  GeminiClient,
  GeminiProviderAdapter,
  KeyPool,
  LeaseHeartbeat,
  MaxRetriesExceededError,
  NoAvailableKeyError,
  OpenAICompatibleAdapter,
  OpenAIProviderAdapter,
  OpenRouterProviderAdapter,
  ProviderID,
  ProviderRouter,
  SqliteAdapter,
  StepRunner,
  StreamInterruptedError,
  builtInProviders,
  classifyError,
  classifyGeminiError,
  classifyOpenAIError,
  clearRegisteredProviders,
  defaultProviderPriority,
  getBuiltInModel,
  getBuiltInProvider,
  getModel,
  getProvider,
  getProviderClassifier,
  listRegisteredProviders,
  planPreferredKeys,
  registerProvider,
  registerProviderClassifier,
  toGeminiTools,
  toOpenAITools,
  unregisterProvider,
  unregisterProviderClassifier,
  withRetry
});
//# sourceMappingURL=index.cjs.map