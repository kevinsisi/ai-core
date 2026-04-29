// ── Chat types ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "model";
  parts: string;
}

// ── Image part types ───────────────────────────────────────────────────

/** Base64-encoded image sent inline with the request. */
export interface InlineImagePart {
  type: "inline";
  /** MIME type, e.g. "image/png", "image/jpeg" */
  mimeType: string;
  /** Base64-encoded image data */
  data: string;
}

/** Image loaded from a local file path (read and base64-encoded automatically). */
export interface FileImagePart {
  type: "file";
  /** MIME type, e.g. "image/png", "image/jpeg" */
  mimeType: string;
  /** Absolute or relative path to the image file */
  filePath: string;
}

export type ImagePart = InlineImagePart | FileImagePart;

// ── Tool types ─────────────────────────────────────────────────────────

/**
 * Provider-agnostic function tool. The `parameters` object is a JSON Schema
 * describing the tool's arguments, in the same shape OpenAI / Anthropic /
 * Gemini all accept under their respective wrappers.
 */
export interface FunctionTool {
  type: "function";
  name: string;
  description?: string;
  /** JSON Schema for the function arguments. */
  parameters?: Record<string, unknown>;
}

/**
 * Escape hatch for provider built-ins that have no cross-provider equivalent
 * (e.g. Gemini `googleSearch` grounding, OpenAI `web_search_preview`,
 * code execution sandboxes). The `config` payload is passed through to the
 * upstream provider verbatim — adapters from other providers ignore it.
 */
export interface ProviderNativeTool {
  type: "provider-native";
  /** Target provider id this tool only applies to (e.g. "gemini", "openai"). */
  provider: string;
  /** Raw provider-specific payload passed through verbatim. */
  config: Record<string, unknown>;
}

export type Tool = FunctionTool | ProviderNativeTool;

// ── Generate types ─────────────────────────────────────────────────────

export interface GenerateParams {
  /** Model id, e.g. "gemini-2.5-flash", "gpt-4.1-mini". */
  model: string;
  systemInstruction?: string;
  prompt: string;
  /** Optional images to send alongside the prompt (multimodal). */
  images?: ImagePart[];
  /**
   * Provider-agnostic tool declarations. Use FunctionTool for cross-provider
   * function calling; use ProviderNativeTool to opt into a provider-specific
   * built-in (the tool is silently ignored by adapters of other providers).
   */
  tools?: Tool[];
  history?: ChatMessage[];
  maxOutputTokens?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GenerateResponse {
  text: string;
  /** null if the model does not return usage metadata */
  usage: TokenUsage | null;
}

// ── Client options ─────────────────────────────────────────────────────

export interface ClientOptions {
  /** Number of retry attempts on transient errors (default: 3) */
  maxRetries?: number;
}

// ── Errors ─────────────────────────────────────────────────────────────

export class StreamInterruptedError extends Error {
  readonly chunksReceived: number;

  constructor(chunksReceived: number, cause?: unknown) {
    const inner =
      cause instanceof Error ? cause.message : String(cause ?? "unknown");
    super(
      `Stream interrupted after ${chunksReceived} chunk(s): ${inner}`
    );
    this.name = "StreamInterruptedError";
    this.chunksReceived = chunksReceived;
  }
}
