## 1. Runtime Types

- [x] 1.1 Add `TaskStatus`, `CheckpointStatus`, `TaskCheckpoint`, `ActiveTask`, and `PendingAction` types
- [x] 1.2 Add typed interrupt and completion-check result interfaces

## 2. Runtime Implementation

- [x] 2.1 Add `AgentRuntime` with explicit active task state
- [x] 2.2 Support checkpoint updates, blockers, and requirement merging
- [x] 2.3 Support structured pending actions with expiry and deterministic consume/cancel flow
- [x] 2.4 Support interrupt application without resetting the main task by default
- [x] 2.5 Support completion checks that fail while checkpoints or blockers remain

## 3. Public Exports

- [x] 3.1 Add `src/agent-runtime/index.ts`
- [x] 3.2 Export `agent-runtime` from `src/index.ts`
- [x] 3.3 Add `./agent-runtime` export path in `package.json`
- [x] 3.4 Add `src/agent-runtime/index.ts` to `tsup.config.ts`

## 4. Tests & Docs

- [x] 4.1 Add unit tests for status-question interrupts, requirement merge, pending-action consume/expiry, and completion gates
- [x] 4.2 Update README with `AgentRuntime` usage and layering guidance

## 5. Version & Verification

> Reconciled during archive (2026-05-27): these release chores were completed as part of the original v1.2.0 release. Git history confirms `package.json` advanced `1.1.0 → 1.2.0` and the regenerated `dist/` was committed; build/test ran in that and every subsequent release (current `AI_CORE_VERSION` is 3.4.3). The implementation lives in `src/agent-runtime/` and is exported from `src/index.ts`.

- [x] 5.1 Bump version in `package.json` from `1.1.0` to `1.2.0`
- [x] 5.2 Run `npm run build`
- [x] 5.3 Run `npm test`
- [x] 5.4 Review diff and stage regenerated `dist/`
