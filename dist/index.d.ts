export { A as ApiKey, K as KeyPool, a as KeyPoolOptions, N as NoAvailableKeyError, S as StorageAdapter } from './key-pool-CQHu-T7W.js';
export { SqliteAdapter, SqliteDatabase } from './key-pool/index.js';
export { ProviderErrorClassifier, classifyError, classifyGeminiError, classifyOpenAIError, getProviderClassifier, registerProviderClassifier, unregisterProviderClassifier, withRetry } from './retry/index.js';
export { E as ErrorClass, M as MaxRetriesExceededError, R as RetryEvent, a as RetryOptions } from './types-xF6t7Rx7.js';
export { GeminiClient, MultiProviderClient, MultiProviderClientOptions, toGeminiTools, toOpenAITools } from './client/index.js';
export { C as ChatMessage, a as ClientOptions, F as FunctionTool, G as GenerateParams, b as GenerateResponse, P as ProviderAdapter, c as ProviderNativeTool, d as ProviderRouter, R as RoutePolicy, e as RoutedProviderSelection, S as StreamInterruptedError, T as TokenUsage, f as Tool } from './router-J1UJIOJ8.js';
export { ActiveTask, AgentRuntime, AgentRuntimeOptions, CheckpointPriority, CheckpointStatus, CompletionCheckResult, InterruptClassification, InterruptEvent, PendingAction, TaskCheckpoint, TaskStatus } from './agent-runtime/index.js';
export { LeaseHeartbeat, PlannedStepAssignment, RunnableStep, StepDefinition, StepExecutionMetadata, StepExecutionResult, StepRunner, StepRunnerOptions, planPreferredKeys } from './step-orchestration/index.js';
export { A as ApiKeyCredential, M as ModelDefinition, a as ModelID, O as OAuthCredential, P as PoolCredential, b as ProviderAuthType, c as ProviderCapabilities, d as ProviderCredential, e as ProviderDefinition, f as ProviderID } from './types-Dbm33_oG.js';
export { OpenAIOAuthError, StartOpenAIAuthOptions, refreshOpenAIToken, startOpenAIAuth } from './provider/auth/index.js';
export { GeminiProviderAdapter, OpenAICompatibleAdapter, OpenAIProviderAdapter, OpenRouterAdapterOptions, OpenRouterProviderAdapter, builtInProviders, clearRegisteredProviders, defaultProviderPriority, getBuiltInModel, getBuiltInProvider, getModel, getProvider, listRegisteredProviders, registerProvider, unregisterProvider } from './provider/index.js';
import '@google/generative-ai';

/**
 * Source-of-truth package version. Imported by consumers that need to log
 * or report which ai-core build they are running against, and kept in sync
 * with package.json on every release.
 */
declare const AI_CORE_VERSION = "3.1.0";

export { AI_CORE_VERSION };
