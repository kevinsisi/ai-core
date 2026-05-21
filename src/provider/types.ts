import type {
  ChatEvent,
  ChatToolContext,
  GenerateResponse,
  GenerateParams,
  ImageGenParams,
  ImageGenResponse,
} from "../client/types.js";
import type { ProviderCredential } from "./auth/index.js";
import type { ModelDefinition, ProviderCapabilities, ProviderDefinition, ProviderID } from "./schema.js";

export interface ProviderAdapter {
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

export interface RoutePolicy {
  preferredProviders?: ProviderID[];
  fallbackProviders?: ProviderID[];
  preferredModel?: string;
  allowSameProviderCredentialFallback?: boolean;
  allowCrossModelFallback?: boolean;
  allowCrossProviderFallback?: boolean;
  requiredCapabilities?: Partial<ProviderCapabilities>;
  requiredMethod?: "imageGen" | "chatWithTools";
}

export interface RoutedProviderSelection {
  provider: ProviderID;
  model: string;
  credentialType: ProviderCredential["type"];
  credentialRef: string;
}
