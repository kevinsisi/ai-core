## Why

sheet-to-car's 2026-05-21 AI provider refactor (see
`sheet-to-car/openspec/changes/2026-05-21-ai-provider-interface/`) wanted
to delete its locally-grown `AIProvider` abstraction and adopt
`@kevinsisi/ai-core`'s mature multi-provider stack instead. ai-core 3.3.0
already covers ~80% — `ProviderRouter` / `MultiProviderClient` /
`GeminiProviderAdapter` / `OpenCodeProviderAdapter` / `RoutePolicy` are all
exported. Three gaps block full adoption:

1. **No image generation capability.** `ProviderAdapter` only models
   text/multimodal-input generation. Sheet-to-car's plate redaction calls
   Gemini's image-gen API (`responseModalities: ['IMAGE', 'TEXT']`) and
   currently bypasses any abstraction by importing the raw Gemini SDK.

2. **`GenerateResponse` loses tool calls.** When a Gemini call returns a
   `functionCall` part, `GenerateResponse.text` is just `response.text()`
   — function-call payloads are silently dropped. Callers wanting to
   orchestrate a tool-use loop have to bypass ai-core and use the raw
   SDK to inspect `candidates[0].content.parts[].functionCall`.

3. **Streaming + function-calling is not modeled.** `streamContent`
   returns `AsyncGenerator<string>` (text chunks only). Sheet-to-car's
   AI chat needs to emit token-by-token text PLUS surface tool-call
   events PLUS round-trip tool results back into the model — i.e. a
   chat loop. Currently the only way is to use raw Gemini SDK
   `chat.sendMessageStream` outside of ai-core.

Closing these three gaps lets downstream consumers (sheet-to-car first,
others later) delete locally-grown provider abstractions and rely on
ai-core for the full breadth of AI capabilities they actually use.

## What Changes

### imageGen capability

- New optional `imageGen` method on `ProviderAdapter`: takes a prompt
  plus optional reference images, returns image bytes + MIME type.
- `ImageGenParams` / `ImageGenResponse` types in `client/types.ts`.
- `GeminiProviderAdapter` implements `imageGen` against Gemini's
  `responseModalities: ['IMAGE', 'TEXT']` API. Supports `options.model`
  override and `options.fallbackModel` for the
  `gemini-3-pro-image-preview` → `gemini-2.5-flash-image` cascade.
- `MultiProviderClient` gains `imageGen(params, policy)`. Same routing
  semantics as `generateContent` (preferred / fallback / capability
  filtering — adapters that don't implement `imageGen` are skipped).
- Other adapters (OpenAI, OpenRouter, OpenAI-compatible, OpenCode)
  leave `imageGen` undefined; router skips them silently for image-gen
  requests.
- New capability flag on `ModelDefinition.capabilities`: `imageOutput`
  (Gemini image preview models declare `true`).

### toolCalls in GenerateResponse

- Extend `GenerateResponse` with `toolCalls?: ToolCall[]` —
  `ToolCall = { id, name, args: Record<string, unknown> }`.
- `GeminiClient.generateContent` populates `toolCalls` when the
  response includes `functionCall` parts. `text` continues to be the
  text-only content; no double-encoding.
- `OpenAIProviderAdapter` populates `toolCalls` from `tool_calls`.
- `OpenCodeProviderAdapter` populates `toolCalls` by parsing
  `<tool_call>` XML blocks out of the response text (best-effort —
  OpenCode is prompt-driven not native-tool-call).
- Backwards-compatible: existing callers ignore the new field; if a
  caller doesn't pass `tools`, `toolCalls` is always undefined.

### chatWithTools (streaming + tool loop)

- New `MultiProviderClient.chatWithTools(params, ctx)` returning
  `AsyncIterable<ChatEvent>`.
- `ChatEvent = { type: 'text_delta', delta: string }`
              `| { type: 'tool_call', id, name, args }`
              `| { type: 'usage', usage: TokenUsage }`
              `| { type: 'done', fullText: string }`.
- `ctx = { onToolCall(call): Promise<string> }` — caller-supplied
  executor. Adapter loops internally: stream → see tool call → call
  `ctx.onToolCall` → push tool result back → continue stream.
- `GeminiProviderAdapter` implements via
  `chat.sendMessageStream` + native `functionCalls()` API,
  re-streaming after function responses are fed back. Preserves the
  Gemini-SDK "empty-chunk-after-function-call" workaround sheet-to-car
  pinned in v2.22.x.
- `OpenCodeProviderAdapter` implements via the existing one-shot
  request/response + `<tool_call>` XML loop, emitting the full text
  as a single `text_delta` (OpenCode session API does not stream).
- Both providers cap the function-call loop at a configurable
  `maxToolRounds` (default 5) to avoid runaway recursion.
- Router policy honored: provider selection happens once at the start;
  if the selected provider fails mid-loop, the error surfaces (no
  silent cross-provider mid-loop fallback).

### Other

- `package.json` version `3.3.x` → `3.4.0`
- Vitest suite extended with mocked adapter test for each capability
- README usage examples for all three new APIs

## Capabilities

### New Capabilities

- `image-generation`: ai-core exposes a provider-routed image
  generation capability with optional reference images and
  provider-specific options. Adapters opt in by implementing the
  optional `ProviderAdapter.imageGen` method; the router skips
  non-supporting adapters.
- `tool-calls-in-response`: `GenerateResponse` carries structured
  `toolCalls` alongside `text` so callers can orchestrate tool-use
  loops without re-parsing provider-specific payloads.
- `streaming-tool-loop`: `MultiProviderClient.chatWithTools` exposes
  a provider-agnostic `AsyncIterable<ChatEvent>` driving a function-
  call loop, with a caller-supplied tool executor and a bounded round
  cap.

### Modified Capabilities

- `multi-provider-support`: extended to include `imageGen` selection
  semantics (router silently skips adapters lacking the capability)
  and `chatWithTools` semantics (provider selected once, loop runs to
  completion on selected provider).

## Impact

- **`src/client/types.ts`** — new `ImageGenParams`, `ImageGenResponse`,
  `ToolCall`, `ChatEvent`, `ChatToolContext` types; `GenerateResponse`
  gains `toolCalls?`.
- **`src/client/gemini-client.ts`** — populate `toolCalls` from
  Gemini function-call parts; new `imageGen` and `chatWithTools`
  methods.
- **`src/client/multi-provider-client.ts`** — proxy `imageGen` and
  `chatWithTools` through `ProviderRouter`.
- **`src/provider/types.ts`** — optional `imageGen` + `chatWithTools`
  methods on `ProviderAdapter`.
- **`src/provider/adapters/gemini.ts`** — implement both new methods.
- **`src/provider/adapters/opencode.ts`** — implement
  `chatWithTools` (XML loop); leave `imageGen` undefined.
- **`src/provider/adapters/{openai,openai-compatible,openrouter}.ts`** —
  implement `chatWithTools` (native tool-call streaming where the
  provider supports it). Leave `imageGen` for a follow-up.
- **`src/provider/router.ts`** — `selectAdapter` honors a new
  `requiredMethod` flag so capability-aware skip works for optional
  methods.
- **`src/provider/schema.ts`** — `ProviderCapabilities` gains
  `imageOutput?: boolean`; `defaultProviderPriority` left unchanged.
- **`src/__tests__/`** — unit coverage for all three new capabilities
  with mocked adapters.
- **`package.json`** — `3.4.0`.
- **`README.md`** — usage sections for `imageGen`, `chatWithTools`,
  tool-call orchestration.

### Downstream impact

- **sheet-to-car** can delete its locally-grown
  `src/services/ai/providers/` after upgrading to ai-core 3.4.0, since
  every gap that motivated the local abstraction is now covered.
  Estimated cleanup: -400 LOC.
- Other consumers (onshape-skill, future projects) get the three new
  capabilities for free.

## Non-Goals

- Not adding OpenAI image-gen (DALL-E / `gpt-image-1`) — Gemini-only
  for 3.4.0. OpenAI image-gen has a different shape (no reference
  image support in many tiers, response is a URL not bytes) and
  warrants its own design pass.
- Not changing `generateContent` to throw on tool-call responses —
  keeping it backwards-compatible. Callers wanting tool orchestration
  use `chatWithTools` or inspect `toolCalls` themselves.
- Not adding mid-loop provider fallback for `chatWithTools` — once
  selection happens, the loop runs to completion on that provider.
- Not adding session reuse across `chatWithTools` calls — each call
  is a one-shot multi-turn loop with the supplied history. (OpenCode
  session reuse is already configurable on the adapter, separately.)
- Not extending `streamContent` to emit `ChatEvent` — `streamContent`
  stays as the simple `AsyncGenerator<string>` text streamer.
  `chatWithTools` is the new explicit API for callers who need tool
  events.
