# @kevinsisi/ai-core — Project Memory Index

- [Project context](project.md) — purpose, consumers, architecture modules, key-manager integration pattern, key constraints (v2.0.0+)
- [Development rules](rules.md) — no fallback, no hardcode, dist/ always committed, gemini-2.5-flash as standard model, optional better-sqlite3
- [Deployment & release](deployment.md) — GitHub Packages, tag-triggered publish, consumer installation patterns
- [Micro-step orchestration uplift](feedback_micro_step_orchestration.md) — ai-core should absorb generic quota-sensitive step orchestration so consumers stop re-creating the pattern locally
- [Multi-provider support](feedback_multi_provider_support.md) — ai-core should evolve toward provider-aware, model-aware, auth-aware routing instead of staying Gemini-only
