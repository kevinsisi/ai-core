import type { ErrorClass } from "./types.js";

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
export function classifyError(err: unknown): ErrorClass {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  const status: number =
    (err as Record<string, unknown>)?.["status"] as number ??
    (err as Record<string, unknown>)?.["httpStatusCode"] as number ??
    0;

  // 1. Fatal — bad key or bad request
  if (
    status === 401 ||
    status === 400 ||
    status === 403 ||
    lower.includes("api_key_invalid") ||
    lower.includes("permission denied") ||
    lower.includes("suspended") ||
    lower.includes("consumer_suspended") ||
    lower.includes("invalid argument") ||
    lower.includes("invalid_argument")
  ) {
    return "fatal";
  }

  // 2. Quota / Rate-limit
  if (
    status === 429 ||
    lower.includes("429") ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("rate_limit") ||
    lower.includes("rate limit") ||
    lower.includes("rateLimitExceeded")
  ) {
    // Differentiate quota exhaustion vs transient rate limiting
    if (
      lower.includes("quota") ||
      lower.includes("resource_exhausted")
    ) {
      return "quota";
    }
    return "rate-limit";
  }

  // 3. Network / transient server errors
  if (
    status >= 500 ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("503") ||
    lower.includes("500") ||
    lower.includes("unavailable") ||
    lower.includes("internal server")
  ) {
    return "network";
  }

  return "unknown";
}
