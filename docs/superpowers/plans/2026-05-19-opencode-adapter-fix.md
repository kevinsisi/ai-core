# OpenCode Adapter Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 `OpenCodeProviderAdapter` 的兩個 bug，並加入 basic auth 支援，使其可以正確對接 opencode server（Gemini 替代方案）。

**Architecture:** 修改 `src/provider/adapters/opencode.ts`：(1) 修正 API payload 的 model 欄位名稱 `id` → `modelID`，(2) generateContent 結束後 DELETE session，(3) 加入 basic auth 選項給 OPENCODE_SERVER_PASSWORD。更新對應測試。

**Tech Stack:** TypeScript, vitest, fetch API

---

## File Map

| 動作 | 檔案 |
|---|---|
| Modify | `src/provider/adapters/opencode.ts` |
| Modify | `src/__tests__/provider.test.ts`（opencode 區塊） |

---

### Task 1: 修正 model 欄位名稱 + 加入 session cleanup

**Files:**
- Modify: `src/provider/adapters/opencode.ts`

背景：opencode API 要求 `{ modelID, providerID }`，但現在的 code 送出 `{ id, providerID }`，導致 `Missing key at ["model"]["modelID"]` 錯誤。同時 session 用完沒有清理，會在 server 無限累積。

- [x] **Step 1: 加入 API payload 型別和 deleteSession 方法**

在 `src/provider/adapters/opencode.ts`，修改以下內容：

```typescript
// 加在 OpenCodeMessageResponse 後面，這是送給 API 的格式
interface OpenCodeModelPayload {
  modelID: string;
  providerID: string;
}

function modelToPayload(model: OpenCodeModelRef): OpenCodeModelPayload {
  return { modelID: model.id, providerID: model.providerID };
}
```

- [x] **Step 2: 修正 createSession 的 model payload**

```typescript
// 修改前
body: JSON.stringify({ title: this.title, agent: this.agent, model }),

// 修改後
body: JSON.stringify({ title: this.title, agent: this.agent, model: modelToPayload(model) }),
```

- [x] **Step 3: 修正 sendMessage 的 model payload**

```typescript
// 修改前
body: JSON.stringify({
  agent: this.agent,
  model,
  ...(params.systemInstruction && { system: params.systemInstruction }),
  parts: [{ type: "text", text: params.prompt }],
}),

// 修改後
body: JSON.stringify({
  agent: this.agent,
  model: modelToPayload(model),
  ...(params.systemInstruction && { system: params.systemInstruction }),
  parts: [{ type: "text", text: params.prompt }],
}),
```

- [x] **Step 4: 加入 deleteSession 方法**

在 `readJson` 方法前加入：

```typescript
private deleteSession(sessionID: string): void {
  fetch(`${this.baseURL}/session/${encodeURIComponent(sessionID)}`, {
    method: "DELETE",
    headers: this.buildHeaders(),
  }).catch(() => {}); // fire-and-forget
}
```

- [x] **Step 5: 在 generateContent 的 finally 呼叫 deleteSession**

```typescript
async generateContent(params: GenerateParams): Promise<GenerateResponse> {
  if (params.images?.length) {
    throw new Error("OpenCode adapter does not support multimodal input yet");
  }

  const model = this.resolveModel(params.model);
  if (!model) {
    throw new Error(`OpenCode adapter cannot resolve model "${params.model}"`);
  }

  const session = await this.createSession(model);
  try {
    const message = await this.sendMessage(session.id, params, model);
    const text = (message.parts ?? [])
      .filter((part): part is OpenCodeTextPart => part.type === "text")
      .map((part) => part.text)
      .join("");
    const tokens = message.info?.tokens;

    return {
      text,
      usage: tokens
        ? {
            promptTokens: tokens.input ?? 0,
            completionTokens: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
            totalTokens: (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0),
          }
        : null,
    };
  } finally {
    this.deleteSession(session.id);
  }
}
```

---

### Task 2: 加入 basic auth 選項

**Files:**
- Modify: `src/provider/adapters/opencode.ts`

背景：opencode server 的 `OPENCODE_SERVER_PASSWORD` 使用 HTTP basic auth（不是 Bearer token）。格式為 `Authorization: Basic base64("opencode:${password}")`。

- [x] **Step 1: 在 OpenCodeAdapterOptions 加入 basicAuth 選項**

```typescript
export interface OpenCodeAdapterOptions {
  baseURL?: string;
  agent?: string;
  title?: string;
  defaultModel: OpenCodeModelRef;
  basicAuth?: boolean; // true 時用 Basic auth（for OPENCODE_SERVER_PASSWORD）
}
```

並在 constructor 儲存：

```typescript
private readonly basicAuth: boolean;

constructor(credential: OpenCodeCredential, options: OpenCodeAdapterOptions) {
  // ...existing...
  this.basicAuth = options.basicAuth ?? false;
}
```

- [x] **Step 2: 修正 buildHeaders 支援 basic auth**

```typescript
private buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (this.basicAuth && this.credential.type === "api" && this.credential.apiKey) {
    const encoded = Buffer.from(`opencode:${this.credential.apiKey}`).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  } else if (this.credential.type === "api" && this.credential.apiKey) {
    headers.Authorization = `Bearer ${this.credential.apiKey}`;
  } else if (this.credential.type === "oauth" && this.credential.accessToken) {
    headers.Authorization = `Bearer ${this.credential.accessToken}`;
  }
  return headers;
}
```

---

### Task 3: 更新測試

**Files:**
- Modify: `src/__tests__/provider.test.ts`（`describe("opencode provider adapter")` 區塊）

- [x] **Step 1: 修正 model payload 的 test expectation**

找到這兩段並更新：

```typescript
// createSession 呼叫
expect(calls[0].body).toEqual({
  title: "Model test",
  agent: "general",
  model: { providerID: "openai", modelID: "gpt-5.5" }, // 改：id → modelID
});

// sendMessage 呼叫
expect(calls[1].body).toEqual({
  agent: "general",
  model: { providerID: "openai", modelID: "gpt-5.5" }, // 改：id → modelID
  system: "Be concise",
  parts: [{ type: "text", text: "hi" }],
});
```

- [x] **Step 2: 加入 session cleanup 的測試**

在 `describe("opencode provider adapter")` 裡加入新的 test：

```typescript
it("deletes the session after generateContent completes", async () => {
  const deletedSessions: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    if (init.method === "DELETE") {
      deletedSessions.push(url);
      return { ok: true, json: async () => ({}) };
    }
    if (url.endsWith("/session")) {
      return { ok: true, json: async () => ({ id: "sess-cleanup" }) };
    }
    return {
      ok: true,
      json: async () => ({
        parts: [{ type: "text", text: "done" }],
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  const adapter = new OpenCodeProviderAdapter(
    { type: "api", provider: "opencode", apiKey: "tok", baseURL: "http://localhost:4096/" },
    { defaultModel: { providerID: "google", id: "gemini-2.5-flash" } }
  );

  await adapter.generateContent({ model: "google/gemini-2.5-flash", prompt: "hi" });

  // Wait one tick for the fire-and-forget DELETE to fire
  await new Promise((r) => setTimeout(r, 0));
  expect(deletedSessions).toContain("http://localhost:4096/session/sess-cleanup");
});
```

- [x] **Step 3: 加入 basic auth 的測試**

```typescript
it("uses Basic auth when basicAuth option is true", async () => {
  let capturedHeaders: Record<string, string> = {};
  const fetchMock = vi.fn(async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    capturedHeaders = init.headers;
    if (url.endsWith("/session")) {
      return { ok: true, json: async () => ({ id: "s1" }) };
    }
    return { ok: true, json: async () => ({ parts: [{ type: "text", text: "ok" }] }) };
  });
  vi.stubGlobal("fetch", fetchMock);

  const adapter = new OpenCodeProviderAdapter(
    { type: "api", provider: "opencode", apiKey: "secret", baseURL: "http://localhost:4096/" },
    { defaultModel: { providerID: "google", id: "gemini-2.5-flash" }, basicAuth: true }
  );

  await adapter.generateContent({ model: "google/gemini-2.5-flash", prompt: "hi" });

  const expected = `Basic ${Buffer.from("opencode:secret").toString("base64")}`;
  expect(capturedHeaders.Authorization).toBe(expected);
});
```

---

### Task 4: 執行測試 + build check + commit

**Files:** 無新增

- [x] **Step 1: 跑測試確認全過**

```bash
cd D:/Projects/_HomeProject/ai-core
npm test -- --reporter=verbose 2>&1 | tail -30
```

預期：全部 pass，特別是 `opencode provider adapter` describe block。

- [x] **Step 2: TypeScript build check**

```bash
npm run build:check
```

預期：無 error。

- [x] **Step 3: Commit**

```bash
git add src/provider/adapters/opencode.ts src/__tests__/provider.test.ts
git commit -m "fix(opencode-adapter): fix model payload field name, add session cleanup and basic auth"
```

- [x] **Step 4: Build 並 publish（版本 bump 3.2.0 → 3.3.0）**

```bash
# package.json 的 version 改成 3.3.0
npm run build
npm publish
```

---

## 使用方式（修正後）

取代 Gemini KeyPool 的方式：

```typescript
// 舊：需要 KeyPool + SqliteAdapter
import { GeminiProviderAdapter } from "@kevinsisi/ai-core/provider";
import { KeyPool, SqliteAdapter } from "@kevinsisi/ai-core/key-pool";
const pool = new KeyPool(new SqliteAdapter(db));
const adapter = new GeminiProviderAdapter(pool);

// 新：只需 OPENCODE_URL
import { OpenCodeProviderAdapter } from "@kevinsisi/ai-core/provider";
const adapter = new OpenCodeProviderAdapter(
  {
    type: "api",
    provider: "opencode",
    apiKey: process.env.OPENCODE_PASSWORD ?? "",
    baseURL: process.env.OPENCODE_URL,   // http://opencode-server:4096
  },
  {
    defaultModel: { providerID: "google", id: "gemini-2.5-flash" },
    basicAuth: !!process.env.OPENCODE_PASSWORD,
  }
);
```
