import { e as ProviderDefinition, M as ModelDefinition, P as PoolCredential, A as ApiKeyCredential, O as OAuthCredential } from '../types-Dbm33_oG.js';
export { a as ModelID, b as ProviderAuthType, c as ProviderCapabilities, d as ProviderCredential, f as ProviderID } from '../types-Dbm33_oG.js';
export { OpenAIOAuthError, StartOpenAIAuthOptions, refreshOpenAIToken, startOpenAIAuth } from './auth/index.js';
import { P as ProviderAdapter, G as GenerateParams, b as GenerateResponse } from '../router-J1UJIOJ8.js';
export { d as ProviderRouter, R as RoutePolicy, g as RoutedExecution, e as RoutedProviderSelection, h as RoutedStream } from '../router-J1UJIOJ8.js';
import { K as KeyPool } from '../key-pool-CQHu-T7W.js';

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

type OpenAICompatibleCredential = ApiKeyCredential | OAuthCredential;
/**
 * Shared transport for OpenAI-style /chat/completions endpoints.
 *
 * Subclasses provide the provider definition, default base URL, and any
 * additional headers (OpenRouter app attribution, organization scoping, etc.).
 * Tool conversion is keyed off `nativeToolProvider` so each subclass passes
 * through its own `provider-native` tools while still ignoring foreign ones.
 *
 * Accepts either an api-key or an OAuth credential — the bearer token is
 * sourced from `apiKey` for api credentials and `accessToken` for oauth ones.
 */
declare abstract class OpenAICompatibleAdapter implements ProviderAdapter {
    abstract readonly provider: ProviderDefinition;
    readonly credential: OpenAICompatibleCredential;
    protected abstract readonly defaultBaseURL: string;
    protected abstract readonly nativeToolProvider: string;
    constructor(credential: OpenAICompatibleCredential);
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    protected get bearerToken(): string;
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
    constructor(credential: ApiKeyCredential | OAuthCredential);
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

export { ApiKeyCredential, GeminiProviderAdapter, ModelDefinition, OAuthCredential, OpenAICompatibleAdapter, OpenAIProviderAdapter, type OpenRouterAdapterOptions, OpenRouterProviderAdapter, PoolCredential, ProviderAdapter, ProviderDefinition, builtInProviders, clearRegisteredProviders, defaultProviderPriority, getBuiltInModel, getBuiltInProvider, getModel, getProvider, listRegisteredProviders, registerProvider, unregisterProvider };
