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
