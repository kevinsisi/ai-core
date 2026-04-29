import { e as ProviderDefinition, d as ProviderCredential, M as ModelDefinition, f as ProviderID, c as ProviderCapabilities } from './types-Dbm33_oG.cjs';

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

export { type ChatMessage as C, type FunctionTool as F, type GenerateParams as G, type ProviderAdapter as P, type RoutePolicy as R, StreamInterruptedError as S, type TokenUsage as T, type ClientOptions as a, type GenerateResponse as b, type ProviderNativeTool as c, ProviderRouter as d, type RoutedProviderSelection as e, type Tool as f, type RoutedExecution as g, type RoutedStream as h };
