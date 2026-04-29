/**
 * Built-in provider id constants. Custom providers may register additional
 * ids via `registerProvider()`; the `ProviderID` type stays open (`string`)
 * so consumers can pass any registered id without widening casts.
 */
export const ProviderID = {
  Gemini: "gemini",
  OpenAI: "openai",
  OpenRouter: "openrouter",
} as const;

export type ProviderID = string;

export type ModelID = string;

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  reasoning: boolean;
  multimodalInput: boolean;
  multimodalOutput: boolean;
}

export interface ModelDefinition {
  id: ModelID;
  provider: ProviderID;
  name: string;
  capabilities: ProviderCapabilities;
  contextWindow?: number;
  outputLimit?: number;
  costTier?: "low" | "medium" | "high";
}

export interface ProviderDefinition {
  id: ProviderID;
  name: string;
  authTypes: Array<"api" | "oauth" | "pool">;
  models: ModelDefinition[];
}
