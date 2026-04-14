## Why

`@kevinsisi/ai-core` 目前仍是 Gemini-first / Gemini-only 架構：
- `KeyPool` 假設 key pool 是 Gemini key pool
- `GeminiClient` 是唯一內建 model client
- retry / error classification 主要也是 Gemini error 型態

這對 HomeProject 現況已經不夠：
- Gemini key pool 常遇到 `429`
- 單純增加 Gemini key 無法解決所有容量問題
- 某些工作應能 fallback 到其他 provider / model，例如 OpenAI

`opencode` 的架構證明，多 provider 支援不應只停在 key pool 層，而應升級成：
- provider-aware
- model-aware
- auth-aware
- routing-policy-driven

因此 `ai-core` 需要新增多 provider / 多 model 基礎架構，讓 consumer 不再只能做單一 Gemini provider 的 key rotation。

## What Changes

- Add provider / model schema and registry primitives
- Add provider auth abstraction that supports at least API-key style credentials, with room for later OAuth-style provider auth
- Add provider adapter interface so each provider can map its own client / request / capability semantics
- Add routing policy primitives so consumers can choose provider → model → key in a structured way, with fallback only when explicitly enabled by policy
- Keep Gemini support working as the initial built-in provider
- Add OpenAI as the first non-Gemini provider target in the design scope

## Capabilities

### New Capabilities

- `multi-provider-support`: shared provider/model/auth/routing primitives for Gemini-first but not Gemini-only AI runtime design.

## Impact

- **`src/provider/*`**: new provider / model / auth / routing primitives
- **`src/client/*`**: move from Gemini-only toward provider-aware clients or adapters
- **`README.md` / `CLAUDE.md`**: update architecture and usage guidance
- **No breaking removal in the first step** — existing Gemini consumer APIs should keep working during migration
- **Phase-1 credential boundary** — first implementation should rely on consumer-supplied provider-specific API-key credentials, not a full generalized credential store yet
