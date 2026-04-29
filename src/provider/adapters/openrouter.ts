import type { ApiKeyCredential } from "../auth/index.js";
import { getBuiltInProvider } from "../models.js";
import type { ModelDefinition } from "../schema.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";

export interface OpenRouterAdapterOptions {
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
export class OpenRouterProviderAdapter extends OpenAICompatibleAdapter {
  readonly provider;

  protected readonly defaultBaseURL = "https://openrouter.ai/api/v1";
  protected readonly nativeToolProvider = "openrouter";

  private readonly referer?: string;
  private readonly appTitle?: string;

  constructor(credential: ApiKeyCredential, options: OpenRouterAdapterOptions = {}) {
    super(credential);
    const base = getBuiltInProvider("openrouter")!;
    this.provider = options.additionalModels?.length
      ? { ...base, models: [...base.models, ...options.additionalModels] }
      : base;
    this.referer = options.referer;
    this.appTitle = options.appTitle;
  }

  protected override buildHeaders(): Record<string, string> {
    return {
      ...super.buildHeaders(),
      ...(this.referer && { "HTTP-Referer": this.referer }),
      ...(this.appTitle && { "X-Title": this.appTitle }),
    };
  }
}
