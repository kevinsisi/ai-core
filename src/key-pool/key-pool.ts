import type { ApiKey, StorageAdapter, KeyPoolOptions } from "./types.js";
import { NoAvailableKeyError } from "./types.js";

// ── KeyPool ────────────────────────────────────────────────────────────

export class KeyPool {
  private readonly adapter: StorageAdapter;
  private readonly defaultCooldownMs: number;
  private readonly authCooldownMs: number;
  /** In-memory cache; reloaded on first use or after invalidation */
  private cache: ApiKey[] | null = null;
  /** Round-robin pointer — index into the full keys array */
  private pointer = 0;

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

  private findIndexByKey(keys: ApiKey[], key: string): number {
    return keys.findIndex((k) => k.key === key);
  }

  /**
   * Advance pointer to the next available key (round-robin).
   * Wraps around modulo keys.length.
   */
  private advancePointer(keys: ApiKey[]): void {
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
  async allocate(count: number): Promise<string[]> {
    const keys = await this.getKeys();
    const available = this.availableKeys(keys);

    if (available.length === 0) {
      throw new NoAvailableKeyError();
    }

    const result: string[] = [];
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
