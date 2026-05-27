## Context

HomeProject agents repeatedly reinvent task-loop state, pending-confirmation state, and interruption handling per app. The recurring failure modes are: side questions resetting the main task, short confirmations like `可以` failing to resume the intended action, and completion gates living only in prompt memory. `@kevinsisi/ai-core` already centralises shared AI infrastructure (key rotation, retry, Gemini access), so it is the right home for minimal, reusable agent-runtime primitives — without imposing a full framework.

> Recorded retroactively during the 2026-05-27 archive pass. This design documents the primitives that actually shipped in `src/agent-runtime/` (v1.2.0), not a forward-looking proposal.

## Goals / Non-Goals

**Goals**
- Provide typed, snapshot-safe primitives for active-task state, checkpoints, blockers, pending actions, and interrupts.
- Keep completion gates explicit so a task cannot be marked complete while checkpoints or blockers remain.
- Complement `GeminiClient` / `withRetry`; remain orchestration-agnostic.

**Non-Goals**
- No semantic routing, prompt wording, or domain workflow decisions — those stay in the consumer app (and, for orchestration, in `step-orchestration`).
- No persistence layer; the runtime holds in-memory state that consumers may snapshot/store themselves.
- No LLM calls inside the runtime.

## Key Decisions

1. **Structured-data contract for metadata and pending args.** `StructuredData` is restricted to `null | string | number | boolean | arrays | plain objects` so any task state can be safely structured-cloned/snapshotted. Functions and class instances are explicitly out of contract. `ActiveTask<TMetadata>` and `PendingAction<TArgs>` are generic over this bound to keep consumer payloads typed.

2. **Explicit task lifecycle.** `TaskStatus = "active" | "paused" | "completed" | "cancelled"`. `startTask()` creates an `active` task carrying objective, checkpoints, blockers, a `requirementLog`, and `updatedAt`.

3. **Interrupts merge, they don't reset.** `InterruptEvent` is classified (`status_question | requirement_update | clarification | redirect | cancel`). A `requirement_update` appends to `requirementLog` and the task stays `active` — side questions never silently reset the main task.

4. **Deterministic pending actions.** `PendingAction` records `args`, `sourceTurnId`, `prompt`, `createdAt`, optional `expiresAt`, plus `consumedAt` / `cancelledAt`. A short confirmation later resolves to `consumePendingAction()`, which returns the action with `consumedAt` set; reads after TTL return `null`.

5. **Completion gates are hard.** `canCompleteTask()` returns `CompletionCheckResult { ok, incompleteCheckpointIds, activeBlockers, status }`; `completeTask()` only succeeds when all checkpoints are `completed`/`cancelled` and blockers are empty.

6. **Injectable clock.** `AgentRuntimeOptions.now` allows deterministic time in tests (TTL/expiry assertions).

## Surface

New export path `@kevinsisi/ai-core/agent-runtime` exposing `AgentRuntime` plus types `ActiveTask`, `TaskCheckpoint`, `PendingAction`, `InterruptEvent`, `CompletionCheckResult` (wired via `src/index.ts`, `package.json` exports, and `tsup.config.ts`).

## Risks / Trade-offs

- **In-memory only** — consumers needing durability must snapshot externally; acceptable since the primitive is intentionally minimal.
- **Structured-data restriction** pushes non-cloneable handles out of metadata; this is deliberate to keep snapshots safe.
