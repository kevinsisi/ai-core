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

// src/key-pool/index.ts
var key_pool_exports = {};
__export(key_pool_exports, {
  KeyPool: () => KeyPool,
  NoAvailableKeyError: () => NoAvailableKeyError,
  SqliteAdapter: () => SqliteAdapter
});
module.exports = __toCommonJS(key_pool_exports);

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KeyPool,
  NoAvailableKeyError,
  SqliteAdapter
});
//# sourceMappingURL=index.cjs.map