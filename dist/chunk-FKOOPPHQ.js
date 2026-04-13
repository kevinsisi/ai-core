import {
  NoAvailableKeyError
} from "./chunk-6664ONDT.js";

// src/key-pool/key-pool.ts
var KeyPool = class {
  adapter;
  defaultCooldownMs;
  authCooldownMs;
  /** In-memory cache; reloaded on first use or after invalidation */
  cache = null;
  /** Round-robin pointer — index into the full keys array */
  pointer = 0;
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    this.defaultCooldownMs = options.defaultCooldownMs ?? 6e4;
    this.authCooldownMs = options.authCooldownMs ?? 30 * 6e4;
  }
  // ── Internal helpers ───────────────────────────────────────────────
  async getKeys() {
    if (!this.cache) {
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
  findIndexByKey(keys, key) {
    return keys.findIndex((k) => k.key === key);
  }
  /**
   * Advance pointer to the next available key (round-robin).
   * Wraps around modulo keys.length.
   */
  advancePointer(keys) {
    const available = this.availableKeys(keys);
    if (available.length === 0) return;
    const currentKey = keys[this.pointer];
    if (currentKey && currentKey.isActive && currentKey.cooldownUntil <= Date.now()) {
      return;
    }
    const idx = keys.findIndex((k) => k.key === currentKey?.key);
    if (idx >= 0) {
      this.pointer = (idx + 1) % keys.length;
    }
  }
  // ── Public API ─────────────────────────────────────────────────────
  /**
   * Allocate `count` available keys using round-robin selection.
   * Starts from `pointer`, skips unavailable keys, wraps around.
   * Throws NoAvailableKeyError if zero keys are available.
   */
  async allocate(count) {
    const keys = await this.getKeys();
    const available = this.availableKeys(keys);
    if (available.length === 0) {
      throw new NoAvailableKeyError();
    }
    const result = [];
    let wrapped = 0;
    const maxAttempts = keys.length * count;
    while (result.length < count && wrapped < maxAttempts) {
      const idx = this.pointer % keys.length;
      const key = keys[idx];
      if (key.isActive && key.cooldownUntil <= Date.now()) {
        result.push(key.key);
      }
      this.pointer++;
      wrapped++;
      if (this.pointer >= keys.length * 2) {
        break;
      }
    }
    if (result.length === 0) {
      throw new NoAvailableKeyError();
    }
    return result;
  }
  /**
   * Release a key after use.
   * Advances the pointer so the next allocate() gets the next key.
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
      this.pointer = (this.findIndexByKey(keys, key) + 1) % keys.length;
    } else {
      record.usageCount += 1;
      this.pointer = (this.findIndexByKey(keys, key) + 1) % keys.length;
    }
    await this.adapter.updateKey(record);
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
    return this.getKeys();
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
//# sourceMappingURL=chunk-FKOOPPHQ.js.map