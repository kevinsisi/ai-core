/**
 * Represents a single API key with lifecycle metadata.
 * Timestamps are Unix ms (Date.now()).
 */
interface ApiKey {
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
/**
 * Pluggable storage interface. Implement this to connect KeyPool
 * to any database (SQLite, Postgres, in-memory, etc.).
 */
interface StorageAdapter {
    /** Return all keys. KeyPool handles filtering logic. */
    getKeys(): Promise<ApiKey[]>;
    /** Try to acquire a lease atomically. Returns true on success. */
    acquireLease(keyId: number, leaseUntil: number, leaseToken: string, now: number): Promise<boolean>;
    /** Extend an active lease if the lease token still matches. */
    renewLease(keyId: number, leaseUntil: number, leaseToken: string, now: number): Promise<boolean>;
    /** Persist updated key state (cooldown, usageCount, lease, isActive). */
    updateKey(key: ApiKey, expectedLeaseToken?: string | null): Promise<void>;
}
interface KeyPoolOptions {
    /** Default cooldown duration in ms when a key fails (default: 60_000) */
    defaultCooldownMs?: number;
    /** Longer cooldown for auth failures in ms (default: 1_800_000 = 30 min) */
    authCooldownMs?: number;
    /** Lease duration in ms for active allocations (default: 300_000 = 5 min) */
    allocationLeaseMs?: number;
}
declare class NoAvailableKeyError extends Error {
    constructor(message?: string);
}

declare class KeyPool {
    private readonly adapter;
    private readonly defaultCooldownMs;
    private readonly authCooldownMs;
    private readonly allocationLeaseMs;
    /** In-memory cache; reloaded on first use or after invalidation */
    private cache;
    /** Active allocations in the current process; fewer is better. */
    private readonly inFlight;
    /** Last allocation timestamp to avoid repeatedly hammering the same key. */
    private readonly lastAllocatedAt;
    /** Lease token held by this process for each allocated key. */
    private readonly leaseTokens;
    constructor(adapter: StorageAdapter, options?: KeyPoolOptions);
    private getKeys;
    private availableKeys;
    private findByKey;
    private rankAvailable;
    private clearLease;
    private releaseLocalTracking;
    /**
     * Allocate up to `count` available keys using load-aware ranking.
     * Throws NoAvailableKeyError if zero keys are available or the request
     * asks for more keys than are currently available.
     */
    allocate(count: number): Promise<string[]>;
    /**
     * Release a key after use.
     * @param key - The API key string
     * @param failed - If true, sets cooldown; if false, increments usageCount
     * @param authFailure - If true, uses longer auth cooldown (default: false)
     */
    release(key: string, failed: boolean, authFailure?: boolean): Promise<void>;
    getAllocationLeaseMs(): number;
    renewLease(key: string): Promise<boolean>;
    /**
     * Permanently deactivate a key (e.g., suspended by Google).
     */
    block(key: string): Promise<void>;
    /**
     * Force-reload keys from storage on next allocate().
     */
    invalidate(): void;
    /**
     * Return all keys with current status (for diagnostics / admin UI).
     */
    status(): Promise<ApiKey[]>;
}

export { type ApiKey as A, KeyPool as K, NoAvailableKeyError as N, type StorageAdapter as S, type KeyPoolOptions as a };
