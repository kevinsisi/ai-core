/**
 * - quota: RESOURCE_EXHAUSTED / 429 — key used up, rotate key
 * - rate-limit: rate limit / 429 — too many requests, rotate key + backoff
 * - network: ECONNREFUSED / ETIMEDOUT — transient, retry same key with backoff
 * - fatal: 401 / 400 — bad key or bad request, do NOT retry
 * - unknown: unrecognized — do NOT retry by default
 */
type ErrorClass = "quota" | "rate-limit" | "network" | "fatal" | "unknown";
interface RetryOptions {
    /** Maximum number of retry attempts after the first failure (default: 3) */
    maxRetries?: number;
    /**
     * Custom error classifier. Overrides the default classifyError logic.
     * Receives the raw error and must return an ErrorClass.
     */
    classifyError?: (error: unknown) => ErrorClass;
    /**
     * Called to obtain a new API key when a quota/rate-limit error occurs.
     * Should throw NoAvailableKeyError if no key is available.
     */
    rotateKey?: () => Promise<string>;
    /**
     * Called after each failed attempt (before retry).
     * Useful for logging or metrics.
     */
    onRetry?: (info: RetryEvent) => void;
    /** Initial backoff for network errors in ms (default: 1000) */
    initialBackoffMs?: number;
    /** Maximum backoff cap for network errors in ms (default: 30_000) */
    maxBackoffMs?: number;
}
interface RetryEvent {
    attempt: number;
    maxRetries: number;
    errorClass: ErrorClass;
    error: unknown;
    newKey?: string;
}
declare class MaxRetriesExceededError extends Error {
    readonly attempts: number;
    readonly lastError: unknown;
    constructor(attempts: number, lastError: unknown);
}

export { type ErrorClass as E, MaxRetriesExceededError as M, type RetryEvent as R, type RetryOptions as a };
