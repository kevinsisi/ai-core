interface ChatMessage {
    role: "user" | "model";
    parts: string;
}
/** Base64-encoded image sent inline with the request. */
interface InlineImagePart {
    type: "inline";
    /** MIME type, e.g. "image/png", "image/jpeg" */
    mimeType: string;
    /** Base64-encoded image data */
    data: string;
}
/** Image loaded from a local file path (read and base64-encoded automatically). */
interface FileImagePart {
    type: "file";
    /** MIME type, e.g. "image/png", "image/jpeg" */
    mimeType: string;
    /** Absolute or relative path to the image file */
    filePath: string;
}
type ImagePart = InlineImagePart | FileImagePart;
/**
 * Provider-agnostic function tool. The `parameters` object is a JSON Schema
 * describing the tool's arguments, in the same shape OpenAI / Anthropic /
 * Gemini all accept under their respective wrappers.
 */
interface FunctionTool {
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
interface ProviderNativeTool {
    type: "provider-native";
    /** Target provider id this tool only applies to (e.g. "gemini", "openai"). */
    provider: string;
    /** Raw provider-specific payload passed through verbatim. */
    config: Record<string, unknown>;
}
type Tool = FunctionTool | ProviderNativeTool;
interface GenerateParams {
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
interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}
interface GenerateResponse {
    text: string;
    /** null if the model does not return usage metadata */
    usage: TokenUsage | null;
}
interface ClientOptions {
    /** Number of retry attempts on transient errors (default: 3) */
    maxRetries?: number;
}
declare class StreamInterruptedError extends Error {
    readonly chunksReceived: number;
    constructor(chunksReceived: number, cause?: unknown);
}

export { type ChatMessage as C, type FunctionTool as F, type GenerateParams as G, type ProviderNativeTool as P, StreamInterruptedError as S, type TokenUsage as T, type ClientOptions as a, type GenerateResponse as b, type Tool as c };
