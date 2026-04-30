import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerateParams } from "../client/types.js";
import { KeyPool } from "../key-pool/index.js";
import type { ApiKey, StorageAdapter } from "../key-pool/index.js";
import { GeminiProviderAdapter } from "../provider/adapters/gemini.js";
import { ProviderID } from "../provider/schema.js";
import {
  clearRegisteredProviders,
  defaultProviderPriority,
  getBuiltInModel,
  getBuiltInProvider,
  getModel,
  getProvider,
  registerProvider,
  unregisterProvider,
} from "../provider/models.js";
import { ProviderRouter } from "../provider/router.js";
import { OpenAIProviderAdapter } from "../provider/adapters/openai.js";
import { OpenRouterProviderAdapter } from "../provider/adapters/openrouter.js";
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
  afterEach(() => clearRegisteredProviders());

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

  it("registers custom providers and resolves them via getProvider/getModel", () => {
    registerProvider({
      id: "anthropic-direct",
      name: "Anthropic (direct)",
      authTypes: ["api"],
      models: [
        {
          id: "claude-opus-4-7",
          provider: "anthropic-direct",
          name: "Claude Opus 4.7",
          capabilities: {
            streaming: true,
            tools: true,
            reasoning: true,
            multimodalInput: true,
            multimodalOutput: false,
          },
        },
      ],
    });

    expect(getProvider("anthropic-direct")?.name).toBe("Anthropic (direct)");
    expect(getModel("claude-opus-4-7")?.provider).toBe("anthropic-direct");
    // built-in lookups still pass through
    expect(getProvider("openai")?.name).toBe("OpenAI");
    expect(getModel("gpt-4.1-mini")?.provider).toBe("openai");
  });

  it("rejects re-registering a built-in provider id", () => {
    expect(() =>
      registerProvider({ id: "openai", name: "spoof", authTypes: ["api"], models: [] })
    ).toThrow(/built-in/);
  });

  it("unregisterProvider removes a custom provider", () => {
    registerProvider({ id: "tmp", name: "tmp", authTypes: ["api"], models: [] });
    expect(getProvider("tmp")?.id).toBe("tmp");
    expect(unregisterProvider("tmp")).toBe(true);
    expect(getProvider("tmp")).toBeUndefined();
  });
});

describe("provider router", () => {
  async function* emptyStream(): AsyncGenerator<string, void, unknown> {
    return;
  }

  const geminiAdapter: ProviderAdapter = {
    provider: getBuiltInProvider("gemini")!,
    credential: { type: "pool", provider: "gemini" },
    supports: (modelID) => modelID === "gemini-2.5-flash",
    getModel: (modelID) => {
      const model = getBuiltInModel(modelID);
      return model?.provider === "gemini" ? model : undefined;
    },
    generateContent: async (_params: GenerateParams) => ({ text: "gemini", usage: null }),
    streamContent: () => emptyStream(),
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
    streamContent: () => emptyStream(),
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
      streamContent: () => emptyStream(),
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
      streamContent: () => emptyStream(),
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
      streamContent: () => emptyStream(),
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
      streamContent: () => emptyStream(),
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

  it("executeStream() selects an adapter and yields its stream chunks", async () => {
    async function* fakeStream() {
      yield "a";
      yield "b";
    }
    const streamingOpenAI: ProviderAdapter = {
      ...openAIAdapter,
      streamContent: () => fakeStream(),
    };

    const router = new ProviderRouter([geminiAdapter, streamingOpenAI]);
    const { selection, stream } = router.executeStream({ model: "gpt-4.1-mini", prompt: "hi" });
    expect(selection.provider).toBe("openai");

    const out: string[] = [];
    for await (const chunk of stream) out.push(chunk);
    expect(out).toEqual(["a", "b"]);
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

  it("Gemini adapter accepts arbitrary gemini-* model ids without registry updates", () => {
    const pool = new KeyPool(makeAdapter([makeKey(1, "g-key")]));
    const adapter = new GeminiProviderAdapter(pool);

    expect(adapter.supports("gemini-2.5-flash")).toBe(true);
    expect(adapter.supports("gemini-2.5-pro")).toBe(true);
    expect(adapter.supports("gemini-3-flash-experimental")).toBe(true);

    // Non-Gemini ids must still fail closed.
    expect(adapter.supports("gpt-4o")).toBe(false);
    expect(adapter.supports("claude-opus-4-7")).toBe(false);

    const synthesized = adapter.getModel("gemini-2.5-pro");
    expect(synthesized?.id).toBe("gemini-2.5-pro");
    expect(synthesized?.provider).toBe("gemini");
    expect(synthesized?.capabilities.multimodalInput).toBe(true);
  });

  it("router resolves arbitrary gemini-* models when only the GeminiProviderAdapter is registered", () => {
    const pool = new KeyPool(makeAdapter([makeKey(1, "g-key")]));
    const adapter = new GeminiProviderAdapter(pool);
    const router = new ProviderRouter([adapter]);

    const selected = router.select({
      preferredProviders: [ProviderID.Gemini],
      preferredModel: "gemini-2.5-pro",
    });

    expect(selected.model).toBe("gemini-2.5-pro");
    expect(selected.provider).toBe("gemini");
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

  it("rejects unsupported multimodal input in phase 1", async () => {
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
  });

  it("streams chat completions deltas via SSE", async () => {
    const sseLines = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}`,
      `data: [DONE]`,
      ``,
    ].join("\n");

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseLines));
        controller.close();
      },
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      body,
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAIProviderAdapter({
      type: "api",
      provider: "openai",
      apiKey: "stream-key",
    });

    const chunks: string[] = [];
    for await (const chunk of adapter.streamContent({ model: "gpt-4.1-mini", prompt: "hi" })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["Hello", " world"]);
  });

  it("accepts arbitrary gpt-* and reasoning model ids without registry updates", () => {
    const adapter = new OpenAIProviderAdapter({
      type: "api",
      provider: "openai",
      apiKey: "test-key",
    });

    expect(adapter.supports("gpt-4o")).toBe(true);
    expect(adapter.supports("gpt-4o-mini")).toBe(true);
    expect(adapter.supports("gpt-5-thinking")).toBe(true);
    expect(adapter.supports("o1-mini")).toBe(true);
    expect(adapter.supports("o3-mini")).toBe(true);
    expect(adapter.supports("o4-mini")).toBe(true);
    expect(adapter.supports("chatgpt-4o-latest")).toBe(true);

    // Non-OpenAI ids must still fail closed — no silent acceptance.
    expect(adapter.supports("gemini-2.5-flash")).toBe(false);
    expect(adapter.supports("claude-opus-4-7")).toBe(false);

    const synthesized = adapter.getModel("gpt-4o");
    expect(synthesized?.id).toBe("gpt-4o");
    expect(synthesized?.provider).toBe("openai");
    expect(synthesized?.capabilities.streaming).toBe(true);

    const reasoning = adapter.getModel("o3-mini");
    expect(reasoning?.capabilities.reasoning).toBe(true);
  });

  it("forwards function tools to OpenAI in the chat completions tools format", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      capturedBody = JSON.parse(init.body) as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAIProviderAdapter({
      type: "api",
      provider: "openai",
      apiKey: "test-key",
    });

    await adapter.generateContent({
      model: "gpt-4.1-mini",
      prompt: "hi",
      tools: [
        {
          type: "function",
          name: "lookup_weather",
          description: "Look up the weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
        {
          type: "provider-native",
          provider: "gemini",
          config: { googleSearch: {} },
        },
      ],
    });

    expect(capturedBody?.tools).toEqual([
      {
        type: "function",
        function: {
          name: "lookup_weather",
          description: "Look up the weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      },
    ]);
  });
});

describe("openrouter provider adapter", () => {
  it("hits the OpenRouter base URL and forwards attribution headers", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      capturedUrl = url;
      capturedHeaders = init.headers;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok via openrouter" } }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenRouterProviderAdapter(
      { type: "api", provider: "openrouter", apiKey: "or-key" },
      { referer: "https://example.com", appTitle: "TestApp" }
    );

    const result = await adapter.generateContent({ model: "openrouter/auto", prompt: "hi" });

    expect(capturedUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(capturedHeaders["Authorization"]).toBe("Bearer or-key");
    expect(capturedHeaders["HTTP-Referer"]).toBe("https://example.com");
    expect(capturedHeaders["X-Title"]).toBe("TestApp");
    expect(result.text).toBe("ok via openrouter");
  });

  it("exposes additionalModels alongside the built-in catalog without leaking globally", () => {
    const adapter = new OpenRouterProviderAdapter(
      { type: "api", provider: "openrouter", apiKey: "or-key" },
      {
        additionalModels: [
          {
            id: "anthropic/claude-sonnet-4.5",
            provider: "openrouter",
            name: "Claude Sonnet 4.5 via OpenRouter",
            capabilities: {
              streaming: true,
              tools: true,
              reasoning: true,
              multimodalInput: true,
              multimodalOutput: false,
            },
          },
        ],
      }
    );

    expect(adapter.supports("anthropic/claude-sonnet-4.5")).toBe(true);
    // built-in catalog must remain unmodified
    expect(getBuiltInProvider("openrouter")?.models.some(
      (m) => m.id === "anthropic/claude-sonnet-4.5"
    )).toBe(false);
  });

  it("only forwards openrouter-tagged native tools", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      capturedBody = JSON.parse(init.body) as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenRouterProviderAdapter({
      type: "api",
      provider: "openrouter",
      apiKey: "or-key",
    });

    await adapter.generateContent({
      model: "openrouter/auto",
      prompt: "hi",
      tools: [
        { type: "provider-native", provider: "openai", config: { type: "web_search_preview" } },
        { type: "provider-native", provider: "openrouter", config: { type: "web_search" } },
      ],
    });

    expect(capturedBody?.tools).toEqual([{ type: "web_search" }]);
  });
});
