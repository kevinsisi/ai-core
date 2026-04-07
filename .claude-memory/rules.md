---
name: development rules
description: Hard constraints and coding rules for @kevinsisi/ai-core development
type: feedback
---

Rules enforced in this package — violations should be flagged immediately.

**No fallback on key exhaustion** — throw `NoAvailableKeyError`, never silently degrade or retry with a weaker path.
**Why:** Silent fallbacks mask quota problems and cause cascading failures in consumer services.
**How to apply:** Any code path that calls `pool.allocate()` must propagate the error up.

**No hardcoded API keys or credentials** — always sourced from `StorageAdapter.getKeys()`.
**Why:** Security and flexibility — each consumer provides its own key store.
**How to apply:** Never pass a literal key string anywhere in src/; test fixtures may use fake strings.

**Rebuild and commit dist/ with every src/ change.**
**Why:** Consumers install via git+https and cannot run build steps themselves.
**How to apply:** Before committing any src/ change, run `npm run build` and stage `dist/`.

**Use gemini-2.5-flash as the standard model** — do not hardcode other models in library logic.
**Why:** Standardises across the four consumer projects; consumers override via GenerateParams.model.

**better-sqlite3 must remain an optional peer dep** — not in dependencies.
**Why:** Most consumers don't use SQLite; forcing it would break non-SQLite environments.

**console.warn / console.error only** — no console.log.
**Why:** ESLint rule enforces this; log-level discipline matters in shared infrastructure.
