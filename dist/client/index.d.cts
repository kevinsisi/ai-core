import { K as KeyPool } from '../key-pool-CQHu-T7W.cjs';
import { a as ClientOptions, G as GenerateParams, b as GenerateResponse } from '../types-DPIsmmhM.cjs';
export { C as ChatMessage, S as StreamInterruptedError, T as TokenUsage } from '../types-DPIsmmhM.cjs';
import '@google/generative-ai';

/**
 * Thin wrapper around @google/generative-ai that handles:
 * - Key allocation and release via KeyPool
 * - Retry + key rotation via withRetry
 * - Usage tracking (returned in response, caller decides what to do with it)
 * - Multimodal content (text + images) via GenerateParams.images
 */
declare class GeminiClient {
    private readonly pool;
    private readonly maxRetries;
    constructor(pool: KeyPool, options?: ClientOptions);
    private startLeaseHeartbeat;
    /**
     * Generate content (non-streaming).
     * Automatically allocates a key, calls Gemini, releases the key.
     */
    generateContent(params: GenerateParams): Promise<GenerateResponse>;
    /**
     * Generate content as a stream.
     * Yields text chunks as they arrive.
     *
     * @throws StreamInterruptedError if the stream is interrupted mid-way.
     */
    streamContent(params: GenerateParams): AsyncGenerator<string, void, unknown>;
}

export { ClientOptions, GeminiClient, GenerateParams, GenerateResponse };
