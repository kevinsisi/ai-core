## Why

`@kevinsisi/ai-core` 已經集中處理 Gemini key pool、retry、GeminiClient，以及 agent runtime primitives，但 quota-sensitive multi-step workflows 仍主要留在 consumer app 自己實作。

目前像 `project-bridge` 這類 consumer 已經在應用層做出有效的模式：
- 把大型 Gemini 工作拆成可獨立重試的 named micro-steps
- 同一個 job 內讓不同 step 優先不同 key
- key 不足時明確進入 shared fallback，而不是假裝每步仍然獨立分 key
- 對長任務維持 lease heartbeat 與 step-level retry

這套模式已經被 HomeProject 規則接受，且 `homelab-docs` 已明文規定其正式實作位置應在 `@kevinsisi/ai-core`，而不是讓每個 consumer repo 各自複製。現在需要把這些 orchestration primitives 上收成 library API。

## What Changes

- Add a new micro-step orchestration module to `@kevinsisi/ai-core`
- Introduce typed step definitions for quota-sensitive workflows
- Add preferred-key planning and explicit shared-fallback semantics
- Add reusable lease-heartbeat support for long-running step execution
- Record step execution metadata so consumers can observe retries, key choice, fallback, and duration per step
- Document clear layering: ai-core owns generic orchestration primitives, while consumer apps still own domain-specific step content and business logic
- Bump version after implementation

## Capabilities

### New Capabilities

- `micro-step-orchestration`: Shared primitives for quota-sensitive Gemini workflows that need named steps, preferred-key planning, explicit fallback, and step-level execution metadata.

## Impact

- **`src/step-orchestration/*`**: new orchestration primitives module
- **`src/index.ts` + `package.json` + `tsup.config.ts`**: new export path and build entry
- **`src/__tests__/step-orchestration.test.ts`**: unit tests for step planning, fallback, and execution metadata
- **`README.md` / `CLAUDE.md`**: usage guidance and layering boundaries
- **No breaking changes** — existing KeyPool / withRetry / GeminiClient consumers remain valid until they choose to adopt the new orchestration layer
