import { G as GenerateParams, b as GenerateResponse } from '../types-DP2JVUqN.js';
import { K as KeyPool } from '../key-pool-CQHu-T7W.js';

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

declare const builtInProviders: ProviderDefinition[];
declare const defaultProviderPriority: readonly ["openai", "gemini"];
declare function getBuiltInProvider(providerID: string): ProviderDefinition | undefined;
declare function getBuiltInModel(modelID: string): ModelDefinition | undefined;
/**
 * Register a custom provider definition. The new id becomes resolvable via
 * `getProvider()` and its models via `getModel()`. Built-in ids cannot be
 * shadowed — callers must pick a distinct id (e.g. "anthropic-direct",
 * "azure-openai-prod").
 */
declare function registerProvider(definition: ProviderDefinition): void;
declare function unregisterProvider(providerID: string): boolean;
/**
 * Visible for testing — wipe every registered custom provider. Built-in
 * providers are not affected.
 */
declare function clearRegisteredProviders(): void;
declare function getProvider(providerID: string): ProviderDefinition | undefined;
declare function getModel(modelID: string): ModelDefinition | undefined;
declare function listRegisteredProviders(): ProviderDefinition[];

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

declare class GeminiProviderAdapter implements ProviderAdapter {
    readonly provider: ProviderDefinition;
    readonly credential: PoolCredential;
    private readonly client;
    constructor(pool: KeyPool, maxRetries?: number);
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    generateContent(params: GenerateParams): Promise<GenerateResponse>;
    streamContent(params: GenerateParams): AsyncGenerator<string, void, unknown>;
}

/**
 * Shared transport for OpenAI-style /chat/completions endpoints.
 *
 * Subclasses provide the provider definition, default base URL, and any
 * additional headers (OpenRouter app attribution, organization scoping, etc.).
 * Tool conversion is keyed off `nativeToolProvider` so each subclass passes
 * through its own `provider-native` tools while still ignoring foreign ones.
 */
declare abstract class OpenAICompatibleAdapter implements ProviderAdapter {
    abstract readonly provider: ProviderDefinition;
    readonly credential: ApiKeyCredential;
    protected abstract readonly defaultBaseURL: string;
    protected abstract readonly nativeToolProvider: string;
    constructor(credential: ApiKeyCredential);
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    protected buildHeaders(): Record<string, string>;
    protected get baseURL(): string;
    private buildRequestBody;
    generateContent(params: GenerateParams): Promise<GenerateResponse>;
    streamContent(params: GenerateParams): AsyncGenerator<string, void, unknown>;
}

declare class OpenAIProviderAdapter extends OpenAICompatibleAdapter {
    readonly provider: ProviderDefinition;
    protected readonly defaultBaseURL = "https://api.openai.com/v1";
    protected readonly nativeToolProvider = "openai";
    constructor(credential: ApiKeyCredential);
    protected buildHeaders(): Record<string, string>;
}

interface OpenRouterAdapterOptions {
    /** Optional list of model definitions to expose beyond the built-in catalog. */
    additionalModels?: ModelDefinition[];
    /** OpenRouter app attribution header (`HTTP-Referer`). */
    referer?: string;
    /** OpenRouter app attribution header (`X-Title`). */
    appTitle?: string;
}
/**
 * OpenRouter exposes an OpenAI-compatible /chat/completions endpoint plus its
 * own catalog of upstream models (anthropic/*, google/*, openai/*, etc.).
 *
 * Consumers usually want models beyond `openrouter/auto`; pass them via
 * `additionalModels` so the router can route to them. The provider definition
 * is shallow-cloned so additions do not leak into the built-in catalog.
 */
declare class OpenRouterProviderAdapter extends OpenAICompatibleAdapter {
    readonly provider: ProviderDefinition;
    protected readonly defaultBaseURL = "https://openrouter.ai/api/v1";
    protected readonly nativeToolProvider = "openrouter";
    private readonly referer?;
    private readonly appTitle?;
    constructor(credential: ApiKeyCredential, options?: OpenRouterAdapterOptions);
    protected buildHeaders(): Record<string, string>;
}

export { type ApiKeyCredential, GeminiProviderAdapter, type ModelDefinition, type ModelID, type OAuthCredential, OpenAICompatibleAdapter, OpenAIProviderAdapter, type OpenRouterAdapterOptions, OpenRouterProviderAdapter, type ProviderAdapter, type ProviderAuthType, type ProviderCapabilities, type ProviderCredential, type ProviderDefinition, ProviderID, ProviderRouter, type RoutePolicy, type RoutedExecution, type RoutedProviderSelection, type RoutedStream, builtInProviders, clearRegisteredProviders, defaultProviderPriority, getBuiltInModel, getBuiltInProvider, getModel, getProvider, listRegisteredProviders, registerProvider, unregisterProvider };
