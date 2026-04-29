import {
  ProviderRouter
} from "./chunk-PWSNKNQE.js";

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
  getRouter() {
    return this.router;
  }
};

export {
  MultiProviderClient
};
//# sourceMappingURL=chunk-UQCO7H7A.js.map