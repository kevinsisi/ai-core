import { K as KeyPool } from '../key-pool-CQHu-T7W.js';
import * as _google_generative_ai from '@google/generative-ai';

interface ChatMessage {
    role: "user" | "model";
    parts: string;
}
/** Base64-encoded image sent inline with the request. */
interface InlineImagePart {
    type: "inline";
    /** MIME type, e.g. "image/png", "image/jpeg" */
    mimeType: string;
    /** Base64-encoded image data */
    data: string;
}
/** Image loaded from a local file path (read and base64-encoded automatically). */
interface FileImagePart {
    type: "file";
    /** MIME type, e.g. "image/png", "image/jpeg" */
    mimeType: string;
    /** Absolute or relative path to the image file */
    filePath: string;
}
type ImagePart = InlineImagePart | FileImagePart;
interface GenerateParams {
    /** Gemini model name, e.g. "gemini-2.5-flash" */
    model: string;
    systemInstruction?: string;
    prompt: string;
    /** Optional images to send alongside the prompt (multimodal). */
    images?: ImagePart[];
    /**
     * Optional Gemini tool declarations (e.g., Google Search grounding).
     * Passed directly to `getGenerativeModel()`.
     */
    tools?: _google_generative_ai.Tool[];
    history?: ChatMessage[];
    maxOutputTokens?: number;
}
interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}
interface GenerateResponse {
    text: string;
    /** null if the model does not return usage metadata */
    usage: TokenUsage | null;
}
interface ClientOptions {
    /** Number of retry attempts on transient errors (default: 3) */
    maxRetries?: number;
}
declare class StreamInterruptedError extends Error {
    readonly chunksReceived: number;
    constructor(chunksReceived: number, cause?: unknown);
}

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

export { type ChatMessage, type ClientOptions, GeminiClient, type GenerateParams, type GenerateResponse, StreamInterruptedError, type TokenUsage };
