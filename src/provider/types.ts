import type { GenerateResponse, GenerateParams } from "../client/types.js";
import type { ProviderCredential } from "./auth/index.js";
import type { ModelDefinition, ProviderCapabilities, ProviderDefinition, ProviderID } from "./schema.js";

export interface ProviderAdapter {
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

export interface RoutePolicy {
  preferredProviders?: ProviderID[];
  fallbackProviders?: ProviderID[];
  preferredModel?: string;
  allowSameProviderCredentialFallback?: boolean;
  allowCrossModelFallback?: boolean;
  allowCrossProviderFallback?: boolean;
  requiredCapabilities?: Partial<ProviderCapabilities>;
}

export interface RoutedProviderSelection {
  provider: ProviderID;
  model: string;
  credentialType: ProviderCredential["type"];
  credentialRef: string;
}
