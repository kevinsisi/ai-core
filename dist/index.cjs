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
  KeyPool: () => KeyPool,
  MaxRetriesExceededError: () => MaxRetriesExceededError,
  NoAvailableKeyError: () => NoAvailableKeyError,
  SqliteAdapter: () => SqliteAdapter,
  StreamInterruptedError: () => StreamInterruptedError,
  classifyError: () => classifyError,
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
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
var KeyPool = class {
  adapter;
  defaultCooldownMs;
  authCooldownMs;
  /** In-memory cache; reloaded on first use or after invalidation */
  cache = null;
  /** Active allocations not yet released. Lower is better when picking keys. */
  inFlight = /* @__PURE__ */ new Map();
  /** Last allocation timestamp by key to avoid hammering the same key repeatedly. */
  lastAllocatedAt = /* @__PURE__ */ new Map();
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    this.defaultCooldownMs = options.defaultCooldownMs ?? 6e4;
    this.authCooldownMs = options.authCooldownMs ?? 30 * 6e4;
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
    return keys.filter((k) => k.isActive && k.cooldownUntil <= now);
  }
  findByKey(keys, key) {
    return keys.find((k) => k.key === key);
  }
  rankAvailable(keys) {
    const groups = /* @__PURE__ */ new Map();
    for (const key of keys) {
      const inFlight = this.inFlight.get(key.key) ?? 0;
      const lastAllocatedAt = this.lastAllocatedAt.get(key.key) ?? 0;
      const groupKey = `${inFlight}:${key.usageCount}:${lastAllocatedAt}`;
      const group = groups.get(groupKey);
      if (group) {
        group.push(key);
      } else {
        groups.set(groupKey, [key]);
      }
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const [aInFlight, aUsage, aLast] = a.split(":").map(Number);
      const [bInFlight, bUsage, bLast] = b.split(":").map(Number);
      if (aInFlight !== bInFlight) return aInFlight - bInFlight;
      if (aUsage !== bUsage) return aUsage - bUsage;
      return aLast - bLast;
    }).flatMap(([, group]) => shuffle(group));
  }
  // ── Public API ─────────────────────────────────────────────────────
  /**
   * Allocate up to `count` available keys using load-aware ranking.
   * Throws NoAvailableKeyError if zero keys are available or if `count`
   * exceeds the number of currently available keys.
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
    for (let i = 0; i < count; i++) {
      const selected = ranked[i].key;
      result.push(selected);
      this.inFlight.set(selected, (this.inFlight.get(selected) ?? 0) + 1);
      this.lastAllocatedAt.set(selected, now + i);
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
    const keys = await this.getKeys();
    const record = this.findByKey(keys, key);
    if (!record) return;
    if (failed) {
      const duration = authFailure ? this.authCooldownMs : this.defaultCooldownMs;
      record.cooldownUntil = Date.now() + duration;
    } else {
      record.usageCount += 1;
    }
    try {
      await this.adapter.updateKey(record);
    } finally {
      const inFlight = this.inFlight.get(key) ?? 0;
      if (inFlight <= 1) {
        this.inFlight.delete(key);
      } else {
        this.inFlight.set(key, inFlight - 1);
      }
    }
  }
  /**
   * Permanently deactivate a key (e.g., suspended by Google).
   */
  async block(key) {
    const keys = await this.getKeys();
    const record = this.findByKey(keys, key);
    if (!record) return;
    record.isActive = false;
    await this.adapter.updateKey(record);
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
        usage_count   INTEGER NOT NULL DEFAULT 0
      )
    `).run();
  }
  async getKeys() {
    const rows = this.db.prepare(
      "SELECT id, key, is_active, cooldown_until, usage_count FROM api_keys"
    ).all();
    return rows.map(rowToApiKey);
  }
  async updateKey(key) {
    this.db.prepare(
      `UPDATE api_keys
         SET is_active = ?, cooldown_until = ?, usage_count = ?
         WHERE id = ?`
    ).run(
      key.isActive ? 1 : 0,
      key.cooldownUntil,
      key.usageCount,
      key.id
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
    usageCount: row.usage_count
  };
}

// src/retry/classify-error.ts
function classifyError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  const status = err?.["status"] ?? err?.["httpStatusCode"] ?? 0;
  if (status === 401 || status === 400 || status === 403 || lower.includes("api_key_invalid") || lower.includes("permission denied") || lower.includes("suspended") || lower.includes("consumer_suspended") || lower.includes("invalid argument") || lower.includes("invalid_argument")) {
    return "fatal";
  }
  if (status === 429 || lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("rate_limit") || lower.includes("rate limit") || lower.includes("rateLimitExceeded")) {
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
  /**
   * Generate content (non-streaming).
   * Automatically allocates a key, calls Gemini, releases the key.
   */
  async generateContent(params) {
    const [initialKey] = await this.pool.allocate(1);
    let currentKey = initialKey;
    let failed = false;
    let authFailure = false;
    try {
      const response = await withRetry(
        async (apiKey) => {
          currentKey = apiKey;
          const genai = new import_generative_ai.GoogleGenerativeAI(apiKey);
          const model = genai.getGenerativeModel({
            model: params.model,
            ...params.systemInstruction && {
              systemInstruction: params.systemInstruction
            },
            ...params.tools && { tools: params.tools },
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
            return result.response;
          } else {
            const result = await model.generateContent(content);
            return result.response;
          }
        },
        initialKey,
        {
          maxRetries: this.maxRetries,
          rotateKey: async () => {
            await this.pool.release(currentKey, true);
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
    try {
      const genai = new import_generative_ai.GoogleGenerativeAI(key);
      const model = genai.getGenerativeModel({
        model: params.model,
        ...params.systemInstruction && {
          systemInstruction: params.systemInstruction
        },
        ...params.tools && { tools: params.tools }
      });
      const content = params.images?.length ? buildParts(params.prompt, params.images) : params.prompt;
      const result = await model.generateContentStream(content);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          chunksReceived++;
          yield text;
        }
      }
    } catch (err) {
      failed = true;
      throw new StreamInterruptedError(chunksReceived, err);
    } finally {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AgentRuntime,
  GeminiClient,
  KeyPool,
  MaxRetriesExceededError,
  NoAvailableKeyError,
  SqliteAdapter,
  StreamInterruptedError,
  classifyError,
  withRetry
});
//# sourceMappingURL=index.cjs.map