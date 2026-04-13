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
    usageCount: number;
}
/**
 * Pluggable storage interface. Implement this to connect KeyPool
 * to any database (SQLite, Postgres, in-memory, etc.).
 */
interface StorageAdapter {
    /** Return all keys. KeyPool handles filtering logic. */
    getKeys(): Promise<ApiKey[]>;
    /** Persist updated key state (cooldown, usageCount, isActive). */
    updateKey(key: ApiKey): Promise<void>;
}
interface KeyPoolOptions {
    /** Default cooldown duration in ms when a key fails (default: 60_000) */
    defaultCooldownMs?: number;
    /** Longer cooldown for auth failures in ms (default: 1_800_000 = 30 min) */
    authCooldownMs?: number;
}
declare class NoAvailableKeyError extends Error {
    constructor(message?: string);
}

declare class KeyPool {
    private readonly adapter;
    private readonly defaultCooldownMs;
    private readonly authCooldownMs;
    /** In-memory cache; reloaded on first use or after invalidation */
    private cache;
    /** Active allocations not yet released. Lower is better when picking keys. */
    private readonly inFlight;
    /** Last allocation timestamp by key to avoid hammering the same key repeatedly. */
    private readonly lastAllocatedAt;
    constructor(adapter: StorageAdapter, options?: KeyPoolOptions);
    private getKeys;
    private availableKeys;
    private findByKey;
    private rankAvailable;
    /**
     * Allocate up to `count` available keys using load-aware ranking.
     * Throws NoAvailableKeyError if zero keys are available or if `count`
     * exceeds the number of currently available keys.
     */
    allocate(count: number): Promise<string[]>;
    /**
     * Release a key after use.
     * @param key - The API key string
     * @param failed - If true, sets cooldown; if false, increments usageCount
     * @param authFailure - If true, uses longer auth cooldown (default: false)
     */
    release(key: string, failed: boolean, authFailure?: boolean): Promise<void>;
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
