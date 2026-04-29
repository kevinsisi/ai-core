// Version
export { AI_CORE_VERSION } from "./version.js";

// Key Pool
export { KeyPool, SqliteAdapter, NoAvailableKeyError } from "./key-pool/index.js";
export type {
  ApiKey,
  StorageAdapter,
  KeyPoolOptions,
  SqliteDatabase,
} from "./key-pool/index.js";

// Retry
export {
  withRetry,
  classifyError,
  classifyGeminiError,
  classifyOpenAIError,
  getProviderClassifier,
  registerProviderClassifier,
  unregisterProviderClassifier,
  MaxRetriesExceededError,
} from "./retry/index.js";
export type { ErrorClass, RetryOptions, RetryEvent, ProviderErrorClassifier } from "./retry/index.js";

// Client
export {
  GeminiClient,
  MultiProviderClient,
  StreamInterruptedError,
  toGeminiTools,
  toOpenAITools,
} from "./client/index.js";
export type {
  GenerateParams,
  GenerateResponse,
  ChatMessage,
  TokenUsage,
  ClientOptions,
  MultiProviderClientOptions,
  Tool,
  FunctionTool,
  ProviderNativeTool,
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
  clearRegisteredProviders,
  defaultProviderPriority,
  getBuiltInModel,
  getBuiltInProvider,
  getModel,
  getProvider,
  listRegisteredProviders,
  registerProvider,
  unregisterProvider,
  ProviderRouter,
  GeminiProviderAdapter,
  OpenAICompatibleAdapter,
  OpenAIProviderAdapter,
  OpenRouterProviderAdapter,
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
  OpenRouterAdapterOptions,
} from "./provider/index.js";
