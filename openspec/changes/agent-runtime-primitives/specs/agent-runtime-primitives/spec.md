## ADDED Requirements

### Requirement: ai-core SHALL expose explicit active-task state primitives
`@kevinsisi/ai-core` SHALL expose typed primitives for active task state instead of requiring consumers to keep long-running task progress only in transcript memory.

### Requirement: AgentRuntime metadata and pending args SHALL be structured data
`AgentRuntime` SHALL only accept structured plain data for task metadata and pending action args so the runtime can snapshot state safely.

#### Scenario: Plain structured data is accepted
- **WHEN** a consumer passes strings, numbers, booleans, nulls, arrays, or plain objects of the same kinds
- **THEN** `AgentRuntime` accepts and snapshots them

#### Scenario: Non-cloneable values are out of contract
- **WHEN** a consumer attempts to pass functions or class instances as metadata or pending args
- **THEN** that input is outside the supported contract and SHALL NOT be relied upon

#### Scenario: Start a task with checkpoints
- **WHEN** a consumer creates an `AgentRuntime` and calls `startTask()` with an objective and checkpoints
- **THEN** the runtime stores an active task with status `active`, the supplied checkpoints, and an updated timestamp

### Requirement: requirement updates SHALL merge into the active task
The runtime SHALL support mid-task requirement updates without resetting the main task.

#### Scenario: User adds scope during active work
- **WHEN** a consumer applies an interrupt with kind `requirement_update`
- **THEN** the message is appended to the active task requirement log
- **AND** the task remains `active`

### Requirement: short confirmations SHALL be supportable via pending actions
The runtime SHALL support structured pending actions that can later be deterministically consumed.

#### Scenario: Pending action is stored and later consumed
- **WHEN** a consumer creates a pending action for `generate_copy`
- **THEN** the runtime stores the action with args, source turn, prompt, timestamps, and optional expiry
- **AND WHEN** the consumer later calls `consumePendingAction()` before expiry
- **THEN** the action is returned with `consumedAt` set

#### Scenario: Expired pending action disappears
- **WHEN** a pending action is read after its TTL has elapsed
- **THEN** the runtime returns `null`

### Requirement: completion gates SHALL remain explicit
The runtime SHALL not mark a task complete while checkpoints or blockers remain.

#### Scenario: Completion blocked by unfinished checkpoints
- **WHEN** checkpoints are still `pending` or `in_progress`
- **THEN** `canCompleteTask()` returns `ok = false`

#### Scenario: Completion blocked by blockers
- **WHEN** the active task has blockers
- **THEN** `canCompleteTask()` returns `ok = false`

#### Scenario: Task completes only when gates are clear
- **WHEN** all checkpoints are `completed` or `cancelled` and blockers are empty
- **THEN** `completeTask()` succeeds and the task status becomes `completed`
