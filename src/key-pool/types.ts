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
  /** Unix ms timestamp; 0 = not currently leased to an active caller */
  leaseUntil: number;
  /** Opaque lease token used to prevent stale holders from clearing newer leases. */
  leaseToken: string | null;
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
  /** Try to acquire a lease atomically. Returns true on success. */
  acquireLease(
    keyId: number,
    leaseUntil: number,
    leaseToken: string,
    now: number
  ): Promise<boolean>;
  /** Extend an active lease if the lease token still matches. */
  renewLease(
    keyId: number,
    leaseUntil: number,
    leaseToken: string,
    now: number
  ): Promise<boolean>;
  /** Persist updated key state (cooldown, usageCount, lease, isActive). */
  updateKey(key: ApiKey, expectedLeaseToken?: string | null): Promise<void>;
}

// ── Options ────────────────────────────────────────────────────────────

export interface KeyPoolOptions {
  /** Default cooldown duration in ms when a key fails (default: 60_000) */
  defaultCooldownMs?: number;
  /** Longer cooldown for auth failures in ms (default: 1_800_000 = 30 min) */
  authCooldownMs?: number;
  /** Lease duration in ms for active allocations (default: 300_000 = 5 min) */
  allocationLeaseMs?: number;
}

// ── Errors ─────────────────────────────────────────────────────────────

export class NoAvailableKeyError extends Error {
  constructor(message = "No available API keys in pool") {
    super(message);
    this.name = "NoAvailableKeyError";
  }
}
