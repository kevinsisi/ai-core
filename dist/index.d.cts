export { A as ApiKey, K as KeyPool, a as KeyPoolOptions, N as NoAvailableKeyError, S as StorageAdapter } from './key-pool-CQHu-T7W.cjs';
export { SqliteAdapter, SqliteDatabase } from './key-pool/index.cjs';
export { ProviderErrorClassifier, classifyError, classifyGeminiError, classifyOpenAIError, getProviderClassifier, registerProviderClassifier, unregisterProviderClassifier, withRetry } from './retry/index.cjs';
export { E as ErrorClass, M as MaxRetriesExceededError, R as RetryEvent, a as RetryOptions } from './types-B0cltQlw.cjs';
export { GeminiClient, MultiProviderClient, MultiProviderClientOptions, toGeminiTools, toOpenAITools } from './client/index.cjs';
export { C as CapabilityNotSupportedError, a as ChatEvent, b as ChatMessage, c as ChatToolContext, d as ClientOptions, F as FunctionTool, G as GenerateParams, e as GenerateResponse, I as ImageGenParams, f as ImageGenResponse, M as MaxToolRoundsExceededError, P as ProviderAdapter, g as ProviderNativeTool, h as ProviderRouter, R as RoutePolicy, i as RoutedProviderSelection, S as StreamInterruptedError, T as TokenUsage, j as Tool, k as ToolCall } from './router-DLk_01Y9.cjs';
export { ActiveTask, AgentRuntime, AgentRuntimeOptions, CheckpointPriority, CheckpointStatus, CompletionCheckResult, InterruptClassification, InterruptEvent, PendingAction, TaskCheckpoint, TaskStatus } from './agent-runtime/index.cjs';
export { LeaseHeartbeat, PlannedStepAssignment, RunnableStep, StepDefinition, StepExecutionMetadata, StepExecutionResult, StepRunner, StepRunnerOptions, planPreferredKeys } from './step-orchestration/index.cjs';
export { A as ApiKeyCredential, M as ModelDefinition, a as ModelID, O as OAuthCredential, P as PoolCredential, b as ProviderAuthType, c as ProviderCapabilities, d as ProviderCredential, e as ProviderDefinition, f as ProviderID, i as isOAuthCredentialExpired } from './types-ynO_vevS.cjs';
export { OpenAIOAuthError, StartOpenAIAuthOptions, refreshOpenAIToken, startOpenAIAuth } from './provider/auth/index.cjs';
export { GeminiProviderAdapter, OpenAICompatibleAdapter, OpenAIProviderAdapter, OpenCodeAdapterOptions, OpenCodeModelRef, OpenCodeProviderAdapter, OpenRouterAdapterOptions, OpenRouterProviderAdapter, builtInProviders, clearRegisteredProviders, defaultProviderPriority, getBuiltInModel, getBuiltInProvider, getModel, getProvider, listRegisteredProviders, registerProvider, unregisterProvider } from './provider/index.cjs';
import '@google/generative-ai';

/**
 * Source-of-truth package version. Imported by consumers that need to log
 * or report which ai-core build they are running against, and kept in sync
 * with package.json on every release.
 */
declare const AI_CORE_VERSION = "3.4.0";

export { AI_CORE_VERSION };
