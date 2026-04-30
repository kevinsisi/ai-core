import { K as KeyPool } from '../key-pool-CQHu-T7W.js';
import { E as ErrorClass } from '../types-B0cltQlw.js';

interface StepDefinition {
    id: string;
    name: string;
    preferredKey?: string | null;
    allowSharedFallback?: boolean;
    timeoutMs?: number;
    maxRetries?: number;
}
interface PlannedStepAssignment {
    stepId: string;
    stepName: string;
    preferredKey: string | null;
    sharedFallbackRequired: boolean;
}
interface StepExecutionMetadata {
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
interface StepExecutionResult<T> {
    value: T;
    metadata: StepExecutionMetadata;
}
interface RunnableStep<T> extends StepDefinition {
    run: (apiKey: string) => Promise<T>;
}
interface StepRunnerOptions {
    defaultTimeoutMs?: number;
    maxRetries?: number;
    initialBackoffMs?: number;
    maxBackoffMs?: number;
    acquireInitialKey?: (context: AcquireInitialKeyContext) => Promise<AcquireKeyResult>;
    rotateKey?: (context: RotateKeyContext) => Promise<RotateKeyResult>;
    releaseKey?: (context: ReleaseKeyContext) => Promise<void>;
}
interface AcquireInitialKeyContext {
    pool: KeyPool;
    step: RunnableStep<unknown>;
    preferredKey: string | null;
}
interface AcquireKeyResult {
    key: string;
    usedPreferred: boolean;
    sharedFallbackUsed: boolean;
}
interface RotateKeyContext {
    pool: KeyPool;
    step: RunnableStep<unknown>;
    currentKey: string;
    retryCount: number;
    errorClass: ErrorClass | null;
}
interface RotateKeyResult {
    key: string;
    sharedFallbackUsed: boolean;
}
interface ReleaseKeyContext {
    pool: KeyPool;
    step: RunnableStep<unknown>;
    key: string;
    failed: boolean;
    authFailure: boolean;
    errorClass: ErrorClass | null;
}

declare function planPreferredKeys(pool: KeyPool, steps: readonly StepDefinition[]): Promise<PlannedStepAssignment[]>;

declare class LeaseHeartbeat {
    private readonly pool;
    private timer;
    private leaseError;
    private currentKey;
    private readonly intervalMs;
    constructor(pool: KeyPool, apiKey: string, intervalMs?: number);
    private start;
    switchKey(apiKey: string): void;
    stop(): void;
    getError(): Error | null;
}

declare class StepRunner {
    private readonly pool;
    private readonly options;
    constructor(pool: KeyPool, options?: StepRunnerOptions);
    runStep<T>(step: RunnableStep<T>): Promise<StepExecutionResult<T>>;
    runSteps(steps: readonly RunnableStep<unknown>[]): Promise<StepExecutionResult<unknown>[]>;
    private acquireInitialKey;
    private rotateKey;
    private releaseKey;
    private normalizeAcquireResult;
}

export { LeaseHeartbeat, type PlannedStepAssignment, type RunnableStep, type StepDefinition, type StepExecutionMetadata, type StepExecutionResult, StepRunner, type StepRunnerOptions, planPreferredKeys };
