import type { ApiKeyCredential, OAuthCredential } from "../auth/index.js";
import { getBuiltInProvider } from "../models.js";
import { ProviderID, type ModelDefinition } from "../schema.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";

/**
 * Heuristic match for OpenAI-hosted model ids. Covers the chat families
 * (`gpt-4o`, `gpt-4.1-mini`, `gpt-5`, …) and the reasoning families
 * (`o1`, `o3-mini`, `o4-mini`, …) so the adapter can route to any current or
 * future OpenAI model without requiring an ai-core release per new model.
 *
 * Anything that doesn't match falls back to the curated catalog — the caller
 * still gets the strict no-silent-fallback contract for unrecognised ids.
 */
function isLikelyOpenAIModel(modelID: string): boolean {
  return (
    /^gpt-/i.test(modelID) ||
    /^o[134]([.\-]|$)/i.test(modelID) ||
    /^chatgpt-/i.test(modelID)
  );
}

const REASONING_FAMILIES = /^o[134]([.\-]|$)/i;

function synthesizeOpenAIModel(modelID: string): ModelDefinition {
  return {
    id: modelID,
    provider: ProviderID.OpenAI,
    name: modelID,
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: REASONING_FAMILIES.test(modelID),
      multimodalInput: false,
      multimodalOutput: false,
    },
  };
}

export class OpenAIProviderAdapter extends OpenAICompatibleAdapter {
  readonly provider = getBuiltInProvider("openai")!;

  protected readonly defaultBaseURL = "https://api.openai.com/v1";
  protected readonly nativeToolProvider = "openai";

  constructor(credential: ApiKeyCredential | OAuthCredential) {
    super(credential);
  }

  override supports(modelID: string): boolean {
    return super.supports(modelID) || isLikelyOpenAIModel(modelID);
  }

  override getModel(modelID: string): ModelDefinition | undefined {
    return super.getModel(modelID) ?? (isLikelyOpenAIModel(modelID) ? synthesizeOpenAIModel(modelID) : undefined);
  }

  protected override buildHeaders(): Record<string, string> {
    const headers = super.buildHeaders();
    if (this.credential.type === "api" && this.credential.organization) {
      headers["OpenAI-Organization"] = this.credential.organization;
    }
    return headers;
  }
}
