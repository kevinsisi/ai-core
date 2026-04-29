import { GeminiClient } from "../../client/gemini-client.js";
import type { KeyPool } from "../../key-pool/key-pool.js";
import type { PoolCredential } from "../auth.js";
import { getBuiltInModel, getBuiltInProvider } from "../models.js";
import type { ProviderAdapter } from "../types.js";

export class GeminiProviderAdapter implements ProviderAdapter {
  readonly provider = getBuiltInProvider("gemini")!;

  readonly credential: PoolCredential;

  private readonly client: GeminiClient;

  constructor(pool: KeyPool, maxRetries = 3) {
    this.credential = { type: "pool", provider: "gemini", credentialLabel: "gemini-pool" };
    this.client = new GeminiClient(pool, { maxRetries });
  }

  supports(modelID: string): boolean {
    return this.provider.models.some((model) => model.id === modelID);
  }

  getModel(modelID: string) {
    const model = getBuiltInModel(modelID);
    if (!model || model.provider !== this.provider.id) return undefined;
    return model;
  }

  async generateContent(params: import("../../client/types.js").GenerateParams) {
    return this.client.generateContent(params);
  }

  streamContent(
    params: import("../../client/types.js").GenerateParams
  ): AsyncGenerator<string, void, unknown> {
    return this.client.streamContent(params);
  }
}
