// Key Pool
export { KeyPool, SqliteAdapter, NoAvailableKeyError } from "./key-pool/index.js";
export type {
  ApiKey,
  StorageAdapter,
  KeyPoolOptions,
  SqliteDatabase,
} from "./key-pool/index.js";

// Retry
export { withRetry, classifyError, MaxRetriesExceededError } from "./retry/index.js";
export type { ErrorClass, RetryOptions, RetryEvent } from "./retry/index.js";

// Client
export { GeminiClient, StreamInterruptedError } from "./client/index.js";
export type {
  GenerateParams,
  GenerateResponse,
  ChatMessage,
  TokenUsage,
  ClientOptions,
} from "./client/index.js";

// Agent runtime
export { AgentRuntime } from "./agent-runtime/index.js";
export type {
  ActiveTask,
  AgentRuntimeOptions,
  CheckpointPriority,
  CheckpointStatus,
  CompletionCheckResult,
  InterruptClassification,
  InterruptEvent,
  PendingAction,
  TaskCheckpoint,
  TaskStatus,
} from "./agent-runtime/index.js";

// Step orchestration
export { LeaseHeartbeat, StepRunner, planPreferredKeys } from "./step-orchestration/index.js";
export type {
  PlannedStepAssignment,
  RunnableStep,
  StepDefinition,
  StepExecutionMetadata,
  StepExecutionResult,
  StepRunnerOptions,
} from "./step-orchestration/index.js";

// Provider support
export {
  ProviderID,
  builtInProviders,
  defaultProviderPriority,
  getBuiltInModel,
  getBuiltInProvider,
  ProviderRouter,
  GeminiProviderAdapter,
  OpenAIProviderAdapter,
} from "./provider/index.js";
export type {
  ApiKeyCredential,
  OAuthCredential,
  ProviderAuthType,
  ProviderCredential,
  ModelDefinition,
  ProviderCapabilities,
  ProviderDefinition,
  ModelID,
  ProviderAdapter,
  RoutePolicy,
  RoutedProviderSelection,
} from "./provider/index.js";
