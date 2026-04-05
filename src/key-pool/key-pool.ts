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

  constructor(adapter: StorageAdapter, options: KeyPoolOptions = {}) {
    this.adapter = adapter;
    this.defaultCooldownMs = options.defaultCooldownMs ?? 60_000;
    this.authCooldownMs = options.authCooldownMs ?? 30 * 60_000;
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private async getKeys(): Promise<ApiKey[]> {
    if (!this.cache) {
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

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Allocate up to `count` available keys using shuffle-based selection.
   * Returns fewer than `count` if the pool is smaller.
   * Throws NoAvailableKeyError if zero keys are available.
   */
  async allocate(count: number): Promise<string[]> {
    const keys = await this.getKeys();
    const available = this.availableKeys(keys);

    if (available.length === 0) {
      throw new NoAvailableKeyError();
    }

    const shuffled = shuffle(available);
    // Cycle through available keys if count > available.length
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      result.push(shuffled[i % shuffled.length].key);
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

    await this.adapter.updateKey(record);
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
    return this.getKeys();
  }
}
