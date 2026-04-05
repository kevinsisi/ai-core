import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiClient } from "../client/gemini-client.js";
import { KeyPool } from "../key-pool/key-pool.js";
import type { ApiKey, StorageAdapter } from "../key-pool/index.js";

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
  return { id, key, isActive: true, cooldownUntil: 0, usageCount: 0 };
}

function makePool(keys: ApiKey[]): KeyPool {
  const internalKeys = [...keys];
  const adapter: StorageAdapter = {
    async getKeys() {
      return [...internalKeys];
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
