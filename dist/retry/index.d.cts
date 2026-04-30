import { a as RetryOptions, E as ErrorClass } from '../types-B0cltQlw.cjs';
export { M as MaxRetriesExceededError, R as RetryEvent } from '../types-B0cltQlw.cjs';

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

type ProviderErrorClassifier = (err: unknown) => ErrorClass;
/**
 * Gemini API error classifier.
 *
 * Priority order (important — auth must be checked before rate-limit because
 * some 403 error messages contain the word "rate" in their URL):
 *   1. Fatal (401, 403, 400)
 *   2. Quota / Rate-limit (429, RESOURCE_EXHAUSTED)
 *   3. Network (ECONNREFUSED, ETIMEDOUT, 5xx, fetch failed)
 *   4. Unknown
 */
declare function classifyGeminiError(err: unknown): ErrorClass;
/**
 * OpenAI / OpenRouter / Azure OpenAI error classifier.
 *
 * Maps the documented OpenAI error `code` / `type` strings on top of the
 * shared HTTP status heuristic:
 *   - `invalid_api_key`, `account_deactivated`        → fatal
 *   - `insufficient_quota`, `billing_hard_limit_*`    → quota
 *   - `rate_limit_exceeded`, `tokens_per_min_limit*`  → rate-limit
 */
declare function classifyOpenAIError(err: unknown): ErrorClass;
/**
 * Backwards-compatible default classifier. Existing callers that did not
 * tag a provider keep getting the Gemini-tuned behavior they were built on.
 */
declare const classifyError: ProviderErrorClassifier;
declare function registerProviderClassifier(providerID: string, classifier: ProviderErrorClassifier): void;
declare function unregisterProviderClassifier(providerID: string): boolean;
/**
 * Resolve a classifier for the given provider id, falling back to the
 * generic `classifyError` if no provider-specific classifier is registered.
 */
declare function getProviderClassifier(providerID: string): ProviderErrorClassifier;

export { ErrorClass, type ProviderErrorClassifier, RetryOptions, classifyError, classifyGeminiError, classifyOpenAIError, getProviderClassifier, registerProviderClassifier, unregisterProviderClassifier, withRetry };
