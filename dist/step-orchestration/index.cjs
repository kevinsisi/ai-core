"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/step-orchestration/index.ts
var step_orchestration_exports = {};
__export(step_orchestration_exports, {
  LeaseHeartbeat: () => LeaseHeartbeat,
  StepRunner: () => StepRunner,
  planPreferredKeys: () => planPreferredKeys
});
module.exports = __toCommonJS(step_orchestration_exports);

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

// src/key-pool/types.ts
var NoAvailableKeyError = class extends Error {
  constructor(message = "No available API keys in pool") {
    super(message);
    this.name = "NoAvailableKeyError";
  }
};

// src/retry/classify-error.ts
function classifyError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  const status = err?.["status"] ?? err?.["httpStatusCode"] ?? 0;
  if (status === 401 || status === 400 || status === 403 || lower.includes("api_key_invalid") || lower.includes("permission denied") || lower.includes("suspended") || lower.includes("consumer_suspended") || lower.includes("invalid argument") || lower.includes("invalid_argument")) {
    return "fatal";
  }
  if (status === 429 || lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("rate_limit") || lower.includes("rate limit") || lower.includes("rateLimitExceeded")) {
    if (lower.includes("quota") || lower.includes("resource_exhausted")) {
      return "quota";
    }
    return "rate-limit";
  }
  if (status >= 500 || lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("fetch failed") || lower.includes("network") || lower.includes("503") || lower.includes("500") || lower.includes("unavailable") || lower.includes("internal server")) {
    return "network";
  }
  return "unknown";
}

// src/retry/types.ts
var MaxRetriesExceededError = class extends Error {
  attempts;
  lastError;
  constructor(attempts, lastError) {
    const inner = lastError instanceof Error ? lastError.message : String(lastError);
    super(`Max retries exceeded after ${attempts} attempt(s): ${inner}`);
    this.name = "MaxRetriesExceededError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
};

// src/retry/with-retry.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRetry(fn, initialKey, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const classify = options.classifyError ?? classifyError;
  const initialBackoff = options.initialBackoffMs ?? 1e3;
  const maxBackoff = options.maxBackoffMs ?? 3e4;
  let currentKey = initialKey;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(currentKey);
    } catch (err) {
      lastError = err;
      const errorClass = classify(err);
      options.onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        errorClass,
        error: err
      });
      if (attempt >= maxRetries) break;
      switch (errorClass) {
        case "quota":
        case "rate-limit": {
          if (!options.rotateKey) {
            throw err;
          }
          try {
            currentKey = await options.rotateKey();
            options.onRetry?.({
              attempt: attempt + 1,
              maxRetries,
              errorClass,
              error: err,
              newKey: currentKey
            });
          } catch (rotateErr) {
            if (rotateErr instanceof NoAvailableKeyError) {
              throw rotateErr;
            }
            throw rotateErr;
          }
          break;
        }
        case "network": {
          const backoff = Math.min(
            initialBackoff * Math.pow(2, attempt),
            maxBackoff
          );
          await sleep(backoff);
          break;
        }
        case "fatal":
        case "unknown":
          throw err;
      }
    }
  }
  throw new MaxRetriesExceededError(maxRetries + 1, lastError);
}

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LeaseHeartbeat,
  StepRunner,
  planPreferredKeys
});
//# sourceMappingURL=index.cjs.map