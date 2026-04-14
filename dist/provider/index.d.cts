import { G as GenerateParams, b as GenerateResponse } from '../types-DPIsmmhM.cjs';
import { K as KeyPool } from '../key-pool-CQHu-T7W.cjs';
import '@google/generative-ai';

declare const ProviderID: {
    readonly Gemini: "gemini";
    readonly OpenAI: "openai";
};
type ProviderID = (typeof ProviderID)[keyof typeof ProviderID];
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

interface ProviderAdapter {
    readonly provider: ProviderDefinition;
    readonly credential: ProviderCredential;
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    generateContent(params: GenerateParams): Promise<GenerateResponse>;
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

declare class ProviderRouter {
    private readonly adapters;
    constructor(adapters: ProviderAdapter[]);
    select(policy?: RoutePolicy): RoutedProviderSelection;
}

declare class GeminiProviderAdapter implements ProviderAdapter {
    readonly provider: ProviderDefinition;
    readonly credential: PoolCredential;
    private readonly client;
    constructor(pool: KeyPool, maxRetries?: number);
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    generateContent(params: GenerateParams): Promise<GenerateResponse>;
}

declare class OpenAIProviderAdapter implements ProviderAdapter {
    readonly provider: ProviderDefinition;
    readonly credential: ApiKeyCredential;
    constructor(credential: ApiKeyCredential);
    supports(modelID: string): boolean;
    getModel(modelID: string): ModelDefinition | undefined;
    generateContent(params: GenerateParams): Promise<GenerateResponse>;
}

export { type ApiKeyCredential, GeminiProviderAdapter, type ModelDefinition, type ModelID, type OAuthCredential, OpenAIProviderAdapter, type ProviderAdapter, type ProviderAuthType, type ProviderCapabilities, type ProviderCredential, type ProviderDefinition, ProviderID, ProviderRouter, type RoutePolicy, type RoutedProviderSelection, builtInProviders, defaultProviderPriority, getBuiltInModel, getBuiltInProvider };
