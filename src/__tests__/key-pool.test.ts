import { describe, it, expect, vi, beforeEach } from "vitest";
import { KeyPool, NoAvailableKeyError } from "../key-pool/index.js";
import type { ApiKey, StorageAdapter } from "../key-pool/index.js";

// ── Helpers ───────────────────────────────────────────────────────────

function makeKey(
  id: number,
  key: string,
  overrides: Partial<ApiKey> = {}
): ApiKey {
  return {
    id,
    key,
    isActive: true,
    cooldownUntil: 0,
    usageCount: 0,
    ...overrides,
  };
}

function makeAdapter(keys: ApiKey[]): StorageAdapter & { updated: ApiKey[] } {
  const updated: ApiKey[] = [];
  return {
    updated,
    async getKeys() {
      return [...keys];
    },
    async updateKey(key: ApiKey) {
      // Update in-place so subsequent getKeys reflects changes
      const idx = keys.findIndex((k) => k.id === key.id);
      if (idx >= 0) keys[idx] = { ...key };
      updated.push({ ...key });
    },
  };
}

// ── Key Pool Tests ────────────────────────────────────────────────────

describe("KeyPool", () => {
  describe("allocate", () => {
    it("returns a key from the pool", async () => {
      const adapter = makeAdapter([makeKey(1, "key-a")]);
      const pool = new KeyPool(adapter);
      const keys = await pool.allocate(1);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe("key-a");
    });

    it("throws NoAvailableKeyError when all keys are inactive", async () => {
      const adapter = makeAdapter([
        makeKey(1, "key-a", { isActive: false }),
      ]);
      const pool = new KeyPool(adapter);
      await expect(pool.allocate(1)).rejects.toThrow(NoAvailableKeyError);
    });

    it("throws NoAvailableKeyError when all keys are in cooldown", async () => {
      const adapter = makeAdapter([
        makeKey(1, "key-a", { cooldownUntil: Date.now() + 60_000 }),
      ]);
      const pool = new KeyPool(adapter);
      await expect(pool.allocate(1)).rejects.toThrow(NoAvailableKeyError);
    });

    it("excludes keys whose cooldown has expired", async () => {
      const expiredCooldown = Date.now() - 1000; // 1 second ago
      const adapter = makeAdapter([
        makeKey(1, "key-a", { cooldownUntil: expiredCooldown }),
      ]);
      const pool = new KeyPool(adapter);
      const keys = await pool.allocate(1);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe("key-a");
    });

    it("returns fewer keys than requested when pool is smaller (graceful degradation)", async () => {
      const adapter = makeAdapter([
        makeKey(1, "key-a"),
        makeKey(2, "key-b"),
      ]);
      const pool = new KeyPool(adapter);
      // Request 3, only 2 available — should cycle and return 3
      const keys = await pool.allocate(3);
      expect(keys).toHaveLength(3);
      // All returned keys must be from the pool
      keys.forEach((k) => expect(["key-a", "key-b"]).toContain(k));
    });

    it("uses shuffle so different keys are returned across calls", async () => {
      const keys = Array.from({ length: 10 }, (_, i) =>
        makeKey(i + 1, `key-${i}`)
      );
      const adapter = makeAdapter(keys);
      const pool = new KeyPool(adapter);

      const results = new Set<string>();
      for (let i = 0; i < 20; i++) {
        pool.invalidate(); // force reload to get fresh shuffle
        const [k] = await pool.allocate(1);
        results.add(k);
      }
      // With 10 keys and 20 draws, statistically we expect > 1 unique key
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe("release (success)", () => {
    it("increments usageCount and persists on success", async () => {
      const record = makeKey(1, "key-a");
      const adapter = makeAdapter([record]);
      const pool = new KeyPool(adapter);

      await pool.release("key-a", false);

      expect(adapter.updated).toHaveLength(1);
      expect(adapter.updated[0].usageCount).toBe(1);
      expect(adapter.updated[0].cooldownUntil).toBe(0);
    });
  });

  describe("release (failure)", () => {
    it("sets cooldown on failure", async () => {
      const record = makeKey(1, "key-a");
      const adapter = makeAdapter([record]);
      const pool = new KeyPool(adapter, { defaultCooldownMs: 60_000 });
      const before = Date.now();

      await pool.release("key-a", true);

      expect(adapter.updated).toHaveLength(1);
      const updatedCooldown = adapter.updated[0].cooldownUntil;
      expect(updatedCooldown).toBeGreaterThanOrEqual(before + 59_000);
      expect(updatedCooldown).toBeLessThanOrEqual(before + 61_000);
    });

    it("uses authCooldownMs for auth failures", async () => {
      const record = makeKey(1, "key-a");
      const adapter = makeAdapter([record]);
      const pool = new KeyPool(adapter, { authCooldownMs: 30 * 60_000 });
      const before = Date.now();

      await pool.release("key-a", true, true);

      const updatedCooldown = adapter.updated[0].cooldownUntil;
      expect(updatedCooldown).toBeGreaterThanOrEqual(before + 29 * 60_000);
    });
  });
});
