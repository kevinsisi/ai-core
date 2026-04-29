# @kevinsisi/ai-core

HomeProject 共用的 AI 基礎模組，供旗下各服務（mind-diary、project-bridge、auto-spec-test、sheet-to-car…）引用。

## 一句話描述

Provider-aware multi-provider AI runtime — 整合 OpenAI / OpenRouter / Gemini / 自訂 provider，提供 KeyPool、retry、streaming、tools、agent-runtime 與 step-orchestration 等共用 primitives。

## 技術棧

- TypeScript（strict）+ tsup（雙格式 ESM / CJS 輸出）
- Vitest（測試）
- ESLint + Prettier
- Peer deps：`better-sqlite3`（optional，僅使用 `SqliteAdapter` 時需安裝）
- Runtime dep：`@google/generative-ai`
- 發布至 GitHub Packages（`@kevinsisi` scope）

## 主要功能

| 模組 | 內容 |
|---|---|
| `key-pool` | `KeyPool` 多 key 輪替與冷卻、可插拔 `StorageAdapter`、內建 `SqliteAdapter` |
| `retry` | `withRetry` provider-aware retry，內建 Gemini / OpenAI classifier，支援 quota / rate-limit / network 退避 |
| `client` | `GeminiClient`（pool-backed）、`MultiProviderClient`（router-backed）、provider-agnostic Tool schema |
| `agent-runtime` | `AgentRuntime` + active-task / pending-action / interrupt primitives |
| `step-orchestration` | `StepRunner` + preferred-key planning + lease heartbeat |
| `provider` | Provider/Model schema、`ProviderRouter`、Gemini / OpenAI / OpenRouter / OpenAI-compatible adapter |

### 架構原則

- **不可靜默 fallback**：key 不足時 throw `NoAvailableKeyError`；跨 provider/model 切換必須由顯式 routing policy 開啟
- **OpenAI-first routing**：預設 provider 優先序為 OpenAI → Gemini → OpenRouter
- **Gemini 相容層保留**：既有 Gemini-only 消費者不必立即遷移
- **`dist/` 必須 commit**：消費者透過 `git+https://` 安裝，不會在本地 build

## 部署方式

### 發布流程

```bash
npm run build        # tsup 產生 dist/
npm test             # vitest run
git tag vX.Y.Z
git push --tags      # GitHub Actions 自動發布至 GitHub Packages
```

### 消費者引用

```jsonc
// package.json
{
  "dependencies": {
    "@kevinsisi/ai-core": "github:kevinsisi/ai-core#vX.Y.Z"
  }
}
```

或經由 GitHub Packages npm registry：

```bash
# .npmrc
@kevinsisi:registry=https://npm.pkg.github.com

npm install @kevinsisi/ai-core
```

## URL

- Repo：<https://github.com/kevinsisi/ai-core>
- Packages：GitHub Packages（`@kevinsisi/ai-core`）

## 進一步資訊

詳細 API、開發規則、key-manager 整合準則請見 [CLAUDE.md](./CLAUDE.md)。
