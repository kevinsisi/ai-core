import {
  NoAvailableKeyError
} from "./chunk-NHGYIXGT.js";

// src/retry/classify-error.ts
function shapeError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const status = err?.["status"] ?? err?.["httpStatusCode"] ?? 0;
  return { message, lower: message.toLowerCase(), status };
}
function classifyGeminiError(err) {
  const { lower, status } = shapeError(err);
  if (status === 401 || lower.includes("unauthenticated")) {
    return "auth";
  }
  if (status === 400 || status === 403 || lower.includes("api_key_invalid") || lower.includes("permission denied") || lower.includes("suspended") || lower.includes("consumer_suspended") || lower.includes("invalid argument") || lower.includes("invalid_argument")) {
    return "fatal";
  }
  if (status === 429 || lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("rate_limit") || lower.includes("rate limit") || lower.includes("ratelimitexceeded")) {
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
function classifyOpenAIError(err) {
  const { lower, status } = shapeError(err);
  if (status === 401 || lower.includes("token_expired") || lower.includes("expired_token") || lower.includes("invalid_token")) {
    return "auth";
  }
  if (status === 400 || status === 403 || lower.includes("invalid_api_key") || lower.includes("invalid api key") || lower.includes("incorrect api key") || lower.includes("account_deactivated") || lower.includes("permission_denied")) {
    return "fatal";
  }
  if (status === 429 || lower.includes("insufficient_quota") || lower.includes("billing_hard_limit") || lower.includes("quota") || lower.includes("rate_limit_exceeded") || lower.includes("rate limit") || lower.includes("tokens_per_min")) {
    if (lower.includes("insufficient_quota") || lower.includes("quota") || lower.includes("billing_hard_limit")) {
      return "quota";
    }
    return "rate-limit";
  }
  if (status >= 500 || lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("fetch failed") || lower.includes("network") || lower.includes("server_error") || lower.includes("service_unavailable") || lower.includes("internal server")) {
    return "network";
  }
  return "unknown";
}
var classifyError = classifyGeminiError;
var providerClassifiers = /* @__PURE__ */ new Map([
  ["gemini", classifyGeminiError],
  ["openai", classifyOpenAIError],
  ["openrouter", classifyOpenAIError]
]);
function registerProviderClassifier(providerID, classifier) {
  providerClassifiers.set(providerID, classifier);
}
function unregisterProviderClassifier(providerID) {
  return providerClassifiers.delete(providerID);
}
function getProviderClassifier(providerID) {
  return providerClassifiers.get(providerID) ?? classifyError;
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
        case "auth":
        case "fatal":
        case "unknown":
          throw err;
      }
    }
  }
  throw new MaxRetriesExceededError(maxRetries + 1, lastError);
}

export {
  classifyGeminiError,
  classifyOpenAIError,
  classifyError,
  registerProviderClassifier,
  unregisterProviderClassifier,
  getProviderClassifier,
  MaxRetriesExceededError,
  withRetry
};
//# sourceMappingURL=chunk-YUQCRD55.js.map