# @kevinsisi/ai-core

Shared AI modules for the HomeProject — Gemini-first AI runtime primitives with provider-aware building blocks, retry logic, client wrappers, and agent-runtime primitives.

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
| `AgentRuntime` | Structured runtime state for active tasks, pending actions, interrupts, and completion gates |
| `StepRunner` | Runs quota-sensitive named Gemini steps with preferred-key planning and explicit fallback |
| `LeaseHeartbeat` | Reusable key-lease renewal helper for long-running Gemini calls |
| `ProviderRouter` | Selects provider/model combinations according to explicit routing policy |
| `GeminiProviderAdapter` | Pool-backed compatibility adapter for existing Gemini KeyPool consumers |
| `OpenAIProviderAdapter` | Minimal text-only OpenAI chat-completions adapter for first-phase multi-provider adoption |
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

// Multimodal — inline base64 image
const { text: visionText } = await client.generateContent({
  model: "gemini-2.5-flash",
  prompt: "What does this diagram show?",
  images: [
    {
      type: "inline",
      mimeType: "image/png",
      data: base64EncodedPng, // your base64 string
    },
  ],
});

// Multimodal — image from file path (read and encoded automatically)
const { text: fileVision } = await client.generateContent({
  model: "gemini-2.5-flash",
  prompt: "Describe this image.",
  images: [
    {
      type: "file",
      mimeType: "image/jpeg",
      filePath: "/tmp/screenshot.jpg",
    },
  ],
});

// Google Search grounding (tools)
const { text: searchText } = await client.generateContent({
  model: "gemini-2.5-flash",
  prompt: "What is the latest news about TypeScript?",
  tools: [{ googleSearchRetrieval: {} }],
});
```

### 2.5 Use `AgentRuntime` for long-running agents

`AgentRuntime` gives HomeProject agents explicit state instead of relying only on transcript memory:

```ts
import { AgentRuntime } from "@kevinsisi/ai-core/agent-runtime";

const runtime = new AgentRuntime();

runtime.startTask({
  id: "task-1",
  objective: "Fix the playback bug",
  currentStep: "Investigating root cause",
  metadata: { project: "home-media" },
  checkpoints: [
    { id: "read-rules", content: "Read governing rules", status: "completed", priority: "high" },
    { id: "implement", content: "Implement fix", status: "in_progress", priority: "high" },
    { id: "verify", content: "Verify live behavior", status: "pending", priority: "high" },
  ],
});

runtime.applyInterrupt({ kind: "requirement_update", message: "順便做長時間驗證" });

runtime.createPendingAction({
  actionName: "deploy",
  args: { environment: "prod" },
  sourceTurnId: "turn-14",
  prompt: "是否現在部署？",
  ttlMs: 30_000,
});

// Later, a short reply like `可以` can deterministically consume the stored action.
const pending = runtime.consumePendingAction();
```

Important constraint:
- `AgentRuntime` snapshots `metadata` and `pendingAction.args` with structured cloning so runtime state cannot be mutated from the outside.
- Pass only structured plain data (`string` / `number` / `boolean` / `null` / arrays / plain objects of the same kinds).
- Do not pass functions, class instances, or other non-cloneable values.

### 2.6 Split quota-sensitive work into micro-steps

For long or quota-sensitive Gemini workflows, prefer splitting the job into small named actions instead of one large call.

Recommended pattern:
- `identify-object`
- `identify-vehicle`
- `extract-features-batch-1`
- `extract-features-batch-2`
- `search-dimensions`
- `generate-featurescript`

Key assignment rule:
- When enough healthy keys exist, different actions in the same job should prefer different keys.
- When healthy keys are fewer than actions, later actions may explicitly fall back to shared rotation in the consumer's orchestration layer instead of pretending they still have isolated keys.
- Treat preferred keys as a soft preference, not a hard guarantee.

Important:
- This does not change the library contract that true pool exhaustion still throws `NoAvailableKeyError`.
- If you implement shared fallback, do it explicitly in the consumer/job orchestration layer, not as a silent hidden fallback inside `ai-core`.

This pattern improves:
- observability
- retry granularity
- cooldown-aware scheduling
- quota distribution across a single multi-step job

Recommended layering:
- `GeminiClient` / `withRetry` / `KeyPool`: model access, retry, and key rotation
- `StepRunner` / `planPreferredKeys` / `LeaseHeartbeat`: quota-sensitive micro-step orchestration and execution metadata
- `AgentRuntime`: active task state, pending action, interrupt integration, completion checks
- Consumer app: semantic classification, tool routing, history persistence, and side effects

### 2.7 Use `StepRunner` for quota-sensitive workflows

For workflows that should be split into explicit named steps:

```ts
import { KeyPool } from "@kevinsisi/ai-core";
import { StepRunner } from "@kevinsisi/ai-core/step-orchestration";

const pool = new KeyPool(new MyAdapter());
const runner = new StepRunner(pool);

const results = await runner.runSteps([
  {
    id: "identify-object",
    name: "identify-object",
    run: async (apiKey) => callGemini(apiKey, "identify the object"),
  },
  {
    id: "extract-features",
    name: "extract-features",
    allowSharedFallback: true,
    run: async (apiKey) => callGemini(apiKey, "extract features"),
  },
]);
```

Use this layer for:
- named micro-step execution
- preferred-key planning
- explicit shared fallback
- step-level metadata (retry count, chosen key, fallback usage, duration)

Do **not** use it to move domain prompts or product workflow rules into `ai-core`.

### 2.8 Use provider-aware routing for multi-provider adoption

`ai-core` now includes first-phase provider support so consumers can remain Gemini-first while preparing for OpenAI fallback and future provider expansion.

```ts
import {
  KeyPool,
  GeminiProviderAdapter,
  OpenAIProviderAdapter,
  ProviderID,
  ProviderRouter,
} from "@kevinsisi/ai-core";

const gemini = new GeminiProviderAdapter(pool);

const openai = new OpenAIProviderAdapter({
  type: "api",
  provider: ProviderID.OpenAI,
  apiKey: "openai-key-managed-by-consumer",
});

const router = new ProviderRouter([gemini, openai]);
const selected = router.select({
  preferredProviders: [ProviderID.Gemini],
  fallbackProviders: [ProviderID.OpenAI],
  allowCrossProviderFallback: true,
});
```

Important:
- existing Gemini-first consumers still keep their current no-silent-fallback contract unless they explicitly opt into provider-aware routing
- phase 1 uses provider-specific API-key credentials for providers such as OpenAI, while Gemini keeps a pool-backed compatibility adapter

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

## key-manager integration note

When consuming `key-manager` as an external registry, prefer its bucket-aware outputs over raw per-key counts:

- `GET /api/keys/quota-summary` now distinguishes raw `available` keys from `trusted_available_keys` and `trusted_available_buckets`.
- `projects` tags in key-manager act as quota-bucket hints; the **first tag** should be the shared Google project / quota bucket identifier.
- `GET /api/keys/export?trusted_only=1` should be preferred over the legacy raw export when you need a trustworthy pool for automated consumers.
- If key-manager reports `unscoped_keys > 0` or `mixed_buckets > 0`, treat the raw pool as potentially misleading until bucket tags are cleaned up.

## Development

```bash
# Build (ESM + CJS + types)
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```
