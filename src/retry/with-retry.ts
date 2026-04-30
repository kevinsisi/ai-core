import { classifyError as defaultClassify } from "./classify-error.js";
import { MaxRetriesExceededError } from "./types.js";
import { NoAvailableKeyError } from "../key-pool/types.js";
import type { RetryOptions } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap an async function with Gemini-aware retry logic.
 *
 * @param fn - The function to call, receives the current API key string.
 *             The first key comes from `options.rotateKey()` if provided,
 *             or callers must pass an initial key and handle key injection themselves.
 * @param initialKey - The API key to use for the first attempt.
 * @param options - Retry configuration.
 */
export async function withRetry<T>(
  fn: (apiKey: string) => Promise<T>,
  initialKey: string,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const classify = options.classifyError ?? defaultClassify;
  const initialBackoff = options.initialBackoffMs ?? 1_000;
  const maxBackoff = options.maxBackoffMs ?? 30_000;

  let currentKey = initialKey;
  let lastError: unknown;

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
        error: err,
      });

      if (attempt >= maxRetries) break;

      switch (errorClass) {
        case "quota":
        case "rate-limit": {
          if (!options.rotateKey) {
            // No key rotation configured — fail immediately
            throw err;
          }
          try {
            currentKey = await options.rotateKey();
            options.onRetry?.({
              attempt: attempt + 1,
              maxRetries,
              errorClass,
              error: err,
              newKey: currentKey,
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
          // Exponential backoff, same key
          const backoff = Math.min(
            initialBackoff * Math.pow(2, attempt),
            maxBackoff
          );
          await sleep(backoff);
          break;
        }

        case "auth":
        case "fatal":
        case "unknown":
          // Never auto-retry these. `auth` is surfaced verbatim so the
          // wrapping consumer (e.g. an OAuth-aware adapter) can refresh and
          // re-issue the call on its own terms; withRetry stays credential-
          // agnostic and does not try to refresh anything itself.
          throw err;
      }
    }
  }

  throw new MaxRetriesExceededError(maxRetries + 1, lastError);
}
