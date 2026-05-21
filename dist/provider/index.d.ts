import { e as ProviderDefinition, M as ModelDefinition, P as PoolCredential, A as ApiKeyCredential, O as OAuthCredential } from '../types-6qrHJZyy.js';
export { a as ModelID, b as ProviderAuthType, c as ProviderCapabilities, d as ProviderCredential, f as ProviderID, i as isOAuthCredentialExpired } from '../types-6qrHJZyy.js';
export { OpenAIOAuthError, StartOpenAIAuthOptions, refreshOpenAIToken, startOpenAIAuth } from './auth/index.js';
import { P as ProviderAdapter, G as GenerateParams, b as GenerateResponse } from '../router-DeUUXCBT.js';
export { d as ProviderRouter, R as RoutePolicy, h as RoutedExecution, e as RoutedProviderSelection, i as RoutedStream } from '../router-DeUUXCBT.js';
import { K as KeyPool } from '../key-pool-CQHu-T7W.js';

declare const builtInProviders: ProviderDefinition[];
declare const defaultProviderPriority: readonly ["opencode", "gemini", "openai"];
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
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    protected buildHeaders(): Record<string, string>;
}

/**
 * OpenCodeProviderAdapter
 *
 * Connects to an OpenCode server (https://opencode.ai) running in server mode.
 * The server exposes a session-based HTTP API at port 4096. Authentication is
 * managed by the server itself (OAuth tokens stored in auth.json on the server);
 * this adapter only needs the server URL and an optional server password.
 *
 * ## How the OpenCode session API works
 *
 *   POST   /session                          → create session, get { id }
 *   POST   /session/{id}/message             → send message parts, get response parts
 *   DELETE /session/{id}                     → clean up (fire-and-forget)
 *
 * ## Message parts (input)
 *
 *   Text:  { type: "text", text: string }
 *   Image: { type: "file", mime: string, url: "data:<mime>;base64,<b64>", filename?: string }
 *
 * ## Message parts (output)
 *
 *   Text responses appear as parts with type === "text" and synthetic !== true.
 *   Token usage is in the top-level `info.tokens` field.
 *
 * ## Model reference format
 *
 *   OpenCode models are addressed as "<providerID>/<modelID>", e.g.:
 *     "opencode/deepseek-v4-flash-free"   — free zen model, no auth needed
 *     "openai/gpt-5.5"                    — requires OpenAI OAuth on the server
 *     "openai/gpt-4o"                     — requires OpenAI OAuth on the server
 *
 *   Pass these as the `model` field in GenerateParams. The adapter splits on the
 *   first "/" to get providerID and modelID for the API payload.
 *
 * ## Multimodal support
 *
 *   Images are supported when the underlying model supports vision (e.g. gpt-5.5,
 *   gpt-4o). Pass `images` in GenerateParams as InlineImagePart objects. The
 *   adapter converts them to OpenCode file parts with base64 data URLs.
 *
 * ## Conversation history
 *
 *   OpenCode sessions maintain history internally. For multi-turn conversations,
 *   create a persistent session (keep sessionID across calls) and use the
 *   sessionID-aware constructor option. For single-turn use (default), a new
 *   session is created per call and deleted after.
 *
 * ## Server password
 *
 *   If OPENCODE_SERVER_PASSWORD is set on the server, pass it as the `apiKey`
 *   in an ApiKeyCredential with `basicAuth: true`. Leave credential as a
 *   PoolCredential with no key for open servers.
 */

interface OpenCodeModelRef {
    /** The downstream provider id, e.g. "opencode", "openai", "google". */
    providerID: string;
    /** The model id within that provider, e.g. "deepseek-v4-flash-free", "gpt-5.5". */
    id: string;
}
interface OpenCodeAdapterOptions {
    /**
     * Base URL of the OpenCode server, e.g. "http://localhost:4096".
     * Defaults to "http://127.0.0.1:4096".
     */
    baseURL?: string;
    /**
     * OpenCode agent mode. Defaults to "general".
     * Other values: "build", "code", etc.
     */
    agent?: string;
    /** Session title shown in the OpenCode UI. */
    title?: string;
    /**
     * Default model used when the caller does not specify a providerID prefix.
     * e.g. { providerID: "opencode", id: "deepseek-v4-flash-free" }
     */
    defaultModel: OpenCodeModelRef;
    /**
     * Set to true when the server has OPENCODE_SERVER_PASSWORD configured.
     * When true, sends HTTP Basic Auth using "opencode:<apiKey>".
     * When false (default), sends Bearer token or no auth.
     */
    basicAuth?: boolean;
}
type OpenCodeCredential = ApiKeyCredential | OAuthCredential | PoolCredential;
declare class OpenCodeProviderAdapter implements ProviderAdapter {
    readonly provider: ProviderDefinition;
    readonly credential: OpenCodeCredential;
    private readonly baseURL;
    private readonly agent;
    private readonly title;
    private readonly defaultModel;
    private readonly basicAuth;
    constructor(credential: OpenCodeCredential, options: OpenCodeAdapterOptions);
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    generateContent(params: GenerateParams): Promise<GenerateResponse>;
    streamContent(_params: GenerateParams): AsyncGenerator<string, void, unknown>;
    private resolveModel;
    private buildHeaders;
    private createSession;
    private sendMessage;
    private deleteSession;
    private readJson;
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

export { ApiKeyCredential, GeminiProviderAdapter, ModelDefinition, OAuthCredential, OpenAICompatibleAdapter, OpenAIProviderAdapter, type OpenCodeAdapterOptions, type OpenCodeModelRef, OpenCodeProviderAdapter, type OpenRouterAdapterOptions, OpenRouterProviderAdapter, PoolCredential, ProviderAdapter, ProviderDefinition, builtInProviders, clearRegisteredProviders, defaultProviderPriority, getBuiltInModel, getBuiltInProvider, getModel, getProvider, listRegisteredProviders, registerProvider, unregisterProvider };
