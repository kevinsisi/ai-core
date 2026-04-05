// ── Chat types ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "model";
  parts: string;
}

// ── Generate types ─────────────────────────────────────────────────────

export interface GenerateParams {
  /** Gemini model name, e.g. "gemini-2.5-flash" */
  model: string;
  systemInstruction?: string;
  prompt: string;
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
