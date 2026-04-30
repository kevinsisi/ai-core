import { GeminiClient } from "../../client/gemini-client.js";
import type { KeyPool } from "../../key-pool/key-pool.js";
import type { PoolCredential } from "../auth/index.js";
import { getBuiltInModel, getBuiltInProvider } from "../models.js";
import { ProviderID, type ModelDefinition } from "../schema.js";
import type { ProviderAdapter } from "../types.js";

/**
 * Heuristic match for Google Gemini model ids: `gemini-2.5-flash`,
 * `gemini-2.5-pro`, `gemini-3-flash-experimental`, etc. Lets the adapter
 * route to any current or future Gemini model without requiring an ai-core
 * release per new model.
 */
function isLikelyGeminiModel(modelID: string): boolean {
  return /^gemini-/i.test(modelID);
}

function synthesizeGeminiModel(modelID: string): ModelDefinition {
  return {
    id: modelID,
    provider: ProviderID.Gemini,
    name: modelID,
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: false,
    },
  };
}

export class GeminiProviderAdapter implements ProviderAdapter {
  readonly provider = getBuiltInProvider("gemini")!;

  readonly credential: PoolCredential;

  private readonly client: GeminiClient;

  constructor(pool: KeyPool, maxRetries = 3) {
    this.credential = { type: "pool", provider: "gemini", credentialLabel: "gemini-pool" };
    this.client = new GeminiClient(pool, { maxRetries });
  }

  supports(modelID: string): boolean {
    if (this.provider.models.some((model) => model.id === modelID)) return true;
    return isLikelyGeminiModel(modelID);
  }

  getModel(modelID: string): ModelDefinition | undefined {
    const builtIn = getBuiltInModel(modelID);
    if (builtIn && builtIn.provider === this.provider.id) return builtIn;
    if (isLikelyGeminiModel(modelID)) return synthesizeGeminiModel(modelID);
    return undefined;
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
