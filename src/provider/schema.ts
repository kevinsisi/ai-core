export const ProviderID = {
  Gemini: "gemini",
  OpenAI: "openai",
} as const;

export type ProviderID = (typeof ProviderID)[keyof typeof ProviderID];

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
