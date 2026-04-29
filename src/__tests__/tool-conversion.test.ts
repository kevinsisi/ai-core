import { describe, it, expect } from "vitest";
import { toGeminiTools, toOpenAITools } from "../client/tool-conversion.js";
import type { Tool } from "../client/types.js";

describe("toGeminiTools", () => {
  it("returns undefined when tools is empty or absent", () => {
    expect(toGeminiTools(undefined)).toBeUndefined();
    expect(toGeminiTools([])).toBeUndefined();
  });

  it("groups function tools into a single functionDeclarations entry", () => {
    const tools: Tool[] = [
      { type: "function", name: "a", description: "A", parameters: { type: "object" } },
      { type: "function", name: "b" },
    ];
    const result = toGeminiTools(tools);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toEqual({
      functionDeclarations: [
        { name: "a", description: "A", parameters: { type: "object" } },
        { name: "b" },
      ],
    });
  });

  it("passes through provider-native gemini tools verbatim", () => {
    const tools: Tool[] = [
      { type: "provider-native", provider: "gemini", config: { googleSearch: {} } },
    ];
    expect(toGeminiTools(tools)).toEqual([{ googleSearch: {} }]);
  });

  it("ignores provider-native tools targeting other providers", () => {
    const tools: Tool[] = [
      { type: "provider-native", provider: "openai", config: { type: "web_search_preview" } },
    ];
    expect(toGeminiTools(tools)).toBeUndefined();
  });

  it("combines function declarations and gemini-native tools", () => {
    const tools: Tool[] = [
      { type: "function", name: "lookup" },
      { type: "provider-native", provider: "gemini", config: { googleSearch: {} } },
    ];
    const result = toGeminiTools(tools);
    expect(result).toHaveLength(2);
    expect(result?.[0]).toEqual({ functionDeclarations: [{ name: "lookup" }] });
    expect(result?.[1]).toEqual({ googleSearch: {} });
  });
});

describe("toOpenAITools", () => {
  it("returns undefined when tools is empty or absent", () => {
    expect(toOpenAITools(undefined)).toBeUndefined();
    expect(toOpenAITools([])).toBeUndefined();
  });

  it("wraps each function tool under { type: function, function: ... }", () => {
    const tools: Tool[] = [
      { type: "function", name: "a", description: "A", parameters: { type: "object" } },
    ];
    expect(toOpenAITools(tools)).toEqual([
      {
        type: "function",
        function: {
          name: "a",
          description: "A",
          parameters: { type: "object" },
        },
      },
    ]);
  });

  it("passes through provider-native openai tools verbatim", () => {
    const tools: Tool[] = [
      { type: "provider-native", provider: "openai", config: { type: "web_search_preview" } },
    ];
    expect(toOpenAITools(tools)).toEqual([{ type: "web_search_preview" }]);
  });

  it("ignores provider-native tools targeting other providers", () => {
    const tools: Tool[] = [
      { type: "provider-native", provider: "gemini", config: { googleSearch: {} } },
    ];
    expect(toOpenAITools(tools)).toBeUndefined();
  });
});
