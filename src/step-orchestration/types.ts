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
}
