---
name: ai-core project context
description: Purpose, consumers, architecture, and deployment of @kevinsisi/ai-core
type: project
---

@kevinsisi/ai-core — shared Gemini infrastructure package for the HomeProject ecosystem.

**Consumers:** mind-diary, project-bridge, auto-spec-test, sheet-to-car

**Why:** Centralises Gemini key pool rotation, retry logic, and client wrapper so all four services share identical behaviour and don't each reinvent quota handling.

**Architecture modules:**
- `key-pool` — KeyPool + StorageAdapter interface + SqliteAdapter (optional peer dep)
- `retry` — withRetry decorator with Gemini-aware error classification
- `client` — GeminiClient wrapping KeyPool + withRetry with multimodal support
- `agent-runtime` — shared active-task, pending-action, interrupt, and completion-gate primitives for long-running agents
- `step-orchestration` — shared named-step runner, preferred-key planning, lease heartbeat, and step execution metadata for quota-sensitive workflows

**Deployment:**
- Published to GitHub Packages (`npm.pkg.github.com`) via GitHub Actions on `vX.Y.Z` tag push
- Consumers reference via `github:kevinsisi/ai-core#vX.Y.Z` or npm registry
- `dist/` is committed — consumers install without building locally

**Key-Manager Integration (v2.0.0+):**
- sheet-to-car 為參考實作，`src/routes/keys.ts` 實現 syncFromManager / testAllKeys 模式
- test 成功時必須雙清：`api_keys.cooldown_until = 0` + `DELETE FROM api_key_cooldowns`（只清 api_keys 不夠，syncKeyPoolState MAX 合併會還原 cooldown）
- `KeyPool.getAllocationLeaseMs()` 新增：供消費者讀取 allocationLeaseMs 設定值
- `KeyPool.status()` 供 getKeyStatus 用途：回傳所有 key 的即時狀態

**Key constraints:**
- Default/recommended model: `gemini-2.5-flash`
- No fallback on key exhaustion — throw `NoAvailableKeyError` immediately
- No hardcoded credentials — always sourced from StorageAdapter
- `better-sqlite3` is optional peer dep — must not be in `dependencies`
- Dual-format build (ESM + CJS) via tsup — always rebuild and commit dist/ with src changes
