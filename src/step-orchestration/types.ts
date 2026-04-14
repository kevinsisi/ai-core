import type { KeyPool } from "../key-pool/key-pool.js";
import type { ErrorClass } from "../retry/types.js";

export interface StepDefinition {
  id: string;
  name: string;
  preferredKey?: string | null;
  allowSharedFallback?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface PlannedStepAssignment {
  stepId: string;
  stepName: string;
  preferredKey: string | null;
  sharedFallbackRequired: boolean;
}

export interface StepExecutionMetadata {
  stepId: string;
  stepName: string;
  preferredKey: string | null;
  keyUsed: string;
  preferredKeyUsed: boolean;
  sharedFallbackUsed: boolean;
  retryCount: number;
  durationMs: number;
  finalErrorClass: ErrorClass | null;
}

export interface StepExecutionResult<T> {
  value: T;
  metadata: StepExecutionMetadata;
}

export interface RunnableStep<T> extends StepDefinition {
  run: (apiKey: string) => Promise<T>;
}

export interface StepRunnerOptions {
  defaultTimeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  acquireInitialKey?: (context: AcquireInitialKeyContext) => Promise<AcquireKeyResult>;
  rotateKey?: (context: RotateKeyContext) => Promise<RotateKeyResult>;
  releaseKey?: (context: ReleaseKeyContext) => Promise<void>;
}

export interface AcquireInitialKeyContext {
  pool: KeyPool;
  step: RunnableStep<unknown>;
  preferredKey: string | null;
}

export interface AcquireKeyResult {
  key: string;
  usedPreferred: boolean;
  sharedFallbackUsed: boolean;
}

export interface RotateKeyContext {
  pool: KeyPool;
  step: RunnableStep<unknown>;
  currentKey: string;
  retryCount: number;
  errorClass: ErrorClass | null;
}

export interface RotateKeyResult {
  key: string;
  sharedFallbackUsed: boolean;
}

export interface ReleaseKeyContext {
  pool: KeyPool;
  step: RunnableStep<unknown>;
  key: string;
  failed: boolean;
  authFailure: boolean;
  errorClass: ErrorClass | null;
}
