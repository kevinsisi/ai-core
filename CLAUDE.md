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
├── agent-runtime/ AgentRuntime + active-task / pending-action primitives
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
| `@kevinsisi/ai-core/agent-runtime` | AgentRuntime, ActiveTask, TaskCheckpoint, PendingAction, InterruptEvent, CompletionCheckResult |

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

### AgentRuntime

`AgentRuntime` 只接受可安全 structured-clone 的結構化資料作為 `metadata` 與 `pendingAction.args`。

- 可接受：`string` / `number` / `boolean` / `null` / 陣列 / plain object
- 不可接受：function、class instance、或其他不可 structured clone 的值

---

## Key-Manager Integration Pattern

`ai-core` 提供 KeyPool 基礎設施，消費者服務可在此之上整合外部 key-manager 服務，實現集中式 key 管理。sheet-to-car 為參考實作（`src/routes/keys.ts`）。

### 整合流程

| 操作 | 方向 | 說明 |
|---|---|---|
| `syncFromManager` | key-manager → 消費者 | 從 `{key_manager_url}/api/keys/export` 拉取 available keys，透過 `addApiKey()` 寫入本地 pool |
| `testAllKeys` | 消費者 → Gemini API | 逐一對 pool 中的 active key 打 `generateContent`，依結果更新 `api_keys.cooldown_until` **並同步清除 `api_key_cooldowns`** |
| `reportToManager` | 消費者 → key-manager | 將本地 key 狀態（cooldown、失效）回報給 key-manager（依 key-manager 實作定義） |
| `getKeyStatus` | 消費者讀 pool | 透過 `KeyPool.status()` 或 `getKeyList()` 取得每把 key 的 available / cooldown / leased 狀態 |

### 重要規則：test 成功後必須雙清

`syncKeyPoolState()` 使用 `MAX(api_keys.cooldown_until, api_key_cooldowns.cooldown_until)` 合併 cooldown，因此 test 成功時**必須同時清除兩張表**：

```ts
db.prepare('UPDATE api_keys SET cooldown_until = 0 WHERE key = ?').run(key);
db.prepare('DELETE FROM api_key_cooldowns WHERE api_key_suffix = ?').run(key.slice(-4));
```

只更新 `api_keys` 不夠 — `api_key_cooldowns` 的舊值會在 `invalidateKeyCache()` 觸發 `syncKeyPoolState()` 時把 cooldown 還原。

### KeyPool.getAllocationLeaseMs()

```ts
const leaseMs = pool.getAllocationLeaseMs(); // 取得目前 allocationLeaseMs 設定值
```

供消費者在計算 lease 剩餘時間或記錄 lease 策略時使用。

---

## Lint & 格式化

```bash
npx eslint src/         # 靜態分析
npx prettier --check .  # 格式檢查
npx prettier --write .  # 自動格式化
```
