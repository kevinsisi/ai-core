## Context

`ai-core` currently provides the lower-level building blocks for Gemini work:
- `KeyPool` handles key allocation, cooldown, and leases
- `withRetry` handles retry and key rotation
- `GeminiClient` wraps model access
- `AgentRuntime` handles active task and pending action state

What it does not yet provide is a first-class orchestration layer for quota-sensitive, multi-step AI jobs. Consumer apps such as `project-bridge` already implement this pattern themselves: they split larger work into named steps, try to spread those steps across healthy keys, and explicitly fall back to shared rotation when key capacity is smaller than the number of steps.

This change extracts the reusable orchestration parts into ai-core without pulling in project-specific prompts, domain logic, or storage schemas.

## Goals / Non-Goals

**Goals:**
- Add a reusable step-runner for quota-sensitive Gemini workflows
- Support named steps with per-step metadata
- Support soft preferred-key assignment when enough healthy keys exist
- Support explicit shared-fallback semantics when healthy keys are fewer than steps
- Support reusable lease heartbeat for long-running step execution
- Keep ai-core provider contract strict: if the pool truly has no usable key, still throw `NoAvailableKeyError`

**Non-Goals:**
- Do not move project-specific prompts or business workflows out of consumers
- Do not add hidden fallback inside `GeminiClient`
- Do not build a full workflow engine or DAG scheduler
- Do not replace `AgentRuntime` or `GeminiClient`

## Decisions

### D1: Add a dedicated `step-orchestration` module

Create a new module, separate from `key-pool`, `retry`, `client`, and `agent-runtime`.

Reason:
- keeps orchestration concerns explicit
- avoids bloating `GeminiClient` into a workflow engine

### D2: Represent steps as typed data

Each step should be declared with explicit metadata such as:
- `id`
- `name`
- `preferredKeyGroup` or preferred-key hint
- `allowSharedFallback`
- optional timeout / retry overrides

Reason:
- lets consumers define workflows declaratively
- makes execution metadata inspectable

### D3: Preferred-key assignment is a soft preference

When healthy capacity allows, different steps in the same job should prefer different keys.

When healthy keys are fewer than the step count, later steps must explicitly use shared fallback.

Reason:
- this matches the HomeProject rule already documented in `homelab-docs`
- it avoids false claims of per-step isolation

### D4: Lease heartbeat becomes reusable orchestration infrastructure

The long-running lease renewal pattern currently seen in `project-bridge` should become a reusable helper in ai-core.

Reason:
- lease renewal is not business logic
- multiple consumers may need the same protection for long-running Gemini calls

### D5: Step execution must produce structured metadata

Each step run should return metadata such as:
- chosen key
- preferred key used or not
- fallback used or not
- retry count
- duration
- terminal error class if failed

Reason:
- observability is part of the 429 mitigation design
- consumers need proof that steps actually spread across keys when capacity allows

## Proposed API Surface

Potential exports:
- `StepDefinition`
- `StepExecutionResult`
- `StepExecutionMetadata`
- `StepRunner`
- `LeaseHeartbeat`
- `planPreferredKeys()`

Final naming can change during implementation, but the shape should preserve these responsibilities.

## Layering Boundary

`ai-core` should own:
- generic step execution primitives
- preferred-key planning
- lease heartbeat
- execution metadata

Consumer repos should still own:
- domain-specific step content
- prompt wording
- business validation
- workflow ordering decisions that depend on product semantics

## Risks / Trade-offs

- If the module is too high-level, it becomes a mini workflow framework and stops being reusable.
- If the module is too low-level, consumers still have to rewrite the same orchestration pattern.
- Lease heartbeat needs careful cleanup to avoid orphan timers.

## Migration Plan

1. Add the new primitives without breaking existing APIs.
2. Document the recommended layering.
3. Migrate one consumer pattern as proof of fit.
4. Encourage later consumers to adopt the shared implementation instead of adding new project-local variants.
