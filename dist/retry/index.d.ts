import { a as RetryOptions, E as ErrorClass } from '../types-xF6t7Rx7.js';
export { M as MaxRetriesExceededError, R as RetryEvent } from '../types-xF6t7Rx7.js';

/**
 * Wrap an async function with Gemini-aware retry logic.
 *
 * @param fn - The function to call, receives the current API key string.
 *             The first key comes from `options.rotateKey()` if provided,
 *             or callers must pass an initial key and handle key injection themselves.
 * @param initialKey - The API key to use for the first attempt.
 * @param options - Retry configuration.
 */
declare function withRetry<T>(fn: (apiKey: string) => Promise<T>, initialKey: string, options?: RetryOptions): Promise<T>;

/**
 * Default Gemini API error classifier.
 * Checks HTTP status codes first (if present), then error message strings.
 *
 * Priority order (important — auth must be checked before rate-limit because
 * some 403 error messages contain the word "rate" in their URL):
 *   1. Fatal (401, 403, 400)
 *   2. Quota / Rate-limit (429, RESOURCE_EXHAUSTED)
 *   3. Network (ECONNREFUSED, ETIMEDOUT, fetch failed)
 *   4. Unknown
 */
declare function classifyError(err: unknown): ErrorClass;

export { ErrorClass, RetryOptions, classifyError, withRetry };
