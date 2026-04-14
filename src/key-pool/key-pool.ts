import type { ApiKey, StorageAdapter, KeyPoolOptions } from "./types.js";
import { NoAvailableKeyError } from "./types.js";

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ── KeyPool ────────────────────────────────────────────────────────────

export class KeyPool {
  private readonly adapter: StorageAdapter;
  private readonly defaultCooldownMs: number;
  private readonly authCooldownMs: number;
  private readonly allocationLeaseMs: number;
  /** In-memory cache; reloaded on first use or after invalidation */
  private cache: ApiKey[] | null = null;
  /** Active allocations in the current process; fewer is better. */
  private readonly inFlight = new Map<string, number>();
  /** Last allocation timestamp to avoid repeatedly hammering the same key. */
  private readonly lastAllocatedAt = new Map<string, number>();
  /** Lease token held by this process for each allocated key. */
  private readonly leaseTokens = new Map<string, string>();

  constructor(adapter: StorageAdapter, options: KeyPoolOptions = {}) {
    this.adapter = adapter;
    this.defaultCooldownMs = options.defaultCooldownMs ?? 60_000;
    this.authCooldownMs = options.authCooldownMs ?? 30 * 60_000;
    this.allocationLeaseMs = options.allocationLeaseMs ?? 5 * 60_000;
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private async getKeys(forceReload = false): Promise<ApiKey[]> {
    if (!this.cache || forceReload) {
      this.cache = await this.adapter.getKeys();
    }
    return this.cache;
  }

  private availableKeys(keys: ApiKey[]): ApiKey[] {
    const now = Date.now();
    return keys.filter(
      (k) =>
        k.isActive &&
        k.cooldownUntil <= now &&
        k.leaseUntil <= now &&
        (this.inFlight.get(k.key) ?? 0) === 0
    );
  }

  private findByKey(keys: ApiKey[], key: string): ApiKey | undefined {
    return keys.find((k) => k.key === key);
  }

  private rankAvailable(keys: ApiKey[]): ApiKey[] {
    const grouped = new Map<string, ApiKey[]>();

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

    return Array.from(grouped.entries())
      .sort(([a], [b]) => {
        const [aInFlight, aUsage, aLast] = a.split(":").map(Number);
        const [bInFlight, bUsage, bLast] = b.split(":").map(Number);
        if (aInFlight !== bInFlight) return aInFlight - bInFlight;
        if (aUsage !== bUsage) return aUsage - bUsage;
        return aLast - bLast;
      })
      .flatMap(([, group]) => shuffle(group));
  }

  private async clearLease(key: string): Promise<void> {
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

  private releaseLocalTracking(key: string): void {
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
  async allocatePreferred(
    preferredKey?: string | null,
    options: { allowFallback?: boolean } = {}
  ): Promise<{ key: string; usedPreferred: boolean }> {
    const keys = await this.getKeys(true);
    const available = this.availableKeys(keys);

    if (available.length === 0) {
      throw new NoAvailableKeyError();
    }

    const ranked = this.rankAvailable(available);
    const allowFallback = options.allowFallback ?? true;
    const ordered = preferredKey
      ? allowFallback
        ? [
            ...ranked.filter((key) => key.key === preferredKey),
            ...ranked.filter((key) => key.key !== preferredKey),
          ]
        : ranked.filter((key) => key.key === preferredKey)
      : ranked;

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
        usedPreferred: Boolean(preferredKey) && key === preferredKey,
      };
    }

    throw new NoAvailableKeyError(
      preferredKey && !allowFallback
        ? `Preferred key could not be leased: ${preferredKey}`
        : "No preferred or fallback key could be leased"
    );
  }

  /**
   * Allocate up to `count` available keys using load-aware ranking.
   * Throws NoAvailableKeyError if zero keys are available or the request
   * asks for more keys than are currently available.
   */
  async allocate(count: number): Promise<string[]> {
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
    const result: string[] = [];

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
  async release(
    key: string,
    failed: boolean,
    authFailure = false
  ): Promise<void> {
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
      const duration = authFailure
        ? this.authCooldownMs
        : this.defaultCooldownMs;
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

  getAllocationLeaseMs(): number {
    return this.allocationLeaseMs;
  }

  async renewLease(key: string): Promise<boolean> {
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

  async releaseLease(key: string): Promise<void> {
    await this.clearLease(key);
  }

  /**
   * Permanently deactivate a key (e.g., suspended by Google).
   */
  async block(key: string): Promise<void> {
    const keys = await this.getKeys(true);
    const record = this.findByKey(keys, key);
    if (!record) return;
    record.isActive = false;
    await this.adapter.updateKey(record, record.leaseToken);
  }

  /**
   * Force-reload keys from storage on next allocate().
   */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Return all keys with current status (for diagnostics / admin UI).
   */
  async status(): Promise<ApiKey[]> {
    return this.getKeys(true);
  }
}
