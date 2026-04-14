## Context

`ai-core` now has strong lower-level Gemini infrastructure:
- `KeyPool`
- `withRetry`
- `GeminiClient`
- `AgentRuntime`
- `StepRunner`

But it still lacks a provider-aware architecture. `opencode` shows the missing layers clearly:
- provider schema (`ProviderID`, `ModelID`)
- provider registry
- model capability registry
- auth abstraction (`api`, `oauth`)
- routing policy that selects provider, then model, then credentials

This change introduces those architectural layers into ai-core.

## Goals / Non-Goals

**Goals**
- Add provider and model abstractions to ai-core
- Keep Gemini as the default built-in provider
- Design for OpenAI as the first additional provider target
- Support provider-specific auth and capability modeling
- Add routing policy primitives that consumers can use for provider/model fallback

**Non-Goals**
- Do not fully re-implement `opencode`
- Do not add every provider from `opencode` in the first step
- Do not remove existing Gemini-first APIs immediately
- Do not build a full UI or provider management console in ai-core

## Decisions

### D1: Add provider schema as a first-class layer

Introduce explicit ids for providers and models.

Candidate types:
- `ProviderID`
- `ModelID`
- `ProviderDefinition`
- `ModelDefinition`

Reason:
- routing should reason about provider and model separately
- key rotation alone is not enough

### D2: Add model capability metadata

Model definitions should capture at least:
- streaming
- tools
- reasoning
- multimodal input/output
- context window
- optional cost tier

Reason:
- future routing should depend on capability, not only name

### D3: Provider-specific adapters, not one generic HTTP path

Different providers should implement a shared adapter interface, while preserving provider-specific behavior internally.

Candidate first adapters:
- Gemini provider adapter
- OpenAI provider adapter

Reason:
- request/response shape, auth, streaming, and error semantics differ by provider

### D4: Auth abstraction should support more than raw API keys

The first phase can focus on API-key style auth, but the contract should leave room for later OAuth/provider-managed auth.

Reason:
- `opencode` proves auth strategy is part of provider design, not an afterthought

Phase-1 boundary:
- do **not** build a generalized credential store yet
- consumers continue to supply provider-specific API-key credentials
- ai-core only needs typed provider-auth contracts that can represent those credentials consistently

### D5: Routing policy must choose provider before key

Routing order:
1. choose provider
2. choose model
3. choose credential/key source

Reason:
- current ai-core can only rotate within one provider
- future fallback should support same-provider key rotation, cross-model fallback, and cross-provider fallback

Important rule:
- cross-model and cross-provider fallback must be policy-driven and explicit
- existing Gemini-first APIs must preserve the current no-silent-fallback contract unless the caller opts into provider-aware routing

### D6: Preserve Gemini compatibility during migration

Existing Gemini consumers should continue working while the provider-aware architecture is added.

Reason:
- ai-core is already used by multiple HomeProject repos
- this must be additive first, not a breaking rewrite

## Proposed Architecture

Potential modules:
- `src/provider/schema.ts`
- `src/provider/registry.ts`
- `src/provider/models.ts`
- `src/provider/auth.ts`
- `src/provider/router.ts`
- `src/provider/adapters/gemini.ts`
- `src/provider/adapters/openai.ts`

Migration expectation:
- `GeminiClient` may remain as a compatibility layer
- a new provider-aware client/router layer can be introduced alongside it first

## Risks / Trade-offs

- Adding provider abstraction too quickly can overfit to current guesses instead of real usage.
- Adding too little metadata will leave routing policy too weak to matter.
- Provider auth and provider error classification need clear boundaries, or retry logic will become inconsistent.

## First-phase scope

The first implementation phase should include:
- provider/model schema
- Gemini provider adapter as a pool-backed compatibility layer
- OpenAI provider adapter with text-only capabilities in phase 1
- minimal provider routing policy with explicit opt-in fallback controls
- compatibility layer for existing Gemini consumers
