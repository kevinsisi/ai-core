import type { Tool as GeminiTool } from "@google/generative-ai";
import type { Tool } from "./types.js";

/**
 * Convert provider-agnostic Tool[] into Gemini's Tool[] shape.
 *
 * - All FunctionTool entries are grouped into a single `functionDeclarations` block.
 * - ProviderNativeTool entries with provider="gemini" are spread in as-is
 *   (their `config` payload is treated as a literal Gemini Tool, e.g.
 *   `{ googleSearch: {} }`).
 * - ProviderNativeTool entries targeting other providers are skipped.
 *
 * Returns `undefined` (not `[]`) when no Gemini-applicable tool is present, so
 * callers can omit the `tools` field from `getGenerativeModel()` entirely.
 */
export function toGeminiTools(tools: Tool[] | undefined): GeminiTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const functionDeclarations: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }> = [];
  const passThrough: GeminiTool[] = [];

  for (const tool of tools) {
    if (tool.type === "function") {
      functionDeclarations.push({
        name: tool.name,
        ...(tool.description !== undefined && { description: tool.description }),
        ...(tool.parameters !== undefined && { parameters: tool.parameters }),
      });
    } else if (tool.type === "provider-native" && tool.provider === "gemini") {
      passThrough.push(tool.config as unknown as GeminiTool);
    }
  }

  const result: GeminiTool[] = [];
  if (functionDeclarations.length > 0) {
    result.push({ functionDeclarations } as unknown as GeminiTool);
  }
  result.push(...passThrough);

  return result.length > 0 ? result : undefined;
}

/**
 * Convert provider-agnostic Tool[] into OpenAI Chat Completions `tools` shape.
 *
 * - FunctionTool entries map to `{ type: "function", function: { name, description, parameters } }`.
 * - ProviderNativeTool entries whose `provider` matches `nativeToolProvider`
 *   are spread in as-is (config is treated as a literal OpenAI-shape entry).
 * - ProviderNativeTool entries targeting any other provider are skipped.
 *
 * The `nativeToolProvider` parameter lets OpenAI-compatible transports
 * (OpenRouter, Azure OpenAI, etc.) accept their own native escape hatch
 * without picking up tools intended for upstream OpenAI.
 */
export function toOpenAITools(
  tools: Tool[] | undefined,
  nativeToolProvider = "openai"
): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) return undefined;

  const result: Array<Record<string, unknown>> = [];
  for (const tool of tools) {
    if (tool.type === "function") {
      result.push({
        type: "function",
        function: {
          name: tool.name,
          ...(tool.description !== undefined && { description: tool.description }),
          ...(tool.parameters !== undefined && { parameters: tool.parameters }),
        },
      });
    } else if (tool.type === "provider-native" && tool.provider === nativeToolProvider) {
      result.push(tool.config);
    }
  }

  return result.length > 0 ? result : undefined;
}
