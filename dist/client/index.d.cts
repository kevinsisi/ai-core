import { K as KeyPool } from '../key-pool-CQHu-T7W.cjs';
import { a as ClientOptions, G as GenerateParams, b as GenerateResponse, P as ProviderAdapter, R as RoutePolicy, k as RoutedProviderSelection, m as RoutedExecution, n as RoutedStream, j as ProviderRouter, l as Tool } from '../router-pOwkt_gE.cjs';
export { C as ChatMessage, F as FunctionTool, i as ProviderNativeTool, S as StreamInterruptedError, T as TokenUsage } from '../router-pOwkt_gE.cjs';
import { Tool as Tool$1 } from '@google/generative-ai';

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

interface MultiProviderClientOptions {
    adapters: ProviderAdapter[];
    /** Routing policy applied to every call unless overridden per-call. */
    defaultPolicy?: RoutePolicy;
    /**
     * Optional callback fired with the routing selection before the underlying
     * adapter call runs. Useful for telemetry / structured logging without
     * forcing every consumer to use the lower-level ProviderRouter.execute().
     */
    onSelect?: (selection: RoutedProviderSelection, params: GenerateParams) => void;
}
/**
 * Provider-aware client that mirrors GeminiClient's surface area but routes
 * each call through ProviderRouter. Use this when a service needs to swap
 * between OpenAI / OpenRouter / Gemini per request without rewriting the
 * call sites for each provider.
 *
 * Like the underlying router, this client never silently degrades across
 * providers or models — cross-provider / cross-model fallback must be
 * opted into via the routing policy.
 */
declare class MultiProviderClient {
    private readonly router;
    private readonly defaultPolicy;
    private readonly onSelect?;
    constructor(options: MultiProviderClientOptions);
    private mergePolicy;
    generateContent(params: GenerateParams, policy?: RoutePolicy): Promise<GenerateResponse>;
    streamContent(params: GenerateParams, policy?: RoutePolicy): AsyncGenerator<string, void, unknown>;
    /**
     * Escape hatch for callers that need the routing selection alongside the
     * response (e.g. cost attribution, A/B telemetry).
     */
    generateWithSelection(params: GenerateParams, policy?: RoutePolicy): Promise<RoutedExecution>;
    streamWithSelection(params: GenerateParams, policy?: RoutePolicy): RoutedStream;
    getRouter(): ProviderRouter;
}

/**
 * Convert provider-agnostic Tool[] into Gemini's Tool[] shape.
 *
 * - All FunctionTool entries are grouped into a single `functionDeclarations` block.
 * - ProviderNativeTool entries with provider="gemini" are spread in as-is
 *   (their `config` payload is treated as a literal Gemini Tool, e.g.
 *   `{ googleSearch: {} }`).
 * - ProviderNativeTool entries targeting other providers are skipped.
 *
 * Returns `undefined` (not `[]`) when no Gemini-applicable tool is present, so
 * callers can omit the `tools` field from `getGenerativeModel()` entirely.
 */
declare function toGeminiTools(tools: Tool[] | undefined): Tool$1[] | undefined;
/**
 * Convert provider-agnostic Tool[] into OpenAI Chat Completions `tools` shape.
 *
 * - FunctionTool entries map to `{ type: "function", function: { name, description, parameters } }`.
 * - ProviderNativeTool entries whose `provider` matches `nativeToolProvider`
 *   are spread in as-is (config is treated as a literal OpenAI-shape entry).
 * - ProviderNativeTool entries targeting any other provider are skipped.
 *
 * The `nativeToolProvider` parameter lets OpenAI-compatible transports
 * (OpenRouter, Azure OpenAI, etc.) accept their own native escape hatch
 * without picking up tools intended for upstream OpenAI.
 */
declare function toOpenAITools(tools: Tool[] | undefined, nativeToolProvider?: string): Array<Record<string, unknown>> | undefined;

export { ClientOptions, GeminiClient, GenerateParams, GenerateResponse, MultiProviderClient, type MultiProviderClientOptions, Tool, toGeminiTools, toOpenAITools };
