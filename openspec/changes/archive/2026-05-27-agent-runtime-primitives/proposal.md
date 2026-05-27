## Why

HomeProject agents currently reinvent task-loop state, pending confirmation state, and interruption handling in each app. That causes the same failure modes to repeat: side questions resetting the main task, short confirmations like `可以` not resuming the intended action, and completion gates being tracked only in prompt memory.

`@kevinsisi/ai-core` already centralises shared AI infrastructure such as key rotation, retry, and Gemini access. It is the right place to add minimal agent-runtime primitives that multiple apps can reuse without forcing a full framework.

## What Changes

- Add a new `agent-runtime` export path to `@kevinsisi/ai-core`
- Introduce `AgentRuntime` for explicit active-task state, checkpoints, blockers, pending actions, and interruption integration
- Export typed primitives for `ActiveTask`, `TaskCheckpoint`, `PendingAction`, `InterruptEvent`, and completion-check results
- Add unit tests for status-question interrupts, requirement merging, pending-action consume/expiry, and completion-gate enforcement
- Document how `AgentRuntime` complements `GeminiClient` / `withRetry` rather than replacing application-level semantic routing
- Bump version to `1.2.0`

## Capabilities

### New Capabilities

- `agent-runtime-primitives`: Shared state primitives for long-running agents, confirmation flows, and completion gates.

## Impact

- **`src/agent-runtime/*`**: New runtime primitives module
- **`src/index.ts` + `package.json` + `tsup.config.ts`**: New export path and build entry
- **`src/__tests__/agent-runtime.test.ts`**: New unit tests
- **`README.md`**: New usage section for `AgentRuntime`
- **`package.json`**: version `1.1.0` → `1.2.0`
- **No breaking changes** — existing key-pool/retry/client consumers unchanged
