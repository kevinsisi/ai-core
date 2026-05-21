# Design — ai-core 3.4: image-gen + tool events

## Context

ai-core 3.3.0's `MultiProviderClient` covers the cross-provider text/vision
generation path well, but three gaps force downstream consumers to bypass
ai-core and import provider SDKs directly:

1. **No image generation.** sheet-to-car v2.23.0's plate redaction uses
   Gemini's `responseModalities: ['IMAGE', 'TEXT']` mode. There's no
   capability for "given a prompt + reference image, return image bytes."
2. **`GenerateResponse.text` only.** Gemini's function-call response part
   is dropped silently when callers pass `tools`. Callers cannot inspect
   `toolCalls` without going back to the raw SDK.
3. **No streaming + tool loop.** `streamContent` is text-only. Function
   calling requires a multi-round loop (stream → tool call → tool result
   → continue stream). Implementing this loop in every caller defeats
   the point of having ai-core.

This change fills all three gaps in a single 3.4.0 release so sheet-to-car
(and other future consumers) can adopt ai-core wholesale rather than
maintaining parallel local provider abstractions.

## Goals / Non-Goals

**Goals**

- Sheet-to-car can drop its local `src/services/ai/providers/` entirely
  after upgrading to ai-core 3.4 — no remaining reason to import
  `@google/generative-ai` directly outside ai-core's own internals.
- New APIs are additive; existing `generateContent` / `streamContent` /
  `RoutePolicy` semantics unchanged.
- Each new capability has explicit opt-in: adapters that don't support
  image-gen / tool-call streaming declare `undefined` and the router
  skips them silently (treats like `CapabilityNotSupportedError`).
- Single Gemini SDK call paths for both modes — no parallel SDK access
  outside the adapter.
- Function-call loop semantics match the Gemini SDK's native behavior:
  the v2.22.x "empty-chunk-after-function-call" SDK quirk is handled
  inside the Gemini adapter so callers never see it.

**Non-Goals**

- No OpenAI image-gen. Different request shape (URL output, no
  reference image support in most tiers) — separate design pass.
- No mid-loop provider fallback for `chatWithTools`. Provider selected
  once at start; if it fails mid-stream, error surfaces.
- No `streamContent` event-stream extension. Keep it as the simple
  `AsyncGenerator<string>` it is today; new explicit `chatWithTools`
  API for callers needing structured events.
- No session-reuse semantics for `chatWithTools`. Each call carries
  full history in `params.history`. OpenCode adapter's existing session
  reuse option is orthogonal.
- No streaming for adapters that don't natively stream. OpenCode's
  `chatWithTools` emits the final text as one big `text_delta` event
  followed by `done` — matches OpenCode's request/response model.

## Interface

### Types (`src/client/types.ts`)

```ts
// — Image generation —————————————————————————————

export interface ImageGenParams {
  /** Image-capable model id, e.g. "gemini-3-pro-image-preview". */
  model: string;
  prompt: string;
  /** Reference images to seed / condition the generation. */
  referenceImages?: ImagePart[];
  /**
   * Provider-specific options bag.
   * - Gemini: { fallbackModel?: string, dedicatedKey?: string }
   *     dedicatedKey bypasses KeyPool for the duration of the call.
   *     fallbackModel triggers a second attempt on a "model not found"-class
   *     error from the primary model.
   */
  options?: Record<string, unknown>;
}

export interface ImageGenResponse {
  image: Buffer;
  mimeType: string;
  usage: TokenUsage | null;
}

// — Tool-call surfacing —————————————————————————

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// GenerateResponse augmented (additive, optional):
export interface GenerateResponse {
  text: string;
  usage: TokenUsage | null;
  /** Populated when the model emits function-call parts. Empty/undefined
   *  for plain text responses. */
  toolCalls?: ToolCall[];
}

// — Streaming tool loop —————————————————————————

export type ChatEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; fullText: string };

export interface ChatToolContext {
  /** Caller-supplied executor. Called when the model emits a tool call.
   *  Return value becomes the tool result fed back to the model. */
  onToolCall?: (call: ToolCall) => Promise<string>;
  /** Hard cap on tool-call loop iterations (default 5). */
  maxToolRounds?: number;
}
```

### ProviderAdapter (`src/provider/types.ts`)

```ts
export interface ProviderAdapter {
  // ... existing fields ...

  /**
   * Image generation capability. Adapters that don't implement this leave
   * the field undefined; the router treats absence as
   * CapabilityNotSupportedError and skips to the next provider.
   */
  imageGen?(params: ImageGenParams): Promise<ImageGenResponse>;

  /**
   * Streaming chat with function-call orchestration. Provider-specific
   * loop semantics encapsulated here — caller consumes ChatEvents.
   */
  chatWithTools?(
    params: GenerateParams,
    ctx: ChatToolContext,
  ): AsyncIterable<ChatEvent>;
}

export interface RoutePolicy {
  // ... existing fields ...

  /** When set, router only considers adapters whose corresponding
   *  optional method is defined. Used by MultiProviderClient.imageGen
   *  and .chatWithTools to skip non-supporting adapters. */
  requiredMethod?: "imageGen" | "chatWithTools";
}
```

### MultiProviderClient (`src/client/multi-provider-client.ts`)

```ts
class MultiProviderClient {
  // ... existing methods ...

  async imageGen(
    params: ImageGenParams,
    policy?: RoutePolicy,
  ): Promise<ImageGenResponse> {
    const effective = { ...this.mergePolicy(policy), requiredMethod: "imageGen" as const };
    const { adapter, selection } = this.router.selectAdapter(effective);
    if (!adapter.imageGen) {
      throw new CapabilityNotSupportedError(adapter.provider.id, "imageGen");
    }
    const response = await adapter.imageGen(params);
    this.onSelect?.(selection, { model: params.model, prompt: params.prompt });
    return response;
  }

  async *chatWithTools(
    params: GenerateParams,
    ctx: ChatToolContext,
    policy?: RoutePolicy,
  ): AsyncIterable<ChatEvent> {
    const effective = { ...this.mergePolicy(policy), requiredMethod: "chatWithTools" as const };
    const { adapter, selection } = this.router.selectAdapter(effective);
    if (!adapter.chatWithTools) {
      throw new CapabilityNotSupportedError(adapter.provider.id, "chatWithTools");
    }
    this.onSelect?.(selection, params);
    yield* adapter.chatWithTools(params, ctx);
  }
}
```

### Router (`src/provider/router.ts`)

`selectAdapter` already filters by capability metadata; extend filter to
also respect `policy.requiredMethod`. Adapters whose required method is
`undefined` are excluded before the preferred / fallback loop runs. If
no adapter remains, throw with a clear "no provider supports `<method>`"
message (preserve existing error class semantics).

### Gemini adapter

**imageGen.** Wraps `withRetry` over `genai.getGenerativeModel({ model }).generateContent({
  contents: [{ role: 'user', parts: [...referenceImages, { text: prompt }] }],
  generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
})`. Inspect `candidates[0].content.parts.find(p => p.inlineData?.data)`,
return `{ image: Buffer.from(b64, 'base64'), mimeType, usage }`.

- `options.dedicatedKey`: bypasses KeyPool — adapter constructs a one-off
  client. Useful for plate-redaction "paid key" pattern.
- `options.fallbackModel`: on a "not found" / "not supported" class
  error, retry once with the fallback model id; otherwise propagate.
- Usage tracked via the standard `extractUsage` helper.

**chatWithTools.** Re-uses `GeminiClient`'s key-pool + retry, then runs
the loop:

1. `chat = model.startChat({ history })`
2. `result = chat.sendMessageStream(prompt + images)`
3. for-await chunks: if `functionCalls()` present → emit `tool_call`
   event, call `ctx.onToolCall`, build `functionResponse` parts, set
   `result = chat.sendMessageStream(functionResponses)`, continue. If
   text → emit `text_delta`.
4. After stream end: if no text was emitted (the v2.22.x SDK quirk),
   fall back to `(await result.response).text()` and emit as a single
   `text_delta`.
5. Emit `usage` event from `response.usageMetadata` then `done` with
   the accumulated full text.
6. Round counter capped at `ctx.maxToolRounds ?? 5`.

### OpenCode adapter

**imageGen.** Not implemented (field undefined). Router skips this
adapter for image-gen routing.

**chatWithTools.** OpenCode's session API is one-shot
request/response. Replicate sheet-to-car's `OpenCodeProvider.chat`
algorithm:

1. Build prompt by flattening history into "User: / Assistant:" text
   lines + appending the new user turn.
2. Append a tool-prompt block (XML `<tool_call>{...}</tool_call>`
   protocol) to the system prompt when `params.tools` is non-empty.
3. Send to OpenCode → receive full response text.
4. Regex-extract `<tool_call>{ name, args }</tool_call>`. If found:
   - Emit any leading text as `text_delta`.
   - Emit `tool_call` event, await `ctx.onToolCall(...)`.
   - Append result to conversation, loop to step 3.
5. If no tool call found: strip any straggling `<tool_call>` tags,
   emit remaining text as `text_delta`, emit `done`.
6. Round counter capped at `ctx.maxToolRounds ?? 5`.

### OpenAI / OpenAI-compatible adapters

**chatWithTools.** Use OpenAI's `stream: true` + `tools: [...]` chat
completions. Stream events naturally interleave `delta.content`
(text) and `delta.tool_calls[]`. Map to `ChatEvent`:
- `delta.content` → `text_delta`
- complete `tool_calls[i]` → `tool_call` event; call `onToolCall`,
  feed `role: 'tool'` message back, continue stream.

**imageGen.** Not implemented in 3.4 (see Non-Goals).

### OpenRouter adapter

`chatWithTools` mirrors OpenAI behavior since OpenRouter uses the
OpenAI chat completions schema. `imageGen` not implemented.

## Backwards compatibility

- `GenerateResponse.toolCalls` is optional and undefined when no tools
  were declared. Existing callers reading `.text` see no behavior
  change.
- `ProviderAdapter.imageGen` / `chatWithTools` are optional methods.
  Existing custom adapters (if any external) compile without changes.
- `RoutePolicy.requiredMethod` is optional; existing call sites work
  unchanged.
- `MultiProviderClient` gains methods; doesn't change existing ones.
- No model schema renames; `ProviderCapabilities.imageOutput` is new
  and optional.

## Failure & Edge Cases

### Round-cap exhausted

If `maxToolRounds` rounds elapse without the model returning a
non-tool-call response, the adapter:
- Emits one final non-tool prompt round (no tools array, instructing
  the model to summarize), or
- Throws a `MaxToolRoundsExceededError`.

Choice: throw. Easier semantics. Callers who want graceful degradation
can wrap.

### Mid-loop provider failure

If the selected provider's stream throws mid-loop (rate limit,
network), the error propagates. No silent cross-provider fallback —
that would break the chat invariant (state lives in `chat.startChat`,
not transferable across providers). Caller may retry whole `chatWithTools`
call.

### Image-gen primary model unavailable

Gemini adapter's `options.fallbackModel` covers this: one retry on the
fallback, then surface the error. Router does NOT additionally try a
different provider unless `policy.allowCrossProviderFallback` is set
(in which case the next provider in chain may also support imageGen).

### Tool result too large

Tool results pass through as plain strings. No size cap enforced — if
the result blows the context window, the underlying model will error
on next round and surface naturally. Caller responsibility.

### dedicatedKey + KeyPool interaction

When `options.dedicatedKey` is set, the Gemini adapter:
- Does NOT allocate from the pool.
- Constructs a one-off `GoogleGenerativeAI(dedicatedKey)` client.
- Does NOT call `pool.release` (nothing to release).
- Tracks usage via the same `extractUsage` helper — caller can
  attribute usage to the dedicated key from the returned `usage`.

This matches sheet-to-car's `plate_redaction_api_key` semantics.

## Open Questions

None. All three capability shapes are derived from sheet-to-car's
shipped v2.23.0 implementation (proven against the actual use cases),
adapted to ai-core's existing `ProviderAdapter` / `MultiProviderClient`
conventions.

## Migration path for sheet-to-car

After ai-core 3.4.0 ships:

1. Bump `@kevinsisi/ai-core` to `3.4.0` (or a commit on `main`).
2. Delete `src/services/ai/providers/{gemini,openCode}Provider.ts`,
   `src/services/ai/router.ts`, `src/services/ai/types.ts`. Keep
   `src/services/ai/config.ts` (DB-driven RoutePolicy resolver) and
   `src/services/ai/index.ts` (singleton wiring).
3. Rewrite the singleton: `new MultiProviderClient({ adapters: [
   new GeminiProviderAdapter(keyPool), new OpenCodeProviderAdapter(...)
   ], defaultPolicy: dbDrivenPolicy() })`.
4. Convert call sites' `Message[]` shape to ai-core's `GenerateParams`
   (`{ model, prompt, images, history, tools }`).
5. Migrate plate redaction to `client.imageGen(...)`.
6. Migrate agent.ts chat to `client.chatWithTools(...)`.
7. Delete `src/services/geminiRetry.ts` (replaced by ai-core's
   `withRetry`). Delete `src/services/openCodeClient.ts` (replaced
   by `OpenCodeProviderAdapter`).
8. Net: −800 to −1000 LOC in sheet-to-car.
