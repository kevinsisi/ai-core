import {
  AgentRuntime
} from "./chunk-4KJMSVMU.js";
import {
  MultiProviderClient
} from "./chunk-QFUJCX56.js";
import {
  GeminiProviderAdapter,
  OpenAICompatibleAdapter,
  OpenAIProviderAdapter,
  OpenCodeProviderAdapter,
  OpenRouterProviderAdapter
} from "./chunk-PES4O5RC.js";
import {
  CapabilityNotSupportedError,
  GeminiClient,
  MaxToolRoundsExceededError,
  ProviderRouter,
  StreamInterruptedError,
  builtInProviders,
  clearRegisteredProviders,
  defaultProviderPriority,
  getBuiltInModel,
  getBuiltInProvider,
  getModel,
  getProvider,
  listRegisteredProviders,
  registerProvider,
  toGeminiTools,
  toOpenAITools,
  unregisterProvider
} from "./chunk-HKNTXQ2A.js";
import {
  LeaseHeartbeat,
  StepRunner,
  planPreferredKeys
} from "./chunk-P3ARPLKV.js";
import {
  KeyPool,
  SqliteAdapter
} from "./chunk-TQP53VQG.js";
import "./chunk-U42SY5KL.js";
import {
  MaxRetriesExceededError,
  classifyError,
  classifyGeminiError,
  classifyOpenAIError,
  getProviderClassifier,
  registerProviderClassifier,
  unregisterProviderClassifier,
  withRetry
} from "./chunk-YUQCRD55.js";
import {
  NoAvailableKeyError
} from "./chunk-NHGYIXGT.js";
import {
  OpenAIOAuthError,
  isOAuthCredentialExpired,
  refreshOpenAIToken,
  startOpenAIAuth
} from "./chunk-BH7KXBLP.js";
import {
  ProviderID
} from "./chunk-GSINE2EE.js";

// src/version.ts
var AI_CORE_VERSION = "3.4.0";
export {
  AI_CORE_VERSION,
  AgentRuntime,
  CapabilityNotSupportedError,
  GeminiClient,
  GeminiProviderAdapter,
  KeyPool,
  LeaseHeartbeat,
  MaxRetriesExceededError,
  MaxToolRoundsExceededError,
  MultiProviderClient,
  NoAvailableKeyError,
  OpenAICompatibleAdapter,
  OpenAIOAuthError,
  OpenAIProviderAdapter,
  OpenCodeProviderAdapter,
  OpenRouterProviderAdapter,
  ProviderID,
  ProviderRouter,
  SqliteAdapter,
  StepRunner,
  StreamInterruptedError,
  builtInProviders,
  classifyError,
  classifyGeminiError,
  classifyOpenAIError,
  clearRegisteredProviders,
  defaultProviderPriority,
  getBuiltInModel,
  getBuiltInProvider,
  getModel,
  getProvider,
  getProviderClassifier,
  isOAuthCredentialExpired,
  listRegisteredProviders,
  planPreferredKeys,
  refreshOpenAIToken,
  registerProvider,
  registerProviderClassifier,
  startOpenAIAuth,
  toGeminiTools,
  toOpenAITools,
  unregisterProvider,
  unregisterProviderClassifier,
  withRetry
};
//# sourceMappingURL=index.js.map