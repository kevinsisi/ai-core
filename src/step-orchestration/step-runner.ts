import { KeyPool, NoAvailableKeyError } from "../key-pool/index.js";
import { withRetry } from "../retry/index.js";
import type { ErrorClass } from "../retry/types.js";
import { LeaseHeartbeat } from "./lease-heartbeat.js";
import { planPreferredKeys } from "./planner.js";
import type { RunnableStep, StepExecutionResult, StepRunnerOptions } from "./types.js";

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

      const initialAllocation = await this.pool.allocatePreferred(assignment.preferredKey, {
        allowFallback: step.allowSharedFallback ?? false,
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
              await this.pool.release(currentKey, true);
              retryCount += 1;
              if (!(step.allowSharedFallback ?? false)) {
                throw new NoAvailableKeyError(
                  `Step \"${step.name}\" requires key rotation, but shared fallback is disabled`
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
            },
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
            finalErrorClass,
          },
        });
      } catch (error) {
        const authFailure = finalErrorClass === "fatal";
        await this.pool.release(currentKey, true, authFailure).catch(() => {});
        throw error;
      } finally {
        heartbeat.stop();
      }
    }

    return results;
  }
}
