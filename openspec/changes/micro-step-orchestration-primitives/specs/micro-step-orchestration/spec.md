## ADDED Requirements

### Requirement: ai-core SHALL expose reusable micro-step orchestration primitives
`@kevinsisi/ai-core` SHALL provide reusable primitives for quota-sensitive, multi-step Gemini workflows so consumer apps do not have to re-implement the same orchestration pattern.

#### Scenario: define named steps for a quota-sensitive job
- **WHEN** a consumer declares a multi-step Gemini job
- **THEN** the consumer SHALL be able to provide explicit named steps and orchestration options through typed ai-core primitives

### Requirement: preferred-key assignment SHALL be explicit and observable
The orchestration layer SHALL support soft preferred-key assignment across steps and SHALL expose whether a preferred key was actually used.

#### Scenario: enough healthy keys exist
- **WHEN** healthy keys are at least as many as the step count
- **THEN** different steps SHALL prefer different keys
- **AND** the execution metadata SHALL show which key each step used

#### Scenario: healthy keys are fewer than step count
- **WHEN** healthy key count is smaller than the step count
- **THEN** later steps SHALL be able to explicitly use shared fallback semantics
- **AND** the execution metadata SHALL indicate that shared fallback was used

### Requirement: ai-core SHALL NOT silently fake per-step isolation
The orchestration layer SHALL NOT silently collapse to one-key reuse while still claiming per-step isolation.

#### Scenario: capacity is insufficient for isolated preferred keys
- **WHEN** a consumer requests preferred-key distribution but healthy capacity is insufficient
- **THEN** ai-core SHALL require the fallback path to be represented explicitly

### Requirement: long-running step execution SHALL support reusable lease heartbeat
The orchestration layer SHALL support a reusable lease-heartbeat mechanism for long-running step execution that uses leased keys.

#### Scenario: lease heartbeat keeps a long-running step alive
- **WHEN** a step uses a leased key for a long-running Gemini call
- **THEN** the orchestration layer SHALL provide a reusable heartbeat mechanism that can renew the lease while the step is still running

### Requirement: step execution SHALL return structured metadata
Each step execution SHALL return structured metadata describing the execution path.

#### Scenario: metadata records fallback and retry behavior
- **WHEN** a step finishes
- **THEN** the result SHALL expose whether fallback was used
- **AND** the retry count
- **AND** the chosen key
- **AND** the execution duration

### Requirement: true pool exhaustion SHALL still fail explicitly
The new orchestration primitives SHALL preserve the existing `NoAvailableKeyError` contract when the pool has no usable key and no explicit fallback path can continue the workflow.

#### Scenario: no usable keys remain
- **WHEN** no healthy or fallback-eligible key can execute the next step
- **THEN** the orchestration layer SHALL surface `NoAvailableKeyError`

### Requirement: ai-core SHALL preserve the generic orchestration boundary
The orchestration layer SHALL provide only generic step-execution primitives and SHALL NOT absorb consumer-specific prompts, business rules, or domain workflow logic.

#### Scenario: consumer provides domain-specific step content
- **WHEN** a consumer uses the orchestration layer for a domain-specific workflow
- **THEN** ai-core SHALL accept domain-specific step definitions and callbacks from the consumer
- **AND** ai-core SHALL keep prompt wording, business validation, and product-specific workflow ordering outside the library contract
