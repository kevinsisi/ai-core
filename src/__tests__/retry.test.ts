import { describe, it, expect, vi } from "vitest";
import { classifyError } from "../retry/classify-error.js";
import { withRetry } from "../retry/with-retry.js";
import { MaxRetriesExceededError } from "../retry/types.js";
import { NoAvailableKeyError } from "../key-pool/types.js";

// ── classifyError ─────────────────────────────────────────────────────

describe("classifyError", () => {
  it("classifies RESOURCE_EXHAUSTED as quota", () => {
    expect(classifyError(new Error("RESOURCE_EXHAUSTED"))).toBe("quota");
  });

  it("classifies quota message as quota", () => {
    expect(classifyError(new Error("quota exceeded"))).toBe("quota");
  });

  it("classifies 429 rate limit as rate-limit", () => {
    expect(classifyError(new Error("429 rate limit"))).toBe("rate-limit");
  });

  it("classifies rate_limit message as rate-limit", () => {
    expect(classifyError(new Error("rate_limit exceeded"))).toBe("rate-limit");
  });

  it("classifies 401 status as fatal", () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    expect(classifyError(err)).toBe("fatal");
  });

  it("classifies 403 status as fatal", () => {
    const err = Object.assign(new Error("Permission denied"), { status: 403 });
    expect(classifyError(err)).toBe("fatal");
  });

  it("classifies API_KEY_INVALID as fatal", () => {
    expect(classifyError(new Error("api_key_invalid"))).toBe("fatal");
  });

  it("classifies suspended as fatal", () => {
    expect(classifyError(new Error("consumer_suspended"))).toBe("fatal");
  });

  it("classifies ECONNREFUSED as network", () => {
    expect(classifyError(new Error("ECONNREFUSED"))).toBe("network");
  });

  it("classifies ETIMEDOUT as network", () => {
    expect(classifyError(new Error("ETIMEDOUT"))).toBe("network");
  });

  it("classifies 500 status as network", () => {
    const err = Object.assign(new Error("Internal Server Error"), {
      status: 500,
    });
    expect(classifyError(err)).toBe("network");
  });

  it("classifies unknown errors as unknown", () => {
    expect(classifyError(new Error("some random error"))).toBe("unknown");
  });
});

// ── withRetry ─────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, "key1");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("key1");
  });

  it("retries on quota error and rotates key", async () => {
    const quotaErr = Object.assign(new Error("RESOURCE_EXHAUSTED"), {
      status: 429,
    });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(quotaErr)
      .mockResolvedValueOnce("ok");

    const rotateKey = vi.fn().mockResolvedValue("key2");
    const result = await withRetry(fn, "key1", { rotateKey });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "key1");
    expect(fn).toHaveBeenNthCalledWith(2, "key2");
    expect(rotateKey).toHaveBeenCalledTimes(1);
  });

  it("retries on rate-limit error and rotates key", async () => {
    const rateLimitErr = new Error("rate_limit exceeded");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce("ok");

    const rotateKey = vi.fn().mockResolvedValue("key2");
    const result = await withRetry(fn, "key1", { rotateKey });

    expect(result).toBe("ok");
    expect(rotateKey).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on fatal error", async () => {
    const fatalErr = Object.assign(new Error("api_key_invalid"), {
      status: 401,
    });
    const fn = vi.fn().mockRejectedValue(fatalErr);

    await expect(withRetry(fn, "key1")).rejects.toThrow(fatalErr);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on unknown error", async () => {
    const unknownErr = new Error("some random error");
    const fn = vi.fn().mockRejectedValue(unknownErr);

    await expect(withRetry(fn, "key1")).rejects.toThrow(unknownErr);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on network error with exponential backoff (mocked sleep)", async () => {
    vi.useFakeTimers();
    const networkErr = new Error("ECONNREFUSED");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, "key1", {
      initialBackoffMs: 100,
      maxBackoffMs: 5000,
    });

    // Advance past the first backoff (100ms)
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws MaxRetriesExceededError after maxRetries exhausted", async () => {
    const quotaErr = new Error("RESOURCE_EXHAUSTED");
    const fn = vi.fn().mockRejectedValue(quotaErr);
    const rotateKey = vi.fn().mockResolvedValue("key2");

    await expect(
      withRetry(fn, "key1", { maxRetries: 2, rotateKey })
    ).rejects.toThrow(MaxRetriesExceededError);

    // 1 initial + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops retry when rotateKey throws NoAvailableKeyError", async () => {
    const quotaErr = new Error("RESOURCE_EXHAUSTED");
    const fn = vi.fn().mockRejectedValue(quotaErr);
    const rotateKey = vi
      .fn()
      .mockRejectedValue(new NoAvailableKeyError());

    await expect(
      withRetry(fn, "key1", { maxRetries: 3, rotateKey })
    ).rejects.toThrow(NoAvailableKeyError);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(rotateKey).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry callback with correct info", async () => {
    const quotaErr = new Error("RESOURCE_EXHAUSTED");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(quotaErr)
      .mockResolvedValueOnce("ok");

    const onRetry = vi.fn();
    const rotateKey = vi.fn().mockResolvedValue("key2");

    await withRetry(fn, "key1", { onRetry, rotateKey });

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        errorClass: "quota",
      })
    );
  });
});
