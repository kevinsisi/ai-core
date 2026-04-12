type TaskStatus = "active" | "paused" | "completed" | "cancelled";
type StructuredData = null | string | number | boolean | StructuredData[] | {
    [key: string]: StructuredData;
};
type CheckpointStatus = "pending" | "in_progress" | "completed" | "cancelled";
type CheckpointPriority = "high" | "medium" | "low";
interface TaskCheckpoint {
    id: string;
    content: string;
    status: CheckpointStatus;
    priority: CheckpointPriority;
}
interface ActiveTask<TMetadata extends StructuredData = StructuredData> {
    id: string;
    objective: string;
    status: TaskStatus;
    currentStep: string | null;
    checkpoints: TaskCheckpoint[];
    blockers: string[];
    requirementLog: string[];
    metadata: TMetadata;
    updatedAt: number;
}
type InterruptClassification = "status_question" | "requirement_update" | "clarification" | "redirect" | "cancel";
interface InterruptEvent {
    kind: InterruptClassification;
    message: string;
    at?: number;
}
interface PendingAction<TArgs extends StructuredData = StructuredData> {
    actionName: string;
    args: TArgs;
    sourceTurnId: string;
    prompt: string;
    createdAt: number;
    expiresAt: number | null;
    consumedAt: number | null;
    cancelledAt: number | null;
}
interface CompletionCheckResult {
    ok: boolean;
    incompleteCheckpointIds: string[];
    activeBlockers: string[];
    status: TaskStatus | null;
}
interface AgentRuntimeOptions {
    now?: () => number;
}

interface StartTaskInput<TMetadata extends StructuredData> {
    id: string;
    objective: string;
    checkpoints: TaskCheckpoint[];
    metadata: TMetadata;
    currentStep?: string | null;
}
interface CreatePendingActionInput<TArgs extends StructuredData> {
    actionName: string;
    args: TArgs;
    sourceTurnId: string;
    prompt: string;
    ttlMs?: number | null;
}
declare class AgentRuntime<TMetadata extends StructuredData = StructuredData, TActionArgs extends StructuredData = StructuredData> {
    private activeTask;
    private pendingAction;
    private readonly now;
    constructor(options?: AgentRuntimeOptions);
    startTask(input: StartTaskInput<TMetadata>): ActiveTask<TMetadata>;
    getActiveTask(): ActiveTask<TMetadata> | null;
    setCurrentStep(step: string | null): ActiveTask<TMetadata>;
    updateCheckpoint(id: string, status: TaskCheckpoint["status"]): ActiveTask<TMetadata>;
    addCheckpoint(checkpoint: TaskCheckpoint): ActiveTask<TMetadata>;
    mergeRequirement(message: string): ActiveTask<TMetadata>;
    addBlocker(blocker: string): ActiveTask<TMetadata>;
    clearBlocker(blocker: string): ActiveTask<TMetadata>;
    applyInterrupt(event: InterruptEvent): ActiveTask<TMetadata> | null;
    resumeTask(): ActiveTask<TMetadata>;
    createPendingAction(input: CreatePendingActionInput<TActionArgs>): PendingAction<TActionArgs>;
    getPendingAction(): PendingAction<TActionArgs> | null;
    consumePendingAction(): PendingAction<TActionArgs> | null;
    cancelPendingAction(): PendingAction<TActionArgs> | null;
    clearPendingAction(): void;
    canCompleteTask(): CompletionCheckResult;
    completeTask(): ActiveTask<TMetadata>;
    snapshot(): {
        activeTask: ActiveTask<TMetadata> | null;
        pendingAction: PendingAction<TActionArgs> | null;
    };
    private requireActiveTask;
    private snapshotTask;
    private snapshotTaskRequired;
    private getPendingActionRequired;
    private isPendingActionExpired;
}

export { type ActiveTask, AgentRuntime, type AgentRuntimeOptions, type CheckpointPriority, type CheckpointStatus, type CompletionCheckResult, type InterruptClassification, type InterruptEvent, type PendingAction, type TaskCheckpoint, type TaskStatus };
