---
name: Micro-Step Orchestration Uplift
description: ai-core should absorb the generic parts of quota-sensitive micro-step orchestration so consumers stop re-creating the same step scheduling and fallback behavior
type: feedback
---

`ai-core` already owns key pool, retry, Gemini client, and agent runtime primitives.

The next shared layer should be reusable micro-step orchestration for quota-sensitive Gemini work:
- named steps
- preferred-key planning
- explicit shared fallback
- lease heartbeat
- execution metadata

Project-specific prompts and business logic should remain in consuming repos.
