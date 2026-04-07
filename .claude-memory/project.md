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

**Deployment:**
- Published to GitHub Packages (`npm.pkg.github.com`) via GitHub Actions on `vX.Y.Z` tag push
- Consumers reference via `github:kevinsisi/ai-core#vX.Y.Z` or npm registry
- `dist/` is committed — consumers install without building locally

**Key constraints:**
- Default/recommended model: `gemini-2.5-flash`
- No fallback on key exhaustion — throw `NoAvailableKeyError` immediately
- No hardcoded credentials — always sourced from StorageAdapter
- `better-sqlite3` is optional peer dep — must not be in `dependencies`
- Dual-format build (ESM + CJS) via tsup — always rebuild and commit dist/ with src changes
