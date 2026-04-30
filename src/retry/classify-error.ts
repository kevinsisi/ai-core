import type { ErrorClass } from "./types.js";

export type ProviderErrorClassifier = (err: unknown) => ErrorClass;

interface ErrorShape {
  message: string;
  lower: string;
  status: number;
}

function shapeError(err: unknown): ErrorShape {
  const message = err instanceof Error ? err.message : String(err);
  const status: number =
    ((err as Record<string, unknown>)?.["status"] as number) ??
    ((err as Record<string, unknown>)?.["httpStatusCode"] as number) ??
    0;
  return { message, lower: message.toLowerCase(), status };
}

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
export function classifyGeminiError(err: unknown): ErrorClass {
  const { lower, status } = shapeError(err);

  if (status === 401 || lower.includes("unauthenticated")) {
    return "auth";
  }

  if (
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

  if (
    status === 429 ||
    lower.includes("429") ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("rate_limit") ||
    lower.includes("rate limit") ||
    lower.includes("ratelimitexceeded")
  ) {
    if (lower.includes("quota") || lower.includes("resource_exhausted")) {
      return "quota";
    }
    return "rate-limit";
  }

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

/**
 * OpenAI / OpenRouter / Azure OpenAI error classifier.
 *
 * Maps the documented OpenAI error `code` / `type` strings on top of the
 * shared HTTP status heuristic:
 *   - `invalid_api_key`, `account_deactivated`        → fatal
 *   - `insufficient_quota`, `billing_hard_limit_*`    → quota
 *   - `rate_limit_exceeded`, `tokens_per_min_limit*`  → rate-limit
 */
export function classifyOpenAIError(err: unknown): ErrorClass {
  const { lower, status } = shapeError(err);

  // 401 is split out from other auth failures so OAuth callers can refresh
  // the access token and retry, instead of giving up like on a hard fatal.
  // Token-shaped errors that arrive without an explicit status (e.g. fetch
  // surfaced as a string body) are also routed here.
  if (
    status === 401 ||
    lower.includes("token_expired") ||
    lower.includes("expired_token") ||
    lower.includes("invalid_token")
  ) {
    return "auth";
  }

  if (
    status === 400 ||
    status === 403 ||
    lower.includes("invalid_api_key") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("account_deactivated") ||
    lower.includes("permission_denied")
  ) {
    return "fatal";
  }

  if (
    status === 429 ||
    lower.includes("insufficient_quota") ||
    lower.includes("billing_hard_limit") ||
    lower.includes("quota") ||
    lower.includes("rate_limit_exceeded") ||
    lower.includes("rate limit") ||
    lower.includes("tokens_per_min")
  ) {
    if (lower.includes("insufficient_quota") || lower.includes("quota") || lower.includes("billing_hard_limit")) {
      return "quota";
    }
    return "rate-limit";
  }

  if (
    status >= 500 ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("server_error") ||
    lower.includes("service_unavailable") ||
    lower.includes("internal server")
  ) {
    return "network";
  }

  return "unknown";
}

/**
 * Backwards-compatible default classifier. Existing callers that did not
 * tag a provider keep getting the Gemini-tuned behavior they were built on.
 */
export const classifyError: ProviderErrorClassifier = classifyGeminiError;

const providerClassifiers = new Map<string, ProviderErrorClassifier>([
  ["gemini", classifyGeminiError],
  ["openai", classifyOpenAIError],
  ["openrouter", classifyOpenAIError],
]);

export function registerProviderClassifier(
  providerID: string,
  classifier: ProviderErrorClassifier
): void {
  providerClassifiers.set(providerID, classifier);
}

export function unregisterProviderClassifier(providerID: string): boolean {
  return providerClassifiers.delete(providerID);
}

/**
 * Resolve a classifier for the given provider id, falling back to the
 * generic `classifyError` if no provider-specific classifier is registered.
 */
export function getProviderClassifier(providerID: string): ProviderErrorClassifier {
  return providerClassifiers.get(providerID) ?? classifyError;
}
