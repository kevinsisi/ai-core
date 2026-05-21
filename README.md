# @kevinsisi/ai-core

HomeProject 共用的 AI 基礎模組，供旗下各服務（mind-diary、project-bridge、auto-spec-test、sheet-to-car…）引用。

## 一句話描述

Provider-aware multi-provider AI runtime — 整合 OpenAI / OpenRouter / Gemini / OpenCode session API / 自訂 provider，提供 KeyPool、retry、streaming、tools、agent-runtime 與 step-orchestration 等共用 primitives。

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
| `provider` | Provider/Model schema、`ProviderRouter`、Gemini / OpenAI / OpenRouter / OpenCode / OpenAI-compatible adapter |

### 架構原則

- **不可靜默 fallback**：key 不足時 throw `NoAvailableKeyError`；跨 provider/model 切換與 provider 執行失敗後重試都必須由顯式 routing policy 開啟
- **OpenCode-first routing**：預設 provider 優先序為 OpenCode → Gemini → OpenAI；非圖片 HomeProject AI 可用 OpenCode 優先、Gemini fallback，圖片生成仍由 Gemini capability path 負責
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

## 3.4 新增 capability 使用範例

### 1. `toolCalls` 出現在 `GenerateResponse`

當 model 回傳 function call，`generateContent` 不再吞掉，會把結構化的 tool calls 放在 response 上：

```ts
import { MultiProviderClient } from "@kevinsisi/ai-core";

const response = await client.generateContent({
  model: "gemini-2.5-flash",
  prompt: "找一台 BMW M3",
  tools: [{ type: "function", name: "search_cars", parameters: { /* JSON Schema */ } }],
});

if (response.toolCalls?.length) {
  for (const call of response.toolCalls) {
    console.log("model wants to call", call.name, call.args);
  }
}
```

OpenCode adapter 也會把 `<tool_call>{...}</tool_call>` XML 區塊解析成同樣的 ToolCall shape，所以 caller 不用知道 provider 是誰。

### 2. `imageGen` capability

```ts
const result = await client.imageGen({
  model: "gemini-3-pro-image-preview",
  prompt: "Inpaint the license plate with this logo",
  referenceImages: [
    { type: "inline", mimeType: "image/jpeg", data: originalBase64 },
    { type: "inline", mimeType: "image/png", data: logoBase64 },
  ],
  options: {
    fallbackModel: "gemini-2.5-flash-image",  // 主 model 不存在時自動 fallback
    dedicatedKey: process.env.PAID_GEMINI_KEY,  // 繞過 KeyPool 用付費 key
  },
});
result.images[0]; // { mimeType: 'image/png', data: '<base64>' }
```

OpenCode adapter 沒實作 `imageGen`，router 會自動跳過、選擇下一個支援的 provider；全部都沒人支援就 throw `CapabilityNotSupportedError`。

### 3. `chatWithTools` streaming + tool loop

```ts
for await (const ev of client.chatWithTools(
  {
    model: "gemini-2.5-flash",
    prompt: "庫存有多少台 BMW？",
    tools: [{ type: "function", name: "get_stats", parameters: {} }],
    history: [/* ChatMessage[] */],
    systemInstruction: "...",
  },
  {
    onToolCall: async (call) => executeMyTool(call.name, call.args),
    maxToolRounds: 3,  // 預設 5
  },
)) {
  switch (ev.type) {
    case "text_delta":   process.stdout.write(ev.delta); break;
    case "tool_call":    console.log("[tool]", ev.name, ev.args); break;
    case "usage":        console.log("tokens:", ev.usage.totalTokens); break;
    case "done":         console.log("\n--- done:", ev.fullText); break;
  }
}
```

Provider 內部處理 function-call 迴圈：streaming chunk 進來時，看到 tool call 就觸發 `onToolCall`、把結果塞回對話、繼續 stream，caller 收到的事件流是統一的。Round cap 防止無窮回圈，超過時 throw `MaxToolRoundsExceededError`。

OpenCode adapter 也支援 `chatWithTools`，但因 session API 是一次性 request/response，所以是 round-by-round 而非 token-by-token streaming — 每輪整段文字會作為單一 `text_delta` 出現。

## URL

- Repo：<https://github.com/kevinsisi/ai-core>
- Packages：GitHub Packages（`@kevinsisi/ai-core`）

## 進一步資訊

詳細 API、開發規則、key-manager 整合準則請見 [CLAUDE.md](./CLAUDE.md)。
