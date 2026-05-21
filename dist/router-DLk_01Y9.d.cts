import { e as ProviderDefinition, d as ProviderCredential, M as ModelDefinition, f as ProviderID, c as ProviderCapabilities } from './types-ynO_vevS.cjs';

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
/**
 * Provider-agnostic function tool. The `parameters` object is a JSON Schema
 * describing the tool's arguments, in the same shape OpenAI / Anthropic /
 * Gemini all accept under their respective wrappers.
 */
interface FunctionTool {
    type: "function";
    name: string;
    description?: string;
    /** JSON Schema for the function arguments. */
    parameters?: Record<string, unknown>;
}
/**
 * Escape hatch for provider built-ins that have no cross-provider equivalent
 * (e.g. Gemini `googleSearch` grounding, OpenAI `web_search_preview`,
 * code execution sandboxes). The `config` payload is passed through to the
 * upstream provider verbatim — adapters from other providers ignore it.
 */
interface ProviderNativeTool {
    type: "provider-native";
    /** Target provider id this tool only applies to (e.g. "gemini", "openai"). */
    provider: string;
    /** Raw provider-specific payload passed through verbatim. */
    config: Record<string, unknown>;
}
type Tool = FunctionTool | ProviderNativeTool;
interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}
interface GenerateParams {
    /** Model id, e.g. "gemini-2.5-flash", "gpt-4.1-mini". */
    model: string;
    systemInstruction?: string;
    prompt: string;
    /** Optional images to send alongside the prompt (multimodal). */
    images?: ImagePart[];
    /**
     * Provider-agnostic tool declarations. Use FunctionTool for cross-provider
     * function calling; use ProviderNativeTool to opt into a provider-specific
     * built-in (the tool is silently ignored by adapters of other providers).
     */
    tools?: Tool[];
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
    toolCalls?: ToolCall[];
    /** null if the model does not return usage metadata */
    usage: TokenUsage | null;
}
interface ImageGenParams {
    /** Image-capable model id, e.g. "gemini-3-pro-image-preview". */
    model: string;
    prompt: string;
    referenceImages?: ImagePart[];
    options?: {
        /** Gemini: retry once with this model on model-not-found/not-supported errors. */
        fallbackModel?: string;
        /** Gemini: bypass the pool and use this key for a one-off image call. */
        dedicatedKey?: string;
    };
}
interface ImageGenResponse {
    images: Array<{
        mimeType: string;
        data: string;
    }>;
    text?: string;
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
declare class CapabilityNotSupportedError extends Error {
    constructor(provider: string, capability: string);
}
/**
 * Thrown by `chatWithTools` when the model keeps emitting tool calls past
 * `ctx.maxToolRounds`. Caller may catch and retry with a higher cap or
 * a different prompt; default cap is 5.
 */
declare class MaxToolRoundsExceededError extends Error {
    readonly roundsCompleted: number;
    readonly cap: number;
    constructor(roundsCompleted: number, cap: number);
}
/**
 * Discriminated union emitted by `chatWithTools`. Adapters loop internally
 * over tool calls (via `ctx.onToolCall`) and emit:
 *
 *   - `text_delta`: incremental text chunks from the assistant.
 *   - `tool_call`: model wants to invoke a tool; ctx.onToolCall resolves
 *     with the result string, which the adapter feeds back into the next
 *     round automatically.
 *   - `usage`: token usage when the underlying call returns it.
 *   - `done`: terminal event; `fullText` is the accumulated text response.
 */
type ChatEvent = {
    type: "text_delta";
    delta: string;
} | {
    type: "tool_call";
    id: string;
    name: string;
    args: Record<string, unknown>;
} | {
    type: "usage";
    usage: TokenUsage;
} | {
    type: "done";
    fullText: string;
};
interface ChatToolContext {
    /** Caller-supplied tool executor. Return value is fed back to the model. */
    onToolCall?: (call: {
        id: string;
        name: string;
        args: Record<string, unknown>;
    }) => Promise<string>;
    /** Hard cap on tool-call loop iterations. Default 5. */
    maxToolRounds?: number;
}

interface ProviderAdapter {
    readonly provider: ProviderDefinition;
    readonly credential: ProviderCredential;
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    generateContent(params: GenerateParams): Promise<GenerateResponse>;
    imageGen?(params: ImageGenParams): Promise<ImageGenResponse>;
    /**
     * Stream incremental text chunks for a generation. Adapters that cannot
     * stream MUST throw rather than fall back to a buffered response — silent
     * fallback would mask capability mismatches from the router.
     */
    streamContent(params: GenerateParams): AsyncGenerator<string, void, unknown>;
    /**
     * Streaming chat with function-call orchestration. Adapter loops on tool
     * calls internally — caller consumes ChatEvents (`text_delta`, `tool_call`,
     * `usage`, `done`) and supplies the tool executor via `ctx.onToolCall`.
     *
     * Adapters that don't implement this leave the field undefined; the router
     * treats absence as CapabilityNotSupportedError and skips them.
     */
    chatWithTools?(params: GenerateParams, ctx: ChatToolContext): AsyncIterable<ChatEvent>;
}
interface RoutePolicy {
    preferredProviders?: ProviderID[];
    fallbackProviders?: ProviderID[];
    preferredModel?: string;
    allowSameProviderCredentialFallback?: boolean;
    allowCrossModelFallback?: boolean;
    allowCrossProviderFallback?: boolean;
    requiredCapabilities?: Partial<ProviderCapabilities>;
    requiredMethod?: "imageGen" | "chatWithTools";
}
interface RoutedProviderSelection {
    provider: ProviderID;
    model: string;
    credentialType: ProviderCredential["type"];
    credentialRef: string;
}

interface RoutedExecution {
    selection: RoutedProviderSelection;
    response: GenerateResponse;
}
interface RoutedStream {
    selection: RoutedProviderSelection;
    stream: AsyncGenerator<string, void, unknown>;
}
interface RoutedImageGen {
    selection: RoutedProviderSelection;
    response: ImageGenResponse;
}
interface RoutedChat {
    selection: RoutedProviderSelection;
    stream: AsyncIterable<ChatEvent>;
}
declare class ProviderRouter {
    private readonly adapters;
    constructor(adapters: ProviderAdapter[]);
    select(policy?: RoutePolicy): RoutedProviderSelection;
    /**
     * Select an adapter and execute generateContent against it.
     *
     * If the caller did not set `policy.preferredModel`, `params.model` is used
     * as the model preference so the routing target matches the explicit request.
     *
     * No silent provider/model fallback: when the resolved selection picks a
     * different model than the caller asked for, the policy must have opted in
     * via `allowCrossProviderFallback` / `allowCrossModelFallback`.
     */
    execute(params: GenerateParams, policy?: RoutePolicy): Promise<RoutedExecution>;
    /**
     * Mirror of execute() for streaming. Selection runs eagerly so the caller
     * can inspect which provider/model resolved before iterating the stream.
     */
    executeStream(params: GenerateParams, policy?: RoutePolicy): RoutedStream;
    executeChatWithTools(params: GenerateParams, ctx: ChatToolContext, policy?: RoutePolicy): RoutedChat;
    executeImageGen(params: ImageGenParams, policy?: RoutePolicy): Promise<RoutedImageGen>;
    private selectAdapter;
    private selectAdapterCandidates;
    private selectFallbackCandidates;
    private canTryNextCandidate;
}

export { CapabilityNotSupportedError as C, type FunctionTool as F, type GenerateParams as G, type ImageGenParams as I, MaxToolRoundsExceededError as M, type ProviderAdapter as P, type RoutePolicy as R, StreamInterruptedError as S, type TokenUsage as T, type ChatEvent as a, type ChatMessage as b, type ChatToolContext as c, type ClientOptions as d, type GenerateResponse as e, type ImageGenResponse as f, type ProviderNativeTool as g, ProviderRouter as h, type RoutedProviderSelection as i, type Tool as j, type ToolCall as k, type RoutedExecution as l, type RoutedStream as m, type RoutedImageGen as n, type RoutedChat as o };
