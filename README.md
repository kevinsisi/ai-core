# @kevinsisi/ai-core

Shared AI modules for the HomeProject — Gemini API key pool, retry logic, and GeminiClient wrapper.

**Repo:** https://github.com/kevinsisi/ai-core

## Installation

```bash
npm install github:kevinsisi/ai-core
```

## What's Included

| Export | Description |
|--------|-------------|
| `KeyPool` | Multi-key rotation pool with configurable cooldowns |
| `StorageAdapter` | Interface to plug any database backend into `KeyPool` |
| `SqliteAdapter` | Built-in SQLite adapter (requires `better-sqlite3`) |
| `GeminiClient` | Wrapper around `@google/generative-ai` with automatic key allocation and retry |
| `withRetry` | Low-level retry helper with error classification and key rotation |
| `classifyError` | Classifies an error as `quota` / `rate-limit` / `network` / `fatal` / `unknown` |
| `NoAvailableKeyError` | Thrown when all keys are exhausted or in cooldown |
| `MaxRetriesExceededError` | Thrown when `withRetry` exhausts all attempts |

## Quick Start

### 1. Implement a StorageAdapter

`KeyPool` is storage-agnostic. You provide an adapter that maps your database schema to the `ApiKey` interface:

```ts
import type { StorageAdapter, ApiKey } from "@kevinsisi/ai-core";

export class MyAdapter implements StorageAdapter {
  async getKeys(): Promise<ApiKey[]> {
    // Return all keys from your database
    return db.prepare("SELECT * FROM api_keys").all().map(row => ({
      id: row.id,
      key: row.api_key,
      isActive: !row.is_blocked,
      cooldownUntil: row.cooldown_until ?? 0,
      usageCount: row.usage_count ?? 0,
    }));
  }

  async updateKey(key: ApiKey): Promise<void> {
    // Persist changes (cooldown, block status) back to your database
    db.prepare("UPDATE api_keys SET cooldown_until = ?, is_blocked = ? WHERE id = ?")
      .run(key.cooldownUntil, key.isActive ? 0 : 1, key.id);
  }
}
```

### 2. Use `GeminiClient` (Recommended)

`GeminiClient` handles key allocation, retry, and release automatically:

```ts
import { KeyPool, GeminiClient } from "@kevinsisi/ai-core";
import { MyAdapter } from "./myAdapter.js";

const pool = new KeyPool(new MyAdapter());
const client = new GeminiClient(pool, { maxRetries: 3 });

// Non-streaming
const { text, usage } = await client.generateContent({
  model: "gemini-2.5-flash",
  prompt: "Hello, world!",
  systemInstruction: "You are a helpful assistant.",
});

// Streaming
for await (const chunk of client.streamContent({
  model: "gemini-2.5-flash",
  prompt: "Write a poem about the ocean.",
})) {
  process.stdout.write(chunk);
}

// Multi-turn chat
const { text } = await client.generateContent({
  model: "gemini-2.5-flash",
  prompt: "What did I just ask you?",
  history: [
    { role: "user", parts: "Tell me a joke." },
    { role: "model", parts: "Why did the chicken cross the road? To get to the other side!" },
  ],
});
```

### 3. Use `withRetry` Directly (Low-level)

If you manage keys yourself and only need the retry wrapper:

```ts
import { withRetry, NoAvailableKeyError } from "@kevinsisi/ai-core";

const result = await withRetry(
  async (apiKey) => {
    // Your API call here
    return callGemini(apiKey, prompt);
  },
  initialKey,
  {
    maxRetries: 3,
    rotateKey: async () => {
      const nextKey = getNextAvailableKey();
      if (!nextKey) throw new NoAvailableKeyError();
      return nextKey;
    },
    onRetry: (info) => {
      console.warn(`Attempt ${info.attempt}: ${info.errorClass}`);
      if (info.errorClass === "quota") markKeyCooling(info.currentKey);
    },
  }
);
```

### 4. Built-in SQLite Adapter

If you use `better-sqlite3` and want a simple single-table setup:

```ts
import Database from "better-sqlite3";
import { KeyPool, SqliteAdapter, GeminiClient } from "@kevinsisi/ai-core";

const db = new Database("./data.db");
const pool = new KeyPool(new SqliteAdapter(db));
const client = new GeminiClient(pool);
```

The `SqliteAdapter` auto-creates an `ai_keys` table:
```sql
CREATE TABLE ai_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0
);
```

## StorageAdapter Interface

```ts
interface ApiKey {
  id: number;
  key: string;
  isActive: boolean;       // false = permanently blocked
  cooldownUntil: number;   // Unix ms; 0 = not in cooldown
  usageCount: number;
}

interface StorageAdapter {
  /** Return ALL keys (including blocked/cooling). KeyPool handles filtering. */
  getKeys(): Promise<ApiKey[]>;
  /** Persist updated state (cooldown, usageCount, isActive) back to storage. */
  updateKey(key: ApiKey): Promise<void>;
}
```

## KeyPool Options

```ts
const pool = new KeyPool(adapter, {
  defaultCooldownMs: 60_000,      // 1 min cooldown after quota errors (default)
  authCooldownMs: 1_800_000,      // 30 min cooldown after auth failures (default)
});
```

## Projects Using This Package

| Project | Adapter | Usage |
|---------|---------|-------|
| [project-bridge](../project-bridge) | `ProjectBridgeAdapter` (settings table + in-memory cooldown) | `GeminiClient` for HTML prototype generation |
| [mind-diary](../mind-diary) | `MindDiaryAdapter` (two-table: api_keys + api_key_cooldowns) | `GeminiClient` for RAG chat |
| [auto-spec-test](../auto-spec-test) | None (uses `withRetry` directly) | `withRetry` for multi-agent test generation |
| [sheet-to-car](../_car-maintain/sheet-to-car) | None (uses `withRetry` directly) | `withRetry` for car inventory AI agent |

## Development

```bash
# Build (ESM + CJS + types)
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```
