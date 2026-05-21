# Tasks — ai-core 3.4: image-gen + tool events

> Three independent feature tracks; T1 → T2 → T3 milestone order keeps the
> simplest change first. Each track ends in build + vitest green + a self-
> contained commit. Final task bumps version + README updates.

## T0 — OpenCode-first provider routing baseline

- [x] 0.1 Add OpenCode to built-in provider IDs/catalog and make default priority OpenCode → Gemini → OpenAI.
- [x] 0.2 Extend provider execution so explicit cross-provider fallback can retry the next compatible provider after selected-provider failure.
- [x] 0.3 Add tests for OpenCode-first selection, Gemini fallback on OpenCode failure, and no fallback without policy.
- [x] 0.4 Update README, project rules, and `multi-provider-support` spec for OpenCode-first routing semantics.

## T1 — `toolCalls` on `GenerateResponse` (smallest, isolated)

- [x] 1.1 Extend `src/client/types.ts`: new `ToolCall` interface, add `toolCalls?: ToolCall[]` to `GenerateResponse`.
- [x] 1.2 Update `src/client/gemini-client.ts:generateContent`: when response contains `functionCall` parts, populate `toolCalls`. Continue using `response.text()` for the `text` field — function-call payloads are not double-encoded into text.
- [x] 1.3 Update `src/provider/adapters/openai.ts` & `openai-compatible.ts` (if present): map `choices[0].message.tool_calls` to ai-core `ToolCall[]`.
- [x] 1.4 Update `src/provider/adapters/opencode.ts:generateContent`: regex-extract `<tool_call>{...}</tool_call>` blocks from the response text, populate `toolCalls`, strip the matched substrings from `text`.
- [x] 1.5 Add vitest cases: Gemini function-call response, OpenAI tool-call response, OpenCode XML response, plain text response (no `toolCalls`).
- [x] 1.6 `npm run build:check && npm test`.
- [x] 1.7 T1 commit `feat(client): surface toolCalls on GenerateResponse (T1/3)` — committed as `4e68510`.

## T2 — `imageGen` capability

- [x] 2.1 Extend `src/client/types.ts`: `ImageGenParams`, `ImageGenResponse`. Extend `ProviderCapabilities` (`src/provider/schema.ts`) with optional `imageOutput?: boolean`.
- [x] 2.2 Extend `src/provider/types.ts`: optional `imageGen?(params): Promise<ImageGenResponse>` on `ProviderAdapter`; optional `requiredMethod?: 'imageGen' | 'chatWithTools'` on `RoutePolicy`.
- [x] 2.3 Extend `src/provider/router.ts:selectAdapter`: filter adapters by `policy.requiredMethod` if set (exclude adapters whose corresponding method is `undefined`).
- [x] 2.4 Add Gemini-specific image-gen call site in `src/provider/adapters/gemini.ts`: implement `imageGen(params)` against `generateContent({ contents: [...refImages, {text:prompt}], generationConfig: { responseModalities: ['IMAGE','TEXT'] }})`. Honor `options.fallbackModel` (one retry on a model-not-found-class error) and `options.dedicatedKey` (bypass KeyPool — construct a one-off `GoogleGenerativeAI` client).
- [x] 2.5 Mark Gemini image preview models (`gemini-3-pro-image-preview`, `gemini-2.5-flash-image`) with `capabilities.imageOutput: true` in `src/provider/models.ts`.
- [x] 2.6 Extend `src/client/multi-provider-client.ts`: add `imageGen(params, policy?)` proxying via router; throws `CapabilityNotSupportedError` when no candidate supports it.
- [x] 2.7 Re-export `ImageGenParams`, `ImageGenResponse`, `imageGen` method from `src/client/index.ts` & root `src/index.ts`.
- [x] 2.8 vitest cases: Gemini happy path (primary model), Gemini fallback model retry on 404, dedicated-key bypasses pool, OpenCode adapter throws `CapabilityNotSupportedError`, router skips OpenCode silently and selects Gemini when chain is `['opencode','gemini']`.
- [x] 2.9 `npm run build:check && npm test`.
- [ ] 2.10 T2 commit `feat(provider): add imageGen capability with Gemini adapter (T2/3)`.

## T3 — `chatWithTools` (streaming + tool loop)

- [ ] 3.1 Extend `src/client/types.ts`: `ChatEvent` discriminated union (`text_delta` / `tool_call` / `usage` / `done`), `ChatToolContext` ({ `onToolCall`, `maxToolRounds` }).
- [ ] 3.2 Extend `src/provider/types.ts`: optional `chatWithTools?(params, ctx): AsyncIterable<ChatEvent>` on `ProviderAdapter`.
- [ ] 3.3 Implement `GeminiProviderAdapter.chatWithTools`: bridge `chat.sendMessageStream` to AsyncIterable via internal queue; loop on `functionCalls()` → `ctx.onToolCall` → re-stream; emit `text_delta` for text chunks, `tool_call` events for function calls, `usage` from `response.usageMetadata`, `done` with full accumulated text. Round cap = `ctx.maxToolRounds ?? 5`. Preserve the v2.22.x empty-chunk-after-function-call SDK fallback (`(await result.response).text()`).
- [ ] 3.4 Implement `OpenCodeProviderAdapter.chatWithTools`: flatten history to "User:/Assistant:" prompt, build tool-description block when `params.tools` present, loop on `<tool_call>{name,args}</tool_call>` regex → `ctx.onToolCall` → continue. Emit final assistant text as a single `text_delta` followed by `done`. Round cap respected.
- [ ] 3.5 Implement `OpenAIProviderAdapter.chatWithTools` (and `openai-compatible`): use OpenAI chat completions streaming with `tools` array; map `delta.content` → `text_delta`, complete `tool_calls[i]` → `tool_call` event + push `role:'tool'` message back into the next stream call.
- [ ] 3.6 Implement `OpenRouterProviderAdapter.chatWithTools`: same shape as OpenAI (compatible API).
- [ ] 3.7 Extend `src/client/multi-provider-client.ts`: `async *chatWithTools(params, ctx, policy?)` proxies via router with `requiredMethod: 'chatWithTools'`; fires `onSelect` with selection before yielding.
- [ ] 3.8 Add `MaxToolRoundsExceededError` to errors export; thrown when loop exceeds `ctx.maxToolRounds`.
- [ ] 3.9 Re-export `ChatEvent`, `ChatToolContext`, `MaxToolRoundsExceededError`, `chatWithTools` from `src/client/index.ts` & root `src/index.ts`.
- [ ] 3.10 vitest cases: Gemini text-only stream, Gemini single tool call round, Gemini multi-round (model calls tool twice), Gemini empty-chunk fallback path; OpenCode XML loop happy path + max-rounds cap; OpenAI streaming tool call; cross-adapter `MaxToolRoundsExceededError`.
- [ ] 3.11 `npm run build:check && npm test`.
- [ ] 3.12 T3 commit `feat(client): add chatWithTools AsyncIterable<ChatEvent> (T3/3)`.

## T4 — Release plumbing

- [ ] 4.1 Bump `package.json` version `3.3.x` → `3.4.0`.
- [ ] 4.2 Update `src/version.ts` `AI_CORE_VERSION` constant.
- [ ] 4.3 Update `README.md`: usage sections for `toolCalls` field, `imageGen`, `chatWithTools`. Document `options.fallbackModel` / `options.dedicatedKey` for Gemini imageGen. Document `maxToolRounds` default and override.
- [ ] 4.4 Run full vitest suite — all green.
- [ ] 4.5 `npm run build` (tsup) — produce dist for all `exports` paths.
- [ ] 4.6 T4 commit `chore: bump v3.4.0 + README updates (T4/3)`.
- [ ] 4.7 Open PR `feat/3.4-image-gen-tool-events` → `main`, wait for Kevin review.
- [ ] 4.8 After merge: tag `v3.4.0`, publish to GitHub Packages npm registry (`npm publish`).

## T5 — sheet-to-car migration (downstream, separate repo PR)

- [ ] 5.1 In `sheet-to-car`, bump `@kevinsisi/ai-core` to the new commit / `v3.4.0` tag.
- [ ] 5.2 Delete `src/services/ai/types.ts`, `router.ts`, `providers/geminiProvider.ts`, `providers/openCodeProvider.ts`.
- [ ] 5.3 Rewrite `src/services/ai/index.ts` as a thin `MultiProviderClient` singleton plus `getRoutePolicyFromSettings()` reading `settings.provider_routing`. Translate the JSON chain into ai-core's `RoutePolicy` shape per call.
- [ ] 5.4 Keep `src/services/ai/config.ts` (DB-driven policy reader / writer) — possibly trim once it's a thin shim.
- [ ] 5.5 Convert 6 generate call sites to ai-core `GenerateParams`: `{ model: getGeminiModel(), prompt, images, history, tools, systemInstruction }`. Replace `aiRouter.generate({ messages, options })` with `client.generateContent(params, policy)`.
- [ ] 5.6 Convert `agent.ts` chat: `client.chatWithTools({ model, prompt, history, tools, systemInstruction }, { onToolCall: ..., maxToolRounds: 3 }, policy)` and consume the AsyncIterable.
- [ ] 5.7 Convert plate redaction strategies: `client.imageGen({ model, prompt, referenceImages, options: { fallbackModel, dedicatedKey } })`.
- [ ] 5.8 Delete `src/services/geminiRetry.ts` (ai-core `withRetry` + `KeyPool` cover this).
- [ ] 5.9 Delete `src/services/openCodeClient.ts` (`OpenCodeProviderAdapter` covers this; `isOpenCodeConfigured` UI helper can move into `src/services/ai/config.ts`).
- [ ] 5.10 Build + lint + e2e regression sweep.
- [ ] 5.11 Bump sheet-to-car version `2.23.x` → `2.24.0`. Update CHANGELOG to credit ai-core 3.4 adoption.
- [ ] 5.12 PR `dev` → review → merge → deploy.
- [ ] 5.13 Archive both openspec changes (ai-core 3.4 + sheet-to-car ai-provider-interface).
