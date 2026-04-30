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
    baseURL?: string;
    credentialLabel?: string;
}
interface PoolCredential {
    type: "pool";
    provider: ProviderID;
    credentialLabel?: string;
}
type ProviderCredential = ApiKeyCredential | OAuthCredential | PoolCredential;
/**
 * Returns true when the credential's `expiresAt` (if any) is at or past the
 * current time, accounting for `leewayMs` so callers can refresh slightly
 * ahead of the hard expiry. When `expiresAt` is missing or unparseable the
 * credential is treated as not-yet-expired — callers should fall back to a
 * 401-driven refresh in that case.
 *
 * Defaults to a 60-second leeway so a token that expires "right now" while
 * the request is in flight is not considered still-valid.
 */
declare function isOAuthCredentialExpired(credential: OAuthCredential, leewayMs?: number): boolean;

export { type ApiKeyCredential as A, type ModelDefinition as M, type OAuthCredential as O, type PoolCredential as P, type ModelID as a, type ProviderAuthType as b, type ProviderCapabilities as c, type ProviderCredential as d, type ProviderDefinition as e, ProviderID as f, isOAuthCredentialExpired as i };
