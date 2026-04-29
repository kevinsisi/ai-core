# multi-provider-support

## Purpose

`@kevinsisi/ai-core` provides provider-aware AI runtime primitives so consumers can reason about AI providers and models explicitly, instead of being locked into a single Gemini-only runtime.

## Requirements

### Requirement: ai-core SHALL expose provider-aware AI runtime primitives
`@kevinsisi/ai-core` SHALL provide provider-aware primitives so consumers can reason about AI providers and models explicitly, instead of assuming a single Gemini-only runtime.

#### Scenario: declare provider and model identities
- **WHEN** ai-core represents an AI runtime configuration
- **THEN** it SHALL expose explicit provider and model identifiers

### Requirement: ai-core SHALL represent model capability metadata
Model definitions SHALL expose capability metadata needed for routing decisions.

#### Scenario: capability-aware routing
- **WHEN** a consumer needs a model with specific capabilities
- **THEN** the routing layer SHALL be able to inspect capability metadata such as streaming, tools, reasoning, and multimodal support

### Requirement: ai-core SHALL support provider-specific adapters
Different AI providers SHALL integrate through provider-specific adapters rather than one provider-agnostic request path.

#### Scenario: Gemini and OpenAI coexist
- **WHEN** ai-core supports both Gemini and OpenAI
- **THEN** each provider SHALL be represented through its own adapter while conforming to shared higher-level contracts

### Requirement: ai-core SHALL support provider auth abstraction
The provider layer SHALL support provider-specific auth semantics, starting with API-key-style auth.

#### Scenario: configure provider credentials
- **WHEN** a consumer configures a provider
- **THEN** ai-core SHALL have a typed auth abstraction for that provider

#### Scenario: phase 1 keeps credential storage in the consumer boundary
- **WHEN** ai-core first adds provider-aware support beyond Gemini
- **THEN** phase 1 SHALL accept consumer-supplied provider-specific API-key credentials
- **AND** SHALL NOT require a generalized credential store to exist before Gemini and OpenAI adapters can be added

### Requirement: routing SHALL choose provider before credential rotation
The provider-aware routing layer SHALL select provider and model before applying key/credential rotation.

#### Scenario: fallback beyond Gemini key rotation
- **WHEN** a Gemini key pool is exhausted or inappropriate for the task
- **THEN** the routing layer SHALL be able to choose another model or provider according to explicit policy, instead of only rotating Gemini keys

### Requirement: ai-core SHALL NOT silently change provider/model for existing Gemini-first consumers
Provider-aware fallback SHALL be explicit and policy-driven. Existing Gemini-first APIs SHALL keep their current no-silent-fallback behavior unless the caller opts into provider-aware routing.

#### Scenario: Gemini-first consumer does not opt into provider-aware routing
- **WHEN** an existing Gemini-first consumer uses the compatibility API
- **THEN** ai-core SHALL preserve the current no-silent-fallback contract
- **AND** true exhaustion SHALL still surface as `NoAvailableKeyError`

### Requirement: Gemini compatibility SHALL be preserved during migration
The first phase of multi-provider support SHALL preserve existing Gemini consumers.

#### Scenario: existing Gemini consumer remains valid
- **WHEN** a current Gemini-first consumer upgrades ai-core
- **THEN** its existing Gemini integration SHALL continue to function without immediate migration to the new provider-aware APIs
