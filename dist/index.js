import {
  MultiProviderClient
} from "./chunk-6WNQ2TOK.js";
import {
  AgentRuntime
} from "./chunk-4KJMSVMU.js";
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
  GeminiProviderAdapter,
  OpenAICompatibleAdapter,
  OpenAIProviderAdapter,
  OpenCodeProviderAdapter,
  OpenRouterProviderAdapter
} from "./chunk-XPTOWXZF.js";
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
} from "./chunk-G7YCA5WR.js";
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
} from "./chunk-JXXS2CXM.js";
import {
  ProviderID
} from "./chunk-NIHYAC7Q.js";

// src/version.ts
var AI_CORE_VERSION = "3.4.3";
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