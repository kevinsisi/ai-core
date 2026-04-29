import {
  withRetry
} from "./chunk-6YVUQYI5.js";
import {
  NoAvailableKeyError
} from "./chunk-NHGYIXGT.js";

// src/step-orchestration/planner.ts
function rankHealthyKeys(keys) {
  return [...keys].sort((a, b) => {
    if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount;
    if (a.cooldownUntil !== b.cooldownUntil) return a.cooldownUntil - b.cooldownUntil;
    if (a.leaseUntil !== b.leaseUntil) return a.leaseUntil - b.leaseUntil;
    return a.id - b.id;
  });
}
async function planPreferredKeys(pool, steps) {
  const now = Date.now();
  const healthyKeys = rankHealthyKeys(
    (await pool.status()).filter(
      (key) => key.isActive && key.cooldownUntil <= now && key.leaseUntil <= now
    )
  );
  const unusedHealthyKeys = [...healthyKeys];
  return steps.map((step) => {
    if (step.preferredKey) {
      const explicitPreferred = unusedHealthyKeys.find((key) => key.key === step.preferredKey);
      if (explicitPreferred) {
        const index = unusedHealthyKeys.findIndex((key) => key.key === explicitPreferred.key);
        if (index >= 0) unusedHealthyKeys.splice(index, 1);
        return {
          stepId: step.id,
          stepName: step.name,
          preferredKey: explicitPreferred.key,
          sharedFallbackRequired: false
        };
      }
      return {
        stepId: step.id,
        stepName: step.name,
        preferredKey: step.preferredKey,
        sharedFallbackRequired: true
      };
    }
    const nextHealthy = unusedHealthyKeys.shift();
    if (nextHealthy) {
      return {
        stepId: step.id,
        stepName: step.name,
        preferredKey: nextHealthy.key,
        sharedFallbackRequired: false
      };
    }
    return {
      stepId: step.id,
      stepName: step.name,
      preferredKey: null,
      sharedFallbackRequired: true
    };
  });
}

// src/step-orchestration/lease-heartbeat.ts
var LeaseHeartbeat = class {
  constructor(pool, apiKey, intervalMs) {
    this.pool = pool;
    this.currentKey = apiKey;
    this.intervalMs = intervalMs ?? Math.max(250, Math.min(6e4, Math.floor(pool.getAllocationLeaseMs() / 2)));
    this.start();
  }
  pool;
  timer = null;
  leaseError = null;
  currentKey;
  intervalMs;
  start() {
    this.stop();
    this.leaseError = null;
    this.timer = setInterval(() => {
      this.pool.renewLease(this.currentKey).then((renewed) => {
        if (!renewed) {
          this.leaseError = new Error(`Lost key lease for ${this.currentKey}`);
          this.stop();
        }
      }).catch((error) => {
        this.leaseError = error instanceof Error ? error : new Error(String(error));
        this.stop();
      });
    }, this.intervalMs);
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }
  switchKey(apiKey) {
    if (apiKey === this.currentKey) return;
    this.currentKey = apiKey;
    this.start();
  }
  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
  getError() {
    return this.leaseError;
  }
};

// src/step-orchestration/step-runner.ts
function withTimeout(promise, timeoutMs, stepName) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step "${stepName}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    })
  ]);
}
var StepRunner = class {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.options = options;
  }
  pool;
  options;
  async runStep(step) {
    const [result] = await this.runSteps([step]);
    return result;
  }
  async runSteps(steps) {
    const plan = await planPreferredKeys(this.pool, steps);
    const results = [];
    for (const [index, step] of steps.entries()) {
      const assignment = plan[index];
      const startedAt = Date.now();
      if (assignment.sharedFallbackRequired && !step.allowSharedFallback) {
        throw new NoAvailableKeyError(
          `Step "${step.name}" requires shared fallback but allowSharedFallback is false`
        );
      }
      let retryCount = 0;
      let sharedFallbackUsed = assignment.sharedFallbackRequired;
      let finalErrorClass = null;
      const initialAllocation = this.normalizeAcquireResult(
        step,
        assignment.preferredKey,
        await this.acquireInitialKey(step, assignment.preferredKey)
      );
      let currentKey = initialAllocation.key;
      sharedFallbackUsed = sharedFallbackUsed || initialAllocation.sharedFallbackUsed;
      const heartbeat = new LeaseHeartbeat(this.pool, currentKey);
      try {
        const value = await withRetry(
          async (apiKey) => {
            currentKey = apiKey;
            heartbeat.switchKey(apiKey);
            const leaseError = heartbeat.getError();
            if (leaseError) throw leaseError;
            const runPromise = step.run(apiKey);
            const result = step.timeoutMs ?? this.options.defaultTimeoutMs ? await withTimeout(runPromise, step.timeoutMs ?? this.options.defaultTimeoutMs, step.name) : await runPromise;
            const postCallLeaseError = heartbeat.getError();
            if (postCallLeaseError) throw postCallLeaseError;
            return result;
          },
          currentKey,
          {
            maxRetries: step.maxRetries ?? this.options.maxRetries ?? 3,
            initialBackoffMs: this.options.initialBackoffMs,
            maxBackoffMs: this.options.maxBackoffMs,
            rotateKey: async () => {
              retryCount += 1;
              const next = await this.rotateKey(step, currentKey, retryCount, finalErrorClass);
              sharedFallbackUsed = sharedFallbackUsed || next.sharedFallbackUsed;
              currentKey = next.key;
              heartbeat.switchKey(currentKey);
              return currentKey;
            },
            onRetry: (info) => {
              finalErrorClass = info.errorClass;
            }
          }
        );
        await this.releaseKey({
          pool: this.pool,
          step,
          key: currentKey,
          failed: false,
          authFailure: false,
          errorClass: finalErrorClass
        });
        results.push({
          value,
          metadata: {
            stepId: step.id,
            stepName: step.name,
            preferredKey: assignment.preferredKey,
            keyUsed: currentKey,
            preferredKeyUsed: assignment.preferredKey === currentKey,
            sharedFallbackUsed,
            retryCount,
            durationMs: Date.now() - startedAt,
            finalErrorClass
          }
        });
      } catch (error) {
        const authFailure = finalErrorClass === "fatal";
        await this.releaseKey({
          pool: this.pool,
          step,
          key: currentKey,
          failed: true,
          authFailure,
          errorClass: finalErrorClass
        }).catch(() => {
        });
        throw error;
      } finally {
        heartbeat.stop();
      }
    }
    return results;
  }
  async acquireInitialKey(step, preferredKey) {
    if (this.options.acquireInitialKey) {
      return this.options.acquireInitialKey({
        pool: this.pool,
        step,
        preferredKey
      });
    }
    const allocation = await this.pool.allocatePreferred(preferredKey, {
      allowFallback: step.allowSharedFallback ?? false
    });
    return {
      key: allocation.key,
      usedPreferred: allocation.usedPreferred,
      sharedFallbackUsed: Boolean(preferredKey) && !allocation.usedPreferred
    };
  }
  async rotateKey(step, currentKey, retryCount, errorClass) {
    if (!(step.allowSharedFallback ?? false)) {
      throw new NoAvailableKeyError(
        `Step "${step.name}" requires key rotation, but shared fallback is disabled`
      );
    }
    if (this.options.rotateKey) {
      const result = await this.options.rotateKey({
        pool: this.pool,
        step,
        currentKey,
        retryCount,
        errorClass
      });
      return {
        key: result.key,
        sharedFallbackUsed: result.sharedFallbackUsed || result.key !== currentKey
      };
    }
    await this.pool.release(currentKey, true, errorClass === "fatal");
    const next = await this.pool.allocatePreferred(null, { allowFallback: true });
    return {
      key: next.key,
      sharedFallbackUsed: true
    };
  }
  async releaseKey(context) {
    if (this.options.releaseKey) {
      return this.options.releaseKey(context);
    }
    await this.pool.release(context.key, context.failed, context.authFailure);
  }
  normalizeAcquireResult(step, preferredKey, result) {
    const usedPreferred = preferredKey ? result.key === preferredKey : false;
    const sharedFallbackUsed = result.sharedFallbackUsed || Boolean(preferredKey) && result.key !== preferredKey;
    if (sharedFallbackUsed && !(step.allowSharedFallback ?? false)) {
      throw new NoAvailableKeyError(
        `Step "${step.name}" requires shared fallback but allowSharedFallback is false`
      );
    }
    return {
      key: result.key,
      usedPreferred,
      sharedFallbackUsed
    };
  }
};

export {
  planPreferredKeys,
  LeaseHeartbeat,
  StepRunner
};
//# sourceMappingURL=chunk-RM5CSKXD.js.map