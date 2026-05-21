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

function makeOpenCodeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  const provider = getBuiltInProvider("opencode")!;
  const model = provider.models[0];
  return {
    provider,
    credential: { type: "pool", provider: "opencode", credentialLabel: "opencode-test" },
    supports: (id) => id === model.id,
    getModel: (id) => (id === model.id ? model : undefined),
    generateContent: async () => ({ text: "opencode", usage: null }),
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

  it("prefers OpenCode before Gemini by default", async () => {
    const client = new MultiProviderClient({
      adapters: [makeGeminiAdapter(), makeOpenCodeAdapter()],
    });

    const result = await client.generateWithSelection({
      model: "opencode/deepseek-v4-flash-free",
      prompt: "hi",
    });

    expect(result.selection.provider).toBe("opencode");
    expect(result.response.text).toBe("opencode");
  });

  it("falls back from OpenCode to Gemini when policy allows provider and model fallback", async () => {
    const opencode = makeOpenCodeAdapter({
      generateContent: async () => {
        throw new Error("OpenCode unavailable");
      },
    });
    const gemini = makeGeminiAdapter({
      generateContent: async () => ({ text: "gemini fallback", usage: null }),
    });
    const client = new MultiProviderClient({ adapters: [opencode, gemini] });

    const result = await client.generateWithSelection(
      { model: "opencode/deepseek-v4-flash-free", prompt: "hi" },
      { allowCrossProviderFallback: true, allowCrossModelFallback: true }
    );

    expect(result.selection.provider).toBe("gemini");
    expect(result.selection.model).toBe("gemini-2.5-flash");
    expect(result.response.text).toBe("gemini fallback");
  });

  it("does not fall back from OpenCode failure unless policy allows it", async () => {
    const opencode = makeOpenCodeAdapter({
      generateContent: async () => {
        throw new Error("OpenCode unavailable");
      },
    });
    const client = new MultiProviderClient({ adapters: [opencode, makeGeminiAdapter()] });

    await expect(
      client.generateContent({ model: "opencode/deepseek-v4-flash-free", prompt: "hi" })
    ).rejects.toThrow("OpenCode unavailable");
  });

  it("does not treat cross-model fallback as permission to cross providers", async () => {
    const client = new MultiProviderClient({
      adapters: [makeOpenCodeAdapter(), makeGeminiAdapter()],
    });

    const result = await client.generateWithSelection(
      { model: "gemini-2.5-flash", prompt: "hi" },
      { allowCrossModelFallback: true }
    );

    expect(result.selection.provider).toBe("gemini");
    expect(result.selection.model).toBe("gemini-2.5-flash");
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

  describe("imageGen", () => {
    it("routes to the first adapter implementing imageGen", async () => {
      const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
      const openCode = makeOpenCodeAdapter(); // no imageGen
      const gemini = makeGeminiAdapter({
        supports: (id) => id === "gemini-3-pro-image-preview",
        getModel: (id) =>
          id === "gemini-3-pro-image-preview"
            ? getBuiltInProvider("gemini")!.models.find((m) => m.id === id)
            : undefined,
        imageGen: async () => ({
          images: [{ mimeType: "image/png", data: imageBytes }],
          usage: null,
        }),
      });

      const client = new MultiProviderClient({
        adapters: [openCode, gemini],
        defaultPolicy: { preferredProviders: ["opencode", "gemini"] },
      });
      const result = await client.imageGen({
        model: "gemini-3-pro-image-preview",
        prompt: "draw a circle",
      });
      expect(result.images).toHaveLength(1);
      expect(result.images[0].mimeType).toBe("image/png");
    });

    it("throws when no adapter in the chain supports imageGen", async () => {
      const openCode = makeOpenCodeAdapter();
      const client = new MultiProviderClient({
        adapters: [openCode],
      });
      await expect(
        client.imageGen({ model: "gemini-3-pro-image-preview", prompt: "x" })
      ).rejects.toThrow();
    });

    it("invokes onSelect with the image-gen selection", async () => {
      const onSelect = vi.fn();
      const gemini = makeGeminiAdapter({
        supports: (id) => id === "gemini-3-pro-image-preview",
        getModel: (id) =>
          id === "gemini-3-pro-image-preview"
            ? getBuiltInProvider("gemini")!.models.find((m) => m.id === id)
            : undefined,
        imageGen: async () => ({
          images: [{ mimeType: "image/png", data: "AA==" }],
          usage: null,
        }),
      });

      const client = new MultiProviderClient({ adapters: [gemini], onSelect });
      await client.imageGen({ model: "gemini-3-pro-image-preview", prompt: "hi" });
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "gemini", model: "gemini-3-pro-image-preview" }),
        expect.objectContaining({ prompt: "hi" })
      );
    });

    it("skips adapters lacking imageGen and uses the next one in the chain", async () => {
      const calls: string[] = [];
      const openCode = makeOpenCodeAdapter({
        // No imageGen — should be skipped silently.
        generateContent: async () => {
          calls.push("opencode-generate");
          return { text: "should not happen", usage: null };
        },
      });
      const gemini = makeGeminiAdapter({
        supports: (id) => id === "gemini-3-pro-image-preview",
        getModel: (id) =>
          id === "gemini-3-pro-image-preview"
            ? getBuiltInProvider("gemini")!.models.find((m) => m.id === id)
            : undefined,
        imageGen: async () => {
          calls.push("gemini-imagegen");
          return { images: [{ mimeType: "image/png", data: "AA==" }], usage: null };
        },
      });

      const client = new MultiProviderClient({
        adapters: [openCode, gemini],
        defaultPolicy: { preferredProviders: ["opencode", "gemini"] },
      });
      await client.imageGen({ model: "gemini-3-pro-image-preview", prompt: "hi" });
      expect(calls).toEqual(["gemini-imagegen"]);
    });
  });
});
