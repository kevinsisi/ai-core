import { describe, expect, it, vi } from "vitest";
import type { GenerateParams } from "../client/types.js";
import { KeyPool } from "../key-pool/index.js";
import type { ApiKey, StorageAdapter } from "../key-pool/index.js";
import { GeminiProviderAdapter } from "../provider/adapters/gemini.js";
import { ProviderID } from "../provider/schema.js";
import { defaultProviderPriority, getBuiltInModel, getBuiltInProvider } from "../provider/models.js";
import { ProviderRouter } from "../provider/router.js";
import { OpenAIProviderAdapter } from "../provider/adapters/openai.js";
import type { ProviderAdapter } from "../provider/types.js";

function makeKey(id: number, key: string, overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id,
    key,
    isActive: true,
    cooldownUntil: 0,
    leaseUntil: 0,
    leaseToken: null,
    usageCount: 0,
    ...overrides,
  };
}

function makeAdapter(keys: ApiKey[]): StorageAdapter {
  return {
    async getKeys() {
      return keys.map((key) => ({ ...key }));
    },
    async acquireLease(keyId: number, leaseUntil: number, leaseToken: string, now: number) {
      const record = keys.find((key) => key.id === keyId);
      if (!record) return false;
      if (!record.isActive || record.cooldownUntil > now || record.leaseUntil > now) return false;
      record.leaseUntil = leaseUntil;
      record.leaseToken = leaseToken;
      return true;
    },
    async renewLease(keyId: number, leaseUntil: number, leaseToken: string, now: number) {
      const record = keys.find((key) => key.id === keyId);
      if (!record || record.leaseToken !== leaseToken || record.leaseUntil <= now) return false;
      record.leaseUntil = leaseUntil;
      return true;
    },
    async updateKey(key: ApiKey) {
      const index = keys.findIndex((item) => item.id === key.id);
      if (index >= 0) keys[index] = { ...key };
    },
  };
}

describe("provider registry", () => {
  it("exposes built-in Gemini and OpenAI providers", () => {
    expect(getBuiltInProvider(ProviderID.Gemini)?.id).toBe("gemini");
    expect(getBuiltInProvider(ProviderID.OpenAI)?.id).toBe("openai");
  });

  it("uses OpenAI first and Gemini second in default provider priority", () => {
    expect(defaultProviderPriority).toEqual([ProviderID.OpenAI, ProviderID.Gemini]);
  });

  it("resolves built-in models", () => {
    expect(getBuiltInModel("gemini-2.5-flash")?.provider).toBe("gemini");
    expect(getBuiltInModel("gpt-4.1-mini")?.provider).toBe("openai");
  });
});

describe("provider router", () => {
  const geminiAdapter: ProviderAdapter = {
    provider: getBuiltInProvider("gemini")!,
    credential: { type: "pool", provider: "gemini" },
    supports: (modelID) => modelID === "gemini-2.5-flash",
    getModel: (modelID) => {
      const model = getBuiltInModel(modelID);
      return model?.provider === "gemini" ? model : undefined;
    },
    generateContent: async (_params: GenerateParams) => ({ text: "gemini", usage: null }),
  };

  const openAIAdapter: ProviderAdapter = {
    provider: getBuiltInProvider("openai")!,
    credential: { type: "api", provider: "openai", apiKey: "o-key", credentialLabel: "openai-default" },
    supports: (modelID) => modelID === "gpt-4.1-mini",
    getModel: (modelID) => {
      const model = getBuiltInModel(modelID);
      return model?.provider === "openai" ? model : undefined;
    },
    generateContent: async (_params: GenerateParams) => ({ text: "openai", usage: null }),
  };

  it("prefers requested provider and model when available", () => {
    const router = new ProviderRouter([geminiAdapter, openAIAdapter]);
    const selected = router.select({ preferredProviders: [ProviderID.OpenAI], preferredModel: "gpt-4.1-mini" });
    expect(selected).toEqual({ provider: "openai", model: "gpt-4.1-mini", credentialType: "api", credentialRef: "openai-default" });
  });

  it("uses OpenAI-first priority by default when preferredProviders is omitted", () => {
    const router = new ProviderRouter([geminiAdapter, openAIAdapter]);
    const selected = router.select();
    expect(selected).toEqual({ provider: "openai", model: "gpt-4.1-mini", credentialType: "api", credentialRef: "openai-default" });
  });

  it("can fall back across providers only when policy allows it", () => {
    const router = new ProviderRouter([geminiAdapter, openAIAdapter]);
    const selected = router.select({
      preferredProviders: [ProviderID.Gemini],
      preferredModel: "gpt-4.1-mini",
      allowCrossProviderFallback: true,
      fallbackProviders: [ProviderID.OpenAI],
    });
    expect(selected).toEqual({ provider: "openai", model: "gpt-4.1-mini", credentialType: "api", credentialRef: "openai-default" });
  });

  it("considers multiple adapters for the same provider instead of only the first one", () => {
    const firstOpenAIAdapter: ProviderAdapter = {
      provider: getBuiltInProvider("openai")!,
      credential: { type: "api", provider: "openai", apiKey: "first", credentialLabel: "openai-primary" },
      supports: () => false,
      getModel: () => undefined,
      generateContent: async (_params: GenerateParams) => ({ text: "first", usage: null }),
    };

    const secondOpenAIAdapter: ProviderAdapter = {
      provider: getBuiltInProvider("openai")!,
      credential: { type: "api", provider: "openai", apiKey: "second", credentialLabel: "openai-secondary" },
      supports: (modelID) => modelID === "gpt-4.1-mini",
      getModel: (modelID) => {
        const model = getBuiltInModel(modelID);
        return model?.provider === "openai" ? model : undefined;
      },
      generateContent: async (_params: GenerateParams) => ({ text: "second", usage: null }),
    };

    const router = new ProviderRouter([geminiAdapter, firstOpenAIAdapter, secondOpenAIAdapter]);
    const selected = router.select({
      preferredProviders: [ProviderID.OpenAI],
      preferredModel: "gpt-4.1-mini",
      allowSameProviderCredentialFallback: true,
    });

    expect(selected).toEqual({ provider: "openai", model: "gpt-4.1-mini", credentialType: "api", credentialRef: "openai-secondary" });
  });

  it("does not implicitly try a second credential for the same provider when same-provider fallback is disabled", () => {
    const firstOpenAIAdapter: ProviderAdapter = {
      provider: getBuiltInProvider("openai")!,
      credential: { type: "api", provider: "openai", apiKey: "first", credentialLabel: "openai-primary" },
      supports: () => false,
      getModel: () => undefined,
      generateContent: async (_params: GenerateParams) => ({ text: "first", usage: null }),
    };

    const secondOpenAIAdapter: ProviderAdapter = {
      provider: getBuiltInProvider("openai")!,
      credential: { type: "api", provider: "openai", apiKey: "second", credentialLabel: "openai-secondary" },
      supports: (modelID) => modelID === "gpt-4.1-mini",
      getModel: (modelID) => {
        const model = getBuiltInModel(modelID);
        return model?.provider === "openai" ? model : undefined;
      },
      generateContent: async (_params: GenerateParams) => ({ text: "second", usage: null }),
    };

    const router = new ProviderRouter([firstOpenAIAdapter, secondOpenAIAdapter]);

    expect(() =>
      router.select({
        preferredProviders: [ProviderID.OpenAI],
        preferredModel: "gpt-4.1-mini",
      })
    ).toThrow(/No provider\/model combination/);
  });

  it("execute() selects an adapter and runs generateContent against it", async () => {
    const calls: GenerateParams[] = [];
    const tracingOpenAI: ProviderAdapter = {
      ...openAIAdapter,
      generateContent: async (params) => {
        calls.push(params);
        return { text: "openai-response", usage: null };
      },
    };

    const router = new ProviderRouter([geminiAdapter, tracingOpenAI]);
    const result = await router.execute({ model: "gpt-4.1-mini", prompt: "hi" });

    expect(result.selection.provider).toBe("openai");
    expect(result.selection.model).toBe("gpt-4.1-mini");
    expect(result.response.text).toBe("openai-response");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "gpt-4.1-mini", prompt: "hi" });
  });

  it("execute() respects policy.preferredProviders over params.model provider", async () => {
    const tracingGemini: ProviderAdapter = {
      ...geminiAdapter,
      generateContent: async () => ({ text: "gemini-response", usage: null }),
    };

    const router = new ProviderRouter([tracingGemini, openAIAdapter]);
    const result = await router.execute(
      { model: "gemini-2.5-flash", prompt: "hi" },
      { preferredProviders: [ProviderID.Gemini] }
    );

    expect(result.selection.provider).toBe("gemini");
    expect(result.response.text).toBe("gemini-response");
  });

  it("execute() does not silently fall back to a different model when policy disallows it", async () => {
    const router = new ProviderRouter([geminiAdapter, openAIAdapter]);

    await expect(
      router.execute(
        { model: "claude-opus-4-7", prompt: "hi" },
        { preferredProviders: [ProviderID.OpenAI] }
      )
    ).rejects.toThrow(/No provider\/model combination/);
  });

  it("selects the Gemini compatibility adapter with explicit pool credential reference", () => {
    const pool = new KeyPool(makeAdapter([makeKey(1, "g-key")]))
    const adapter = new GeminiProviderAdapter(pool);
    const router = new ProviderRouter([adapter]);

    const selected = router.select({ preferredProviders: [ProviderID.Gemini], preferredModel: "gemini-2.5-flash" });

    expect(selected).toEqual({
      provider: "gemini",
      model: "gemini-2.5-flash",
      credentialType: "pool",
      credentialRef: "gemini-pool",
    });
  });
});

describe("openai provider adapter", () => {
  it("maps chat completions response into GenerateResponse", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "hello from openai" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAIProviderAdapter({
      type: "api",
      provider: "openai",
      apiKey: "test-key",
    });

    const result = await adapter.generateContent({
      model: "gpt-4.1-mini",
      prompt: "hello",
    });

    expect(result.text).toBe("hello from openai");
    expect(result.usage?.totalTokens).toBe(15);
  });

  it("rejects unsupported multimodal or tools input in phase 1", async () => {
    const adapter = new OpenAIProviderAdapter({
      type: "api",
      provider: "openai",
      apiKey: "test-key",
    });

    await expect(
      adapter.generateContent({
        model: "gpt-4.1-mini",
        prompt: "hello",
        images: [{ type: "inline", mimeType: "image/png", data: "abc" }],
      })
    ).rejects.toThrow(/multimodal/);

    await expect(
      adapter.generateContent({
        model: "gpt-4.1-mini",
        prompt: "hello",
        tools: [{} as never],
      })
    ).rejects.toThrow(/tools/);
  });
});
