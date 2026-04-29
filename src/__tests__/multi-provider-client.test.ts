import { describe, expect, it, vi } from "vitest";
import { MultiProviderClient } from "../client/multi-provider-client.js";
import type { GenerateParams } from "../client/types.js";
import { getBuiltInProvider } from "../provider/models.js";
import type { ProviderAdapter } from "../provider/types.js";

async function* emptyStream(): AsyncGenerator<string, void, unknown> {
  return;
}

function makeOpenAIAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    provider: getBuiltInProvider("openai")!,
    credential: { type: "api", provider: "openai", apiKey: "k", credentialLabel: "openai-test" },
    supports: (id) => id === "gpt-4.1-mini",
    getModel: (id) => (id === "gpt-4.1-mini" ? getBuiltInProvider("openai")!.models[0] : undefined),
    generateContent: async () => ({ text: "openai", usage: null }),
    streamContent: () => emptyStream(),
    ...overrides,
  };
}

function makeGeminiAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    provider: getBuiltInProvider("gemini")!,
    credential: { type: "pool", provider: "gemini" },
    supports: (id) => id === "gemini-2.5-flash",
    getModel: (id) => (id === "gemini-2.5-flash" ? getBuiltInProvider("gemini")!.models[0] : undefined),
    generateContent: async () => ({ text: "gemini", usage: null }),
    streamContent: () => emptyStream(),
    ...overrides,
  };
}

describe("MultiProviderClient", () => {
  it("routes generateContent to the matching adapter and returns its response", async () => {
    const calls: GenerateParams[] = [];
    const openai = makeOpenAIAdapter({
      generateContent: async (params) => {
        calls.push(params);
        return { text: "from openai", usage: null };
      },
    });

    const client = new MultiProviderClient({ adapters: [makeGeminiAdapter(), openai] });
    const response = await client.generateContent({ model: "gpt-4.1-mini", prompt: "hi" });
    expect(response.text).toBe("from openai");
    expect(calls[0]?.prompt).toBe("hi");
  });

  it("invokes onSelect with the resolved selection", async () => {
    const onSelect = vi.fn();
    const client = new MultiProviderClient({
      adapters: [makeGeminiAdapter(), makeOpenAIAdapter()],
      onSelect,
    });
    await client.generateContent({ model: "gpt-4.1-mini", prompt: "hi" });
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", model: "gpt-4.1-mini" }),
      expect.objectContaining({ prompt: "hi" })
    );
  });

  it("merges defaultPolicy with per-call policy", async () => {
    const openai = makeOpenAIAdapter();
    const gemini = makeGeminiAdapter();
    const client = new MultiProviderClient({
      adapters: [openai, gemini],
      defaultPolicy: { preferredProviders: ["gemini"] },
    });
    // default selects gemini
    let result = await client.generateWithSelection({ model: "gemini-2.5-flash", prompt: "hi" });
    expect(result.selection.provider).toBe("gemini");

    // per-call policy overrides
    result = await client.generateWithSelection(
      { model: "gpt-4.1-mini", prompt: "hi" },
      { preferredProviders: ["openai"] }
    );
    expect(result.selection.provider).toBe("openai");
  });

  it("streamContent yields adapter chunks", async () => {
    async function* fakeStream() {
      yield "x";
      yield "y";
    }
    const openai = makeOpenAIAdapter({ streamContent: () => fakeStream() });
    const client = new MultiProviderClient({ adapters: [makeGeminiAdapter(), openai] });

    const out: string[] = [];
    for await (const chunk of client.streamContent({ model: "gpt-4.1-mini", prompt: "hi" })) {
      out.push(chunk);
    }
    expect(out).toEqual(["x", "y"]);
  });

  it("throws when no adapter satisfies the policy (no silent fallback)", async () => {
    const client = new MultiProviderClient({
      adapters: [makeOpenAIAdapter()],
    });
    await expect(
      client.generateContent({ model: "gemini-2.5-flash", prompt: "hi" })
    ).rejects.toThrow(/No provider\/model combination/);
  });
});
