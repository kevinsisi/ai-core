import { KeyPool, NoAvailableKeyError } from "../key-pool/index.js";
import { withRetry } from "../retry/index.js";
import type { ErrorClass } from "../retry/types.js";
import { LeaseHeartbeat } from "./lease-heartbeat.js";
import { planPreferredKeys } from "./planner.js";
import type {
  AcquireKeyResult,
  ReleaseKeyContext,
  RotateKeyResult,
  RunnableStep,
  StepExecutionResult,
  StepRunnerOptions,
} from "./types.js";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stepName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step \"${stepName}\" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]);
}

export class StepRunner {
  constructor(
    private readonly pool: KeyPool,
    private readonly options: StepRunnerOptions = {}
  ) {}

  async runStep<T>(step: RunnableStep<T>): Promise<StepExecutionResult<T>> {
    const [result] = await this.runSteps([step]);
    return result as StepExecutionResult<T>;
  }

  async runSteps(steps: readonly RunnableStep<unknown>[]): Promise<StepExecutionResult<unknown>[]> {
    const plan = await planPreferredKeys(this.pool, steps);
    const results: StepExecutionResult<unknown>[] = [];

    for (const [index, step] of steps.entries()) {
      const assignment = plan[index];
      const startedAt = Date.now();

      if (assignment.sharedFallbackRequired && !step.allowSharedFallback) {
        throw new NoAvailableKeyError(
          `Step \"${step.name}\" requires shared fallback but allowSharedFallback is false`
        );
      }

      let retryCount = 0;
      let sharedFallbackUsed = assignment.sharedFallbackRequired;
      let finalErrorClass: ErrorClass | null = null;

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
            const result = step.timeoutMs ?? this.options.defaultTimeoutMs
              ? await withTimeout(runPromise, step.timeoutMs ?? this.options.defaultTimeoutMs!, step.name)
              : await runPromise;

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
            },
          }
        );

        await this.releaseKey({
          pool: this.pool,
          step,
          key: currentKey,
          failed: false,
          authFailure: false,
          errorClass: finalErrorClass,
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
            finalErrorClass,
          },
        });
      } catch (error) {
        const authFailure = finalErrorClass === "fatal";
        await this.releaseKey({
          pool: this.pool,
          step,
          key: currentKey,
          failed: true,
          authFailure,
          errorClass: finalErrorClass,
        }).catch(() => {});
        throw error;
      } finally {
        heartbeat.stop();
      }
    }

    return results;
  }

  private async acquireInitialKey(
    step: RunnableStep<unknown>,
    preferredKey: string | null
  ): Promise<AcquireKeyResult> {
    if (this.options.acquireInitialKey) {
      return this.options.acquireInitialKey({
        pool: this.pool,
        step,
        preferredKey,
      });
    }

    const allocation = await this.pool.allocatePreferred(preferredKey, {
      allowFallback: step.allowSharedFallback ?? false,
    });

    return {
      key: allocation.key,
      usedPreferred: allocation.usedPreferred,
      sharedFallbackUsed: Boolean(preferredKey) && !allocation.usedPreferred,
    };
  }

  private async rotateKey(
    step: RunnableStep<unknown>,
    currentKey: string,
    retryCount: number,
    errorClass: ErrorClass | null
  ): Promise<RotateKeyResult> {
    if (!(step.allowSharedFallback ?? false)) {
      throw new NoAvailableKeyError(
        `Step \"${step.name}\" requires key rotation, but shared fallback is disabled`
      );
    }

    if (this.options.rotateKey) {
      const result = await this.options.rotateKey({
        pool: this.pool,
        step,
        currentKey,
        retryCount,
        errorClass,
      });
      return {
        key: result.key,
        sharedFallbackUsed: result.sharedFallbackUsed || result.key !== currentKey,
      };
    }

    await this.pool.release(currentKey, true, errorClass === "fatal");
    const next = await this.pool.allocatePreferred(null, { allowFallback: true });
    return {
      key: next.key,
      sharedFallbackUsed: true,
    };
  }

  private async releaseKey(context: ReleaseKeyContext): Promise<void> {
    if (this.options.releaseKey) {
      return this.options.releaseKey(context);
    }

    await this.pool.release(context.key, context.failed, context.authFailure);
  }

  private normalizeAcquireResult(
    step: RunnableStep<unknown>,
    preferredKey: string | null,
    result: AcquireKeyResult
  ): AcquireKeyResult {
    const usedPreferred = preferredKey ? result.key === preferredKey : false;
    const sharedFallbackUsed = result.sharedFallbackUsed || Boolean(preferredKey) && result.key !== preferredKey;

    if (sharedFallbackUsed && !(step.allowSharedFallback ?? false)) {
      throw new NoAvailableKeyError(
        `Step \"${step.name}\" requires shared fallback but allowSharedFallback is false`
      );
    }

    return {
      key: result.key,
      usedPreferred,
      sharedFallbackUsed,
    };
  }
}
