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
      const initialAllocation = await this.pool.allocatePreferred(assignment.preferredKey, {
        allowFallback: step.allowSharedFallback ?? false
      });
      let currentKey = initialAllocation.key;
      if (assignment.preferredKey && !initialAllocation.usedPreferred) {
        sharedFallbackUsed = true;
      }
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
              await this.pool.release(currentKey, true);
              retryCount += 1;
              if (!(step.allowSharedFallback ?? false)) {
                throw new NoAvailableKeyError(
                  `Step "${step.name}" requires key rotation, but shared fallback is disabled`
                );
              }
              const next = await this.pool.allocatePreferred(null, { allowFallback: true });
              sharedFallbackUsed = true;
              currentKey = next.key;
              heartbeat.switchKey(currentKey);
              return currentKey;
            },
            onRetry: (info) => {
              finalErrorClass = info.errorClass;
            }
          }
        );
        await this.pool.release(currentKey, false);
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
        await this.pool.release(currentKey, true, authFailure).catch(() => {
        });
        throw error;
      } finally {
        heartbeat.stop();
      }
    }
    return results;
  }
};

export {
  planPreferredKeys,
  LeaseHeartbeat,
  StepRunner
};
//# sourceMappingURL=chunk-CDZZRLEW.js.map