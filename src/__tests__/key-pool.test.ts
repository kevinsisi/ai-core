import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    leaseUntil: 0,
    leaseToken: null,
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
    async acquireLease(
      keyId: number,
      leaseUntil: number,
      leaseToken: string,
      now: number
    ) {
      const record = keys.find((key) => key.id === keyId);
      if (!record) return false;
      if (!record.isActive || record.cooldownUntil > now || record.leaseUntil > now) {
        return false;
      }
      record.leaseUntil = leaseUntil;
      record.leaseToken = leaseToken;
      updated.push({ ...record });
      return true;
    },
    async renewLease(keyId: number, leaseUntil: number, leaseToken: string, now: number) {
      const record = keys.find((key) => key.id === keyId);
      if (!record || record.leaseToken !== leaseToken || record.leaseUntil <= now) return false;
      record.leaseUntil = leaseUntil;
      updated.push({ ...record });
      return true;
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
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    it("throws when requesting more keys than are available", async () => {
      const adapter = makeAdapter([
        makeKey(1, "key-a"),
        makeKey(2, "key-b"),
      ]);
      const pool = new KeyPool(adapter);

      await expect(pool.allocate(3)).rejects.toThrow(NoAvailableKeyError);
    });

    it("prefers less-used keys before hotter ones", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const adapter = makeAdapter([
        makeKey(1, "key-hot", { usageCount: 5 }),
        makeKey(2, "key-cold-a", { usageCount: 0 }),
        makeKey(3, "key-cold-b", { usageCount: 0 }),
      ]);
      const pool = new KeyPool(adapter);

      const keys = await pool.allocate(2);

      expect(new Set(keys)).toEqual(new Set(["key-cold-a", "key-cold-b"]));
    });

    it("spreads concurrent single allocations across idle keys before reusing one", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const adapter = makeAdapter([
        makeKey(1, "key-a"),
        makeKey(2, "key-b"),
        makeKey(3, "key-c"),
      ]);
      const pool = new KeyPool(adapter);

      const first = await pool.allocate(1);
      const second = await pool.allocate(1);
      const third = await pool.allocate(1);

      expect(new Set([first[0], second[0], third[0]])).toEqual(
        new Set(["key-a", "key-b", "key-c"])
      );

      await expect(pool.allocate(1)).rejects.toThrow(NoAvailableKeyError);
    });

    it("persists a lease while a key is checked out", async () => {
      const adapter = makeAdapter([makeKey(1, "key-a"), makeKey(2, "key-b")]);
      const pool = new KeyPool(adapter, { allocationLeaseMs: 1_000 });

      const [allocated] = await pool.allocate(1);

      const leasedRecord = adapter.updated.find((record) => record.key === allocated);
      expect(leasedRecord?.leaseUntil ?? 0).toBeGreaterThan(Date.now());
    });

    it("prevents two pool instances sharing one adapter from leasing the same key", async () => {
      const adapter = makeAdapter([makeKey(1, "key-a"), makeKey(2, "key-b")]);
      const firstPool = new KeyPool(adapter);
      const secondPool = new KeyPool(adapter);

      const [first, second] = await Promise.all([
        firstPool.allocate(1),
        secondPool.allocate(1),
      ]);

      expect(new Set([first[0], second[0]])).toEqual(new Set(["key-a", "key-b"]));
    });

    it("refreshes storage state before allocation so persisted usage can rebalance picks", async () => {
      const keys = [makeKey(1, "key-a"), makeKey(2, "key-b")];
      const adapter = {
        async getKeys() {
          return keys.map((key) => ({ ...key }));
        },
        async acquireLease(
          keyId: number,
          leaseUntil: number,
          leaseToken: string,
          now: number
        ) {
          const record = keys.find((item) => item.id === keyId);
          if (!record) return false;
          if (!record.isActive || record.cooldownUntil > now || record.leaseUntil > now) {
            return false;
          }
          record.leaseUntil = leaseUntil;
          record.leaseToken = leaseToken;
          return true;
        },
        async renewLease(keyId: number, leaseUntil: number, leaseToken: string, now: number) {
          const record = keys.find((item) => item.id === keyId);
          if (!record || record.leaseToken !== leaseToken || record.leaseUntil <= now) return false;
          record.leaseUntil = leaseUntil;
          return true;
        },
        async updateKey(key: ApiKey) {
          const idx = keys.findIndex((item) => item.id === key.id);
          if (idx >= 0) keys[idx] = { ...key };
        },
      } satisfies StorageAdapter;
      const pool = new KeyPool(adapter);

      const [first] = await pool.allocate(1);
      await pool.release(first, false);

      const [second] = await pool.allocate(1);

      expect(first).not.toBe(second);
    });

    it("clears leased keys correctly with compare-and-set adapters", async () => {
      const keys = [makeKey(1, "key-a")];
      const adapter = {
        async getKeys() {
          return keys.map((key) => ({ ...key }));
        },
        async acquireLease(
          keyId: number,
          leaseUntil: number,
          leaseToken: string,
          now: number
        ) {
          const record = keys.find((item) => item.id === keyId);
          if (!record) return false;
          if (!record.isActive || record.cooldownUntil > now || record.leaseUntil > now) {
            return false;
          }
          record.leaseUntil = leaseUntil;
          record.leaseToken = leaseToken;
          return true;
        },
        async renewLease(keyId: number, leaseUntil: number, leaseToken: string, now: number) {
          const record = keys.find((item) => item.id === keyId);
          if (!record || record.leaseToken !== leaseToken || record.leaseUntil <= now) return false;
          record.leaseUntil = leaseUntil;
          return true;
        },
        async updateKey(key: ApiKey, expectedLeaseToken?: string | null) {
          const idx = keys.findIndex((item) => item.id === key.id);
          if (idx < 0) return;
          const current = keys[idx];
          const matches =
            (expectedLeaseToken == null && current.leaseToken == null) ||
            current.leaseToken === expectedLeaseToken;
          if (matches) keys[idx] = { ...key };
        },
      } satisfies StorageAdapter;
      const pool = new KeyPool(adapter, { allocationLeaseMs: 1_000 });

      const [first] = await pool.allocate(1);
      await pool.release(first, false);
      const [second] = await pool.allocate(1);

      expect(second).toBe("key-a");
    });
  });

  describe("release (success)", () => {
    it("increments usageCount and persists on success", async () => {
      const record = makeKey(1, "key-a");
      const adapter = makeAdapter([record]);
      const pool = new KeyPool(adapter);

      await pool.allocate(1);
      await pool.release("key-a", false);

      expect(adapter.updated.at(-1)?.usageCount).toBe(1);
      expect(adapter.updated.at(-1)?.cooldownUntil).toBe(0);
      expect(adapter.updated.at(-1)?.leaseUntil).toBe(0);
    });
  });

  describe("release (failure)", () => {
    it("sets cooldown on failure", async () => {
      const record = makeKey(1, "key-a");
      const adapter = makeAdapter([record]);
      const pool = new KeyPool(adapter, { defaultCooldownMs: 60_000 });
      const before = Date.now();

      await pool.allocate(1);
      await pool.release("key-a", true);

      const updatedCooldown = adapter.updated.at(-1)?.cooldownUntil ?? 0;
      expect(updatedCooldown).toBeGreaterThanOrEqual(before + 59_000);
      expect(updatedCooldown).toBeLessThanOrEqual(before + 61_000);
      expect(adapter.updated.at(-1)?.leaseUntil).toBe(0);
    });

    it("uses authCooldownMs for auth failures", async () => {
      const record = makeKey(1, "key-a");
      const adapter = makeAdapter([record]);
      const pool = new KeyPool(adapter, { authCooldownMs: 30 * 60_000 });
      const before = Date.now();

      await pool.allocate(1);
      await pool.release("key-a", true, true);

      const updatedCooldown = adapter.updated.at(-1)?.cooldownUntil ?? 0;
      expect(updatedCooldown).toBeGreaterThanOrEqual(before + 29 * 60_000);
      expect(adapter.updated.at(-1)?.leaseUntil).toBe(0);
    });
  });
});
