import {
  ProviderRouter
} from "./chunk-HKNTXQ2A.js";

// src/client/multi-provider-client.ts
var MultiProviderClient = class {
  router;
  defaultPolicy;
  onSelect;
  constructor(options) {
    this.router = new ProviderRouter(options.adapters);
    this.defaultPolicy = options.defaultPolicy ?? {};
    this.onSelect = options.onSelect;
  }
  mergePolicy(policy) {
    if (!policy) return this.defaultPolicy;
    return { ...this.defaultPolicy, ...policy };
  }
  async generateContent(params, policy) {
    const { selection, response } = await this.router.execute(
      params,
      this.mergePolicy(policy)
    );
    this.onSelect?.(selection, params);
    return response;
  }
  async *streamContent(params, policy) {
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
  generateWithSelection(params, policy) {
    return this.router.execute(params, this.mergePolicy(policy));
  }
  streamWithSelection(params, policy) {
    return this.router.executeStream(params, this.mergePolicy(policy));
  }
  /**
   * Image generation. Routed to the first chain provider whose adapter
   * implements `imageGen`; throws `CapabilityNotSupportedError` when no
   * candidate supports it.
   *
   * The provider-specific options bag (`params.options`) is passed through
   * verbatim — Gemini honors `{ fallbackModel, dedicatedKey }`; other
   * adapters ignore.
   */
  async imageGen(params, policy) {
    const { selection, response } = await this.router.executeImageGen(
      params,
      this.mergePolicy(policy)
    );
    this.onSelect?.(selection, { model: params.model, prompt: params.prompt });
    return response;
  }
  imageGenWithSelection(params, policy) {
    return this.router.executeImageGen(params, this.mergePolicy(policy));
  }
  /**
   * Streaming chat with provider-specific function-call loop. Provider is
   * selected once at the start of the call; mid-loop provider fallback is
   * not supported (chat state lives inside the adapter's session).
   *
   * Caller supplies `ctx.onToolCall` to execute tools the model invokes;
   * the adapter feeds results back into the next round. The loop is capped
   * by `ctx.maxToolRounds` (default 5).
   */
  async *chatWithTools(params, ctx, policy) {
    const { selection, stream } = this.router.executeChatWithTools(
      params,
      ctx,
      this.mergePolicy(policy)
    );
    this.onSelect?.(selection, params);
    yield* stream;
  }
  chatWithToolsAndSelection(params, ctx, policy) {
    return this.router.executeChatWithTools(params, ctx, this.mergePolicy(policy));
  }
  getRouter() {
    return this.router;
  }
};

export {
  MultiProviderClient
};
//# sourceMappingURL=chunk-QFUJCX56.js.map