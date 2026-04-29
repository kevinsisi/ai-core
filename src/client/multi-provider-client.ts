import { ProviderRouter } from "../provider/router.js";
import type { ProviderAdapter, RoutePolicy, RoutedProviderSelection } from "../provider/types.js";
import type { GenerateParams, GenerateResponse } from "./types.js";

export interface MultiProviderClientOptions {
  adapters: ProviderAdapter[];
  /** Routing policy applied to every call unless overridden per-call. */
  defaultPolicy?: RoutePolicy;
  /**
   * Optional callback fired with the routing selection before the underlying
   * adapter call runs. Useful for telemetry / structured logging without
   * forcing every consumer to use the lower-level ProviderRouter.execute().
   */
  onSelect?: (selection: RoutedProviderSelection, params: GenerateParams) => void;
}

/**
 * Provider-aware client that mirrors GeminiClient's surface area but routes
 * each call through ProviderRouter. Use this when a service needs to swap
 * between OpenAI / OpenRouter / Gemini per request without rewriting the
 * call sites for each provider.
 *
 * Like the underlying router, this client never silently degrades across
 * providers or models — cross-provider / cross-model fallback must be
 * opted into via the routing policy.
 */
export class MultiProviderClient {
  private readonly router: ProviderRouter;
  private readonly defaultPolicy: RoutePolicy;
  private readonly onSelect?: (
    selection: RoutedProviderSelection,
    params: GenerateParams
  ) => void;

  constructor(options: MultiProviderClientOptions) {
    this.router = new ProviderRouter(options.adapters);
    this.defaultPolicy = options.defaultPolicy ?? {};
    this.onSelect = options.onSelect;
  }

  private mergePolicy(policy?: RoutePolicy): RoutePolicy {
    if (!policy) return this.defaultPolicy;
    return { ...this.defaultPolicy, ...policy };
  }

  async generateContent(
    params: GenerateParams,
    policy?: RoutePolicy
  ): Promise<GenerateResponse> {
    const { selection, response } = await this.router.execute(
      params,
      this.mergePolicy(policy)
    );
    this.onSelect?.(selection, params);
    return response;
  }

  async *streamContent(
    params: GenerateParams,
    policy?: RoutePolicy
  ): AsyncGenerator<string, void, unknown> {
    const { selection, stream } = this.router.executeStream(
      params,
      this.mergePolicy(policy)
    );
    this.onSelect?.(selection, params);
    yield* stream;
  }

  /**
   * Escape hatch for callers that need the routing selection alongside the
   * response (e.g. cost attribution, A/B telemetry).
   */
  generateWithSelection(params: GenerateParams, policy?: RoutePolicy) {
    return this.router.execute(params, this.mergePolicy(policy));
  }

  streamWithSelection(params: GenerateParams, policy?: RoutePolicy) {
    return this.router.executeStream(params, this.mergePolicy(policy));
  }

  getRouter(): ProviderRouter {
    return this.router;
  }
}
