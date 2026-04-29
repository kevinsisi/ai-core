import { ProviderID, type ProviderDefinition } from "./schema.js";

const geminiModels = [
  {
    id: "gemini-2.5-flash",
    provider: ProviderID.Gemini,
    name: "Gemini 2.5 Flash",
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: true,
      multimodalInput: true,
      multimodalOutput: false,
    },
    contextWindow: 1_000_000,
    outputLimit: 65_536,
    costTier: "low" as const,
  },
];

const openAIModels = [
  {
    id: "gpt-4.1-mini",
    provider: ProviderID.OpenAI,
    name: "GPT-4.1 mini",
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: false,
      multimodalInput: false,
      multimodalOutput: false,
    },
    contextWindow: 1_000_000,
    outputLimit: 32_768,
    costTier: "medium" as const,
  },
];

const openRouterModels = [
  {
    id: "openrouter/auto",
    provider: ProviderID.OpenRouter,
    name: "OpenRouter Auto",
    capabilities: {
      streaming: true,
      tools: true,
      reasoning: false,
      multimodalInput: false,
      multimodalOutput: false,
    },
    contextWindow: 128_000,
    outputLimit: 32_768,
    costTier: "medium" as const,
  },
];

export const builtInProviders: ProviderDefinition[] = [
  {
    id: ProviderID.OpenAI,
    name: "OpenAI",
    authTypes: ["api"],
    models: openAIModels,
  },
  {
    id: ProviderID.Gemini,
    name: "Gemini",
    authTypes: ["pool"],
    models: geminiModels,
  },
  {
    id: ProviderID.OpenRouter,
    name: "OpenRouter",
    authTypes: ["api"],
    models: openRouterModels,
  },
];

export const defaultProviderPriority = [ProviderID.OpenAI, ProviderID.Gemini] as const;

export function getBuiltInProvider(providerID: string) {
  return builtInProviders.find((provider) => provider.id === providerID);
}

export function getBuiltInModel(modelID: string) {
  for (const provider of builtInProviders) {
    const model = provider.models.find((item) => item.id === modelID);
    if (model) return model;
  }
  return undefined;
}
