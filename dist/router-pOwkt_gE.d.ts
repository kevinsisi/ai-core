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
 * Built-in provider id constants. Custom providers may register additional
 * ids via `registerProvider()`; the `ProviderID` type stays open (`string`)
 * so consumers can pass any registered id without widening casts.
 */
declare const ProviderID: {
    readonly Gemini: "gemini";
    readonly OpenAI: "openai";
    readonly OpenRouter: "openrouter";
};
type ProviderID = string;
type ModelID = string;
interface ProviderCapabilities {
    streaming: boolean;
    tools: boolean;
    reasoning: boolean;
    multimodalInput: boolean;
    multimodalOutput: boolean;
}
interface ModelDefinition {
    id: ModelID;
    provider: ProviderID;
    name: string;
    capabilities: ProviderCapabilities;
    contextWindow?: number;
    outputLimit?: number;
    costTier?: "low" | "medium" | "high";
}
interface ProviderDefinition {
    id: ProviderID;
    name: string;
    authTypes: Array<"api" | "oauth" | "pool">;
    models: ModelDefinition[];
}

type ProviderAuthType = "api" | "oauth" | "pool";
interface ApiKeyCredential {
    type: "api";
    provider: ProviderID;
    apiKey: string;
    baseURL?: string;
    organization?: string;
    credentialLabel?: string;
}
interface OAuthCredential {
    type: "oauth";
    provider: ProviderID;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
    credentialLabel?: string;
}
interface PoolCredential {
    type: "pool";
    provider: ProviderID;
    credentialLabel?: string;
}
type ProviderCredential = ApiKeyCredential | OAuthCredential | PoolCredential;

interface ProviderAdapter {
    readonly provider: ProviderDefinition;
    readonly credential: ProviderCredential;
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    generateContent(params: GenerateParams): Promise<GenerateResponse>;
    /**
     * Stream incremental text chunks for a generation. Adapters that cannot
     * stream MUST throw rather than fall back to a buffered response — silent
     * fallback would mask capability mismatches from the router.
     */
    streamContent(params: GenerateParams): AsyncGenerator<string, void, unknown>;
}
interface RoutePolicy {
    preferredProviders?: ProviderID[];
    fallbackProviders?: ProviderID[];
    preferredModel?: string;
    allowSameProviderCredentialFallback?: boolean;
    allowCrossModelFallback?: boolean;
    allowCrossProviderFallback?: boolean;
    requiredCapabilities?: Partial<ProviderCapabilities>;
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
    private selectAdapter;
}

export { type ApiKeyCredential as A, type ChatMessage as C, type FunctionTool as F, type GenerateParams as G, type ModelDefinition as M, type OAuthCredential as O, type ProviderAdapter as P, type RoutePolicy as R, StreamInterruptedError as S, type TokenUsage as T, type ClientOptions as a, type GenerateResponse as b, type ModelID as c, type ProviderAuthType as d, type ProviderCapabilities as e, type ProviderCredential as f, type ProviderDefinition as g, ProviderID as h, type ProviderNativeTool as i, ProviderRouter as j, type RoutedProviderSelection as k, type Tool as l, type RoutedExecution as m, type RoutedStream as n, type PoolCredential as o };
