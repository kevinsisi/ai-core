import {
  NoAvailableKeyError
} from "./chunk-6664ONDT.js";

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

export {
  KeyPool,
  SqliteAdapter
};
//# sourceMappingURL=chunk-TNL6P7AP.js.map