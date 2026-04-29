import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiClient, buildParts } from "../client/gemini-client.js";
import { KeyPool } from "../key-pool/key-pool.js";
import type { ApiKey, StorageAdapter } from "../key-pool/index.js";

// ── Mock node:fs for file-path image tests ────────────────────────────

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => Buffer.from("file-image-bytes")),
}));

// ── Mock @google/generative-ai ────────────────────────────────────────

vi.mock("@google/generative-ai", () => {
  const mockGenerate = vi.fn();
  const mockStream = vi.fn();
  const mockSendMessage = vi.fn();
  const mockStartChat = vi.fn(() => ({ sendMessage: mockSendMessage }));

  const MockModel = {
    generateContent: mockGenerate,
    generateContentStream: mockStream,
    startChat: mockStartChat,
  };

  const MockGoogleGenerativeAI = vi.fn(() => ({
    getGenerativeModel: vi.fn(() => MockModel),
  }));

  return {
    GoogleGenerativeAI: MockGoogleGenerativeAI,
    __mocks: { mockGenerate, mockStream, mockSendMessage, mockStartChat },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────

function makeKey(id: number, key: string): ApiKey {
  return {
    id,
    key,
    isActive: true,
    cooldownUntil: 0,
    leaseUntil: 0,
    leaseToken: null,
    usageCount: 0,
  };
}

function makePool(keys: ApiKey[]): KeyPool {
  const internalKeys = [...keys];
  const adapter: StorageAdapter = {
    async getKeys() {
      return [...internalKeys];
    },
    async acquireLease(
      keyId: number,
      leaseUntil: number,
      leaseToken: string,
      now: number
    ) {
      const record = internalKeys.find((key) => key.id === keyId);
      if (!record) return false;
      if (!record.isActive || record.cooldownUntil > now || record.leaseUntil > now) {
        return false;
      }
      record.leaseUntil = leaseUntil;
      record.leaseToken = leaseToken;
      return true;
    },
    async renewLease(keyId: number, leaseUntil: number, leaseToken: string, now: number) {
      const record = internalKeys.find((key) => key.id === keyId);
      if (!record || record.leaseToken !== leaseToken || record.leaseUntil <= now) return false;
      record.leaseUntil = leaseUntil;
      return true;
    },
    async updateKey(k: ApiKey) {
      const idx = internalKeys.findIndex((x) => x.id === k.id);
      if (idx >= 0) internalKeys[idx] = { ...k };
    },
  };
  return new KeyPool(adapter);
}

function makeSuccessResponse(text: string, usage = true) {
  return {
    response: {
      text: () => text,
      usageMetadata: usage
        ? { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
        : undefined,
    },
  };
}

// ── Client Tests ──────────────────────────────────────────────────────

describe("GeminiClient.generateContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns text and usage on success", async () => {
    const { __mocks } = await import("@google/generative-ai") as any;
    __mocks.mockGenerate.mockResolvedValue(makeSuccessResponse("hello"));

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    const result = await client.generateContent({
      model: "gemini-2.5-flash",
      prompt: "hi",
    });

    expect(result.text).toBe("hello");
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  it("passes systemInstruction to getGenerativeModel", async () => {
    const { GoogleGenerativeAI, __mocks } = await import(
      "@google/generative-ai"
    ) as any;
    __mocks.mockGenerate.mockResolvedValue(makeSuccessResponse("ok"));

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    await client.generateContent({
      model: "gemini-2.5-flash",
      prompt: "test",
      systemInstruction: "You are a bot",
    });

    const instance = (GoogleGenerativeAI as any).mock.results[0].value;
    expect(instance.getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ systemInstruction: "You are a bot" })
    );
  });

  it("returns null usage when model does not provide metadata", async () => {
    const { __mocks } = await import("@google/generative-ai") as any;
    __mocks.mockGenerate.mockResolvedValue(makeSuccessResponse("ok", false));

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    const result = await client.generateContent({
      model: "gemini-2.5-flash",
      prompt: "test",
    });

    expect(result.usage).toBeNull();
  });

  it("uses startChat when history is provided", async () => {
    const { __mocks } = await import("@google/generative-ai") as any;
    __mocks.mockSendMessage.mockResolvedValue(makeSuccessResponse("chat ok"));

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    const result = await client.generateContent({
      model: "gemini-2.5-flash",
      prompt: "follow up",
      history: [{ role: "user", parts: "hello" }],
    });

    expect(__mocks.mockSendMessage).toHaveBeenCalledWith("follow up");
    expect(result.text).toBe("chat ok");
  });
});

describe("GeminiClient.streamContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("yields text chunks from stream", async () => {
    const { __mocks } = await import("@google/generative-ai") as any;
    const chunks = ["Hello", " World", "!"];
    __mocks.mockStream.mockResolvedValue({
      stream: (async function* () {
        for (const chunk of chunks) {
          yield { text: () => chunk };
        }
      })(),
    });

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    const received: string[] = [];

    for await (const chunk of client.streamContent({
      model: "gemini-2.5-flash",
      prompt: "stream test",
    })) {
      received.push(chunk);
    }

    expect(received).toEqual(["Hello", " World", "!"]);
  });
});

// ── buildParts unit tests ─────────────────────────────────────────────

describe("buildParts", () => {
  it("returns [TextPart] when no images", () => {
    const parts = buildParts("hello");
    expect(parts).toEqual([{ text: "hello" }]);
  });

  it("appends InlineDataPart for inline image", () => {
    const parts = buildParts("describe this", [
      { type: "inline", mimeType: "image/png", data: "abc123" },
    ]);
    expect(parts).toEqual([
      { text: "describe this" },
      { inlineData: { mimeType: "image/png", data: "abc123" } },
    ]);
  });

  it("reads file and base64-encodes for file-path image", async () => {
    const { readFileSync } = await import("node:fs");
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      Buffer.from("file-image-bytes")
    );

    const parts = buildParts("analyze", [
      { type: "file", mimeType: "image/jpeg", filePath: "/tmp/photo.jpg" },
    ]);

    expect(readFileSync).toHaveBeenCalledWith("/tmp/photo.jpg");
    expect(parts).toEqual([
      { text: "analyze" },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: Buffer.from("file-image-bytes").toString("base64"),
        },
      },
    ]);
  });
});

// ── Multimodal integration tests ──────────────────────────────────────

describe("GeminiClient multimodal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("3.1: generateContent with inline image sends Part[] to SDK", async () => {
    const { __mocks } = await import("@google/generative-ai") as any;
    __mocks.mockGenerate.mockResolvedValue(makeSuccessResponse("vision ok"));

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    await client.generateContent({
      model: "gemini-2.5-flash",
      prompt: "What is in this image?",
      images: [{ type: "inline", mimeType: "image/png", data: "base64data" }],
    });

    expect(__mocks.mockGenerate).toHaveBeenCalledWith([
      { text: "What is in this image?" },
      { inlineData: { mimeType: "image/png", data: "base64data" } },
    ]);
  });

  it("3.2: generateContent with file image reads file and sends base64", async () => {
    const { readFileSync } = await import("node:fs");
    const { __mocks } = await import("@google/generative-ai") as any;
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      Buffer.from("raw-bytes")
    );
    __mocks.mockGenerate.mockResolvedValue(makeSuccessResponse("file ok"));

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    await client.generateContent({
      model: "gemini-2.5-flash",
      prompt: "Analyze",
      images: [{ type: "file", mimeType: "image/jpeg", filePath: "/img.jpg" }],
    });

    expect(__mocks.mockGenerate).toHaveBeenCalledWith([
      { text: "Analyze" },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: Buffer.from("raw-bytes").toString("base64"),
        },
      },
    ]);
  });

  it("3.3: generateContent text-only passes plain string (backward compat)", async () => {
    const { __mocks } = await import("@google/generative-ai") as any;
    __mocks.mockGenerate.mockResolvedValue(makeSuccessResponse("text ok"));

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    await client.generateContent({ model: "gemini-2.5-flash", prompt: "Hello" });

    expect(__mocks.mockGenerate).toHaveBeenCalledWith("Hello");
  });

  it("3.4: streamContent with images passes Part[] to generateContentStream", async () => {
    const { __mocks } = await import("@google/generative-ai") as any;
    __mocks.mockStream.mockResolvedValue({
      stream: (async function* () {
        yield { text: () => "streamed" };
      })(),
    });

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    const chunks: string[] = [];
    for await (const c of client.streamContent({
      model: "gemini-2.5-flash",
      prompt: "stream image",
      images: [{ type: "inline", mimeType: "image/png", data: "img64" }],
    })) {
      chunks.push(c);
    }

    expect(__mocks.mockStream).toHaveBeenCalledWith([
      { text: "stream image" },
      { inlineData: { mimeType: "image/png", data: "img64" } },
    ]);
    expect(chunks).toEqual(["streamed"]);
  });

  it("3.5: function tools are converted to Gemini functionDeclarations", async () => {
    const { GoogleGenerativeAI, __mocks } = await import(
      "@google/generative-ai"
    ) as any;
    __mocks.mockGenerate.mockResolvedValue(makeSuccessResponse("tools ok"));

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    await client.generateContent({
      model: "gemini-2.5-flash",
      prompt: "search",
      tools: [
        { type: "function", name: "search", description: "search the web" },
      ],
    });

    const instance = (GoogleGenerativeAI as any).mock.results[0].value;
    expect(instance.getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          { functionDeclarations: [{ name: "search", description: "search the web" }] },
        ],
      })
    );
  });

  it("3.6: provider-native gemini tools are passed through verbatim", async () => {
    const { GoogleGenerativeAI, __mocks } = await import(
      "@google/generative-ai"
    ) as any;
    __mocks.mockGenerate.mockResolvedValue(makeSuccessResponse("grounding ok"));

    const pool = makePool([makeKey(1, "key-a")]);
    const client = new GeminiClient(pool);
    await client.generateContent({
      model: "gemini-2.5-flash",
      prompt: "ground me",
      tools: [
        { type: "provider-native", provider: "gemini", config: { googleSearch: {} } },
      ],
    });

    const instance = (GoogleGenerativeAI as any).mock.results[0].value;
    expect(instance.getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [{ googleSearch: {} }] })
    );
  });
});
