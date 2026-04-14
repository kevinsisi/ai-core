import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyPool, NoAvailableKeyError } from "../key-pool/index.js";
import type { ApiKey, StorageAdapter } from "../key-pool/index.js";
import { LeaseHeartbeat, StepRunner, planPreferredKeys } from "../step-orchestration/index.js";

function makeKey(id: number, key: string, overrides: Partial<ApiKey> = {}): ApiKey {
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

function makeAdapter(keys: ApiKey[]): StorageAdapter {
  return {
    async getKeys() {
      return keys.map((key) => ({ ...key }));
    },
    async acquireLease(keyId: number, leaseUntil: number, leaseToken: string, now: number) {
      const record = keys.find((key) => key.id === keyId);
      if (!record) return false;
      if (!record.isActive || record.cooldownUntil > now || record.leaseUntil > now) return false;
      record.leaseUntil = leaseUntil;
      record.leaseToken = leaseToken;
      return true;
    },
    async renewLease(keyId: number, leaseUntil: number, leaseToken: string, now: number) {
      const record = keys.find((key) => key.id === keyId);
      if (!record || record.leaseToken !== leaseToken || record.leaseUntil <= now) return false;
      record.leaseUntil = leaseUntil;
      return true;
    },
    async updateKey(key: ApiKey) {
      const index = keys.findIndex((item) => item.id === key.id);
      if (index >= 0) keys[index] = { ...key };
    },
  };
}

describe("step-orchestration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("plans distinct preferred keys when healthy capacity covers all steps", async () => {
    const pool = new KeyPool(makeAdapter([
      makeKey(1, "key-a"),
      makeKey(2, "key-b"),
      makeKey(3, "key-c"),
    ]));

    const plan = await planPreferredKeys(pool, [
      { id: "s1", name: "step-1" },
      { id: "s2", name: "step-2" },
      { id: "s3", name: "step-3" },
    ]);

    expect(new Set(plan.map((item) => item.preferredKey))).toEqual(new Set(["key-a", "key-b", "key-c"]));
    expect(plan.every((item) => item.sharedFallbackRequired === false)).toBe(true);
  });

  it("marks later steps for shared fallback when healthy capacity is insufficient", async () => {
    const pool = new KeyPool(makeAdapter([
      makeKey(1, "key-a"),
      makeKey(2, "key-b"),
    ]));

    const plan = await planPreferredKeys(pool, [
      { id: "s1", name: "step-1" },
      { id: "s2", name: "step-2" },
      { id: "s3", name: "step-3" },
    ]);

    expect(plan[0].sharedFallbackRequired).toBe(false);
    expect(plan[1].sharedFallbackRequired).toBe(false);
    expect(plan[2].sharedFallbackRequired).toBe(true);
    expect(plan[2].preferredKey).toBeNull();
  });

  it("uses the preferred key when it is healthy and leasable", async () => {
    const pool = new KeyPool(makeAdapter([
      makeKey(1, "key-a"),
      makeKey(2, "key-b"),
    ]));

    const runner = new StepRunner(pool);
    const result = await runner.runStep({
      id: "s1",
      name: "step-1",
      preferredKey: "key-b",
      run: async (apiKey) => apiKey,
    });

    expect(result.value).toBe("key-b");
    expect(result.metadata.preferredKeyUsed).toBe(true);
    expect(result.metadata.sharedFallbackUsed).toBe(false);
  });

  it("does not silently fall back to another key when preferred key is unavailable and shared fallback is disabled", async () => {
    const adapter = makeAdapter([
      makeKey(1, "key-a", { leaseUntil: Date.now() + 60_000, leaseToken: "held" }),
      makeKey(2, "key-b"),
    ]);
    const pool = new KeyPool(adapter);
    const runner = new StepRunner(pool);

    await expect(
      runner.runStep({
        id: "s1",
        name: "step-1",
        preferredKey: "key-a",
        run: async (apiKey) => apiKey,
      })
    ).rejects.toThrow(NoAvailableKeyError);
  });

  it("requires explicit shared fallback when the plan runs out of distinct healthy keys", async () => {
    const pool = new KeyPool(makeAdapter([makeKey(1, "key-a")]));
    const runner = new StepRunner(pool);

    await expect(
      runner.runSteps([
        {
          id: "step-1",
          name: "step-1",
          run: async (apiKey) => apiKey,
        },
        {
          id: "step-2",
          name: "step-2",
          run: async (apiKey) => apiKey,
        },
      ])
    ).rejects.toThrow(NoAvailableKeyError);
  });

  it("records retry and shared fallback metadata when a step rotates to another key", async () => {
    const pool = new KeyPool(makeAdapter([
      makeKey(1, "key-a"),
      makeKey(2, "key-b"),
    ]));
    const runner = new StepRunner(pool);

    let calls = 0;
    const result = await runner.runStep({
      id: "step-1",
      name: "step-1",
      preferredKey: "key-a",
      allowSharedFallback: true,
      maxRetries: 1,
      run: async (apiKey) => {
        calls += 1;
        if (calls === 1) {
          expect(apiKey).toBe("key-a");
          throw new Error("RESOURCE_EXHAUSTED");
        }
        return apiKey;
      },
    });

    expect(result.value).toBe("key-b");
    expect(result.metadata.retryCount).toBe(1);
    expect(result.metadata.sharedFallbackUsed).toBe(true);
    expect(result.metadata.keyUsed).toBe("key-b");
    expect(result.metadata.finalErrorClass).toBe("quota");
  });

  it("does not rotate to another key on quota failure when shared fallback is disabled", async () => {
    const pool = new KeyPool(makeAdapter([
      makeKey(1, "key-a"),
      makeKey(2, "key-b"),
    ]));
    const runner = new StepRunner(pool);

    await expect(
      runner.runStep({
        id: "step-1",
        name: "step-1",
        preferredKey: "key-a",
        maxRetries: 1,
        run: async () => {
          throw new Error("RESOURCE_EXHAUSTED");
        },
      })
    ).rejects.toThrow(NoAvailableKeyError);
  });

  it("renews and stops lease heartbeat safely", async () => {
    vi.useFakeTimers();

    const renewLease = vi.fn().mockResolvedValue(true);
    const pool = {
      getAllocationLeaseMs: () => 1_000,
      renewLease,
    } as unknown as KeyPool;

    const heartbeat = new LeaseHeartbeat(pool, "key-a", 200);

    await vi.advanceTimersByTimeAsync(250);
    expect(renewLease).toHaveBeenCalledWith("key-a");

    heartbeat.switchKey("key-b");
    await vi.advanceTimersByTimeAsync(250);
    expect(renewLease).toHaveBeenCalledWith("key-b");

    heartbeat.stop();
    const countAfterStop = renewLease.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(renewLease.mock.calls.length).toBe(countAfterStop);
  });
});
