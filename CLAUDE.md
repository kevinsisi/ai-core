# @kevinsisi/ai-core — CLAUDE.md

## 專案用途

共用 AI 基礎模組，供 HomeProject 各服務引用。提供 Gemini API key pool、retry 邏輯、以及 GeminiClient 封裝。發布至 GitHub Packages，消費者透過 `git+https://` 或 `npm install @kevinsisi/ai-core` 引用。

**消費者專案：** mind-diary、project-bridge、auto-spec-test、sheet-to-car

---

## 架構

```
src/
├── key-pool/      KeyPool + StorageAdapter + SqliteAdapter
├── retry/         withRetry + classifyError
├── client/        GeminiClient
└── index.ts       統一 re-export
```

### KeyPool

管理多個 Gemini API key 的輪替與冷卻。依賴 `StorageAdapter` 介面存取 key 狀態，使用者可自行實作（例如 SQLite、PostgreSQL、記憶體）。

```ts
import { KeyPool } from '@kevinsisi/ai-core/key-pool';

const pool = new KeyPool(adapter, { cooldownMs: 60_000, authCooldownMs: 1_800_000 });
const [key] = await pool.allocate(1);
await pool.release(key, false);
```

### StorageAdapter

可插拔介面，任何後端皆可實作：

```ts
interface StorageAdapter {
  getKeys(): Promise<ApiKey[]>;
  updateKey(key: ApiKey): Promise<void>;
}
```

內建 `SqliteAdapter`（需 `better-sqlite3` peer dep，可選）。

### withRetry

Gemini-aware retry 裝飾器，自動分類錯誤並處理 quota / rate-limit / network 三種退避策略：

```ts
import { withRetry } from '@kevinsisi/ai-core/retry';

const result = await withRetry(
  () => callGemini(key),
  {
    maxRetries: 3,
    rotateKey: async () => pool.allocate(1).then(([k]) => k),
    onRetry: (event) => console.warn('retry', event),
  }
);
```

### GeminiClient

推薦入口，整合 KeyPool + withRetry，支援多模態輸入、串流、chat history、tools：

```ts
import { GeminiClient } from '@kevinsisi/ai-core/client';

const client = new GeminiClient(pool);

// 非串流
const { text, usage } = await client.generateContent({
  model: 'gemini-2.5-flash',
  prompt: 'Hello',
});

// 串流
for await (const chunk of client.streamContent({ model: 'gemini-2.5-flash', prompt: 'Hello' })) {
  process.stdout.write(chunk);
}

// 多模態
const { text } = await client.generateContent({
  model: 'gemini-2.5-flash',
  prompt: 'Describe this image',
  images: [{ type: 'inline', mimeType: 'image/png', data: base64Data }],
});
```

---

## 公開 API

| Export path | 匯出內容 |
|---|---|
| `@kevinsisi/ai-core` | KeyPool, StorageAdapter, withRetry, GeminiClient（全部） |
| `@kevinsisi/ai-core/key-pool` | KeyPool, SqliteAdapter, NoAvailableKeyError, ApiKey, StorageAdapter, KeyPoolOptions |
| `@kevinsisi/ai-core/retry` | withRetry, classifyError, MaxRetriesExceededError, ErrorClass, RetryOptions |
| `@kevinsisi/ai-core/client` | GeminiClient, StreamInterruptedError, ChatMessage, GenerateParams, GenerateResponse |

---

## 開發規則

### 建置格式
- **雙格式輸出**：ESM (`dist/*.js`) + CJS (`dist/*.cjs`)，由 tsup 產生
- **`dist/` 必須 commit**：消費者用 `git+https://` 安裝，不會在本地 build
- 每次修改 src/ 後必須執行 `npm run build` 並將 `dist/` 加入 commit

### 相依套件
- `better-sqlite3` 是 **optional peer dependency**，不得加入 `dependencies`
- 使用 `SqliteAdapter` 的消費者需自行安裝 `better-sqlite3`
- 不可在 `SqliteAdapter` 以外的程式碼中直接 `require`/`import` `better-sqlite3`

### 型別
- 嚴格 TypeScript：`strict: true`，禁止 `any`（使用 `unknown` 或明確型別）
- 所有公開 API 必須有明確的型別定義，不可依賴推斷的回傳型別

### 模型選擇
- **統一使用 `gemini-2.5-flash`** 作為預設及推薦模型
- 不可 hardcode 其他模型名稱於函式庫內部邏輯
- 消費者透過 `GenerateParams.model` 覆寫

### 其他約束
- **禁止 fallback 行為**：key 不足時直接 throw `NoAvailableKeyError`，不可靜默降級
- **禁止 hardcode 任何 API key 或憑證**，一律由 `StorageAdapter` 提供
- `console.*` 僅允許 `console.warn` / `console.error`，不可用 `console.log`

---

## 測試

```bash
npm test          # vitest run（單次）
npm run test:watch  # 監聽模式
```

測試位於 `src/__tests__/`，以 Vitest 執行。使用 vi.mock 隔離 `@google/generative-ai` 和 `node:fs`。

---

## 建置與部署

```bash
npm run build       # tsup — 輸出至 dist/
npm run build:check # tsc --noEmit 型別檢查
```

### 發布流程

1. 更新 `package.json` 版本號（遵循 semver）
2. 執行 `npm run build`，確認 `dist/` 更新
3. commit，包含 `dist/`
4. 打 git tag：`git tag vX.Y.Z && git push --tags`
5. GitHub Actions 自動發布至 GitHub Packages（僅 tag push 觸發）

### 消費者引用方式

```jsonc
// package.json
{
  "dependencies": {
    "@kevinsisi/ai-core": "github:kevinsisi/ai-core#vX.Y.Z"
  }
}
```

或透過 GitHub Packages npm registry：

```bash
npm install @kevinsisi/ai-core
```

（需在 `.npmrc` 設定 `@kevinsisi:registry=https://npm.pkg.github.com`）

---

## Lint & 格式化

```bash
npx eslint src/         # 靜態分析
npx prettier --check .  # 格式檢查
npx prettier --write .  # 自動格式化
```
