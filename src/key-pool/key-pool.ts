import type { ApiKey, StorageAdapter, KeyPoolOptions } from "./types.js";
import { NoAvailableKeyError } from "./types.js";

// ── Fisher-Yates shuffle ───────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── KeyPool ────────────────────────────────────────────────────────────

export class KeyPool {
  private readonly adapter: StorageAdapter;
  private readonly defaultCooldownMs: number;
  private readonly authCooldownMs: number;
  /** In-memory cache; reloaded on first use or after invalidation */
  private cache: ApiKey[] | null = null;
  /** Active allocations not yet released. Lower is better when picking keys. */
  private readonly inFlight = new Map<string, number>();
  /** Last allocation timestamp by key to avoid hammering the same key repeatedly. */
  private readonly lastAllocatedAt = new Map<string, number>();

  constructor(adapter: StorageAdapter, options: KeyPoolOptions = {}) {
    this.adapter = adapter;
    this.defaultCooldownMs = options.defaultCooldownMs ?? 60_000;
    this.authCooldownMs = options.authCooldownMs ?? 30 * 60_000;
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
    return keys.filter((k) => k.isActive && k.cooldownUntil <= now);
  }

  private findByKey(keys: ApiKey[], key: string): ApiKey | undefined {
    return keys.find((k) => k.key === key);
  }

  private rankAvailable(keys: ApiKey[]): ApiKey[] {
    const groups = new Map<string, ApiKey[]>();

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

    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        const [aInFlight, aUsage, aLast] = a.split(":").map(Number);
        const [bInFlight, bUsage, bLast] = b.split(":").map(Number);
        if (aInFlight !== bInFlight) return aInFlight - bInFlight;
        if (aUsage !== bUsage) return aUsage - bUsage;
        return aLast - bLast;
      })
      .flatMap(([, group]) => shuffle(group));
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Allocate up to `count` available keys using load-aware ranking.
   * Throws NoAvailableKeyError if zero keys are available or if `count`
   * exceeds the number of currently available keys.
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
  async release(
    key: string,
    failed: boolean,
    authFailure = false
  ): Promise<void> {
    const keys = await this.getKeys();
    const record = this.findByKey(keys, key);
    if (!record) return;

    if (failed) {
      const duration = authFailure
        ? this.authCooldownMs
        : this.defaultCooldownMs;
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
  async block(key: string): Promise<void> {
    const keys = await this.getKeys();
    const record = this.findByKey(keys, key);
    if (!record) return;
    record.isActive = false;
    await this.adapter.updateKey(record);
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
