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

// ── Generate types ─────────────────────────────────────────────────────

export interface GenerateParams {
  /** Gemini model name, e.g. "gemini-2.5-flash" */
  model: string;
  systemInstruction?: string;
  prompt: string;
  /** Optional images to send alongside the prompt (multimodal). */
  images?: ImagePart[];
  /**
   * Optional Gemini tool declarations (e.g., Google Search grounding).
   * Passed directly to `getGenerativeModel()`.
   */
  tools?: import("@google/generative-ai").Tool[];
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
