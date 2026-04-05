// ── ApiKey ─────────────────────────────────────────────────────────────

/**
 * Represents a single API key with lifecycle metadata.
 * Timestamps are Unix ms (Date.now()).
 */
export interface ApiKey {
  id: number;
  key: string;
  /** false = permanently blocked; excluded from all allocations */
  isActive: boolean;
  /** Unix ms timestamp; 0 = not in cooldown */
  cooldownUntil: number;
  usageCount: number;
}

// ── StorageAdapter ─────────────────────────────────────────────────────

/**
 * Pluggable storage interface. Implement this to connect KeyPool
 * to any database (SQLite, Postgres, in-memory, etc.).
 */
export interface StorageAdapter {
  /** Return all keys. KeyPool handles filtering logic. */
  getKeys(): Promise<ApiKey[]>;
  /** Persist updated key state (cooldown, usageCount, isActive). */
  updateKey(key: ApiKey): Promise<void>;
}

// ── Options ────────────────────────────────────────────────────────────

export interface KeyPoolOptions {
  /** Default cooldown duration in ms when a key fails (default: 60_000) */
  defaultCooldownMs?: number;
  /** Longer cooldown for auth failures in ms (default: 1_800_000 = 30 min) */
  authCooldownMs?: number;
}

// ── Errors ─────────────────────────────────────────────────────────────

export class NoAvailableKeyError extends Error {
  constructor(message = "No available API keys in pool") {
    super(message);
    this.name = "NoAvailableKeyError";
  }
}
