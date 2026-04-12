import type {
  ActiveTask,
  AgentRuntimeOptions,
  CompletionCheckResult,
  InterruptEvent,
  PendingAction,
  StructuredData,
  TaskCheckpoint,
} from "./types.js";

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

export class AgentRuntime<
  TMetadata extends StructuredData = StructuredData,
  TActionArgs extends StructuredData = StructuredData,
> {
  private activeTask: ActiveTask<TMetadata> | null = null;

  private pendingAction: PendingAction<TActionArgs> | null = null;

  private readonly now: () => number;

  constructor(options: AgentRuntimeOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  startTask(input: StartTaskInput<TMetadata>): ActiveTask<TMetadata> {
    const task: ActiveTask<TMetadata> = {
      id: input.id,
      objective: input.objective,
      status: "active",
      currentStep: input.currentStep ?? null,
      checkpoints: input.checkpoints.map((checkpoint) => ({ ...checkpoint })),
      blockers: [],
      requirementLog: [],
      metadata: cloneValue(input.metadata),
      updatedAt: this.now(),
    };

    this.activeTask = task;
    this.clearPendingAction();
    return this.snapshotTaskRequired();
  }

  getActiveTask(): ActiveTask<TMetadata> | null {
    return this.snapshotTask();
  }

  setCurrentStep(step: string | null): ActiveTask<TMetadata> {
    const task = this.requireActiveTask();
    task.currentStep = step;
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }

  updateCheckpoint(id: string, status: TaskCheckpoint["status"]): ActiveTask<TMetadata> {
    const task = this.requireActiveTask();
    task.checkpoints = task.checkpoints.map((checkpoint) =>
      checkpoint.id === id ? { ...checkpoint, status } : checkpoint,
    );
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }

  addCheckpoint(checkpoint: TaskCheckpoint): ActiveTask<TMetadata> {
    const task = this.requireActiveTask();
    task.checkpoints = [...task.checkpoints, { ...checkpoint }];
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }

  mergeRequirement(message: string): ActiveTask<TMetadata> {
    const task = this.requireActiveTask();
    task.requirementLog = [...task.requirementLog, message];
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }

  addBlocker(blocker: string): ActiveTask<TMetadata> {
    const task = this.requireActiveTask();
    if (!task.blockers.includes(blocker)) {
      task.blockers = [...task.blockers, blocker];
      task.updatedAt = this.now();
    }
    return this.snapshotTaskRequired();
  }

  clearBlocker(blocker: string): ActiveTask<TMetadata> {
    const task = this.requireActiveTask();
    task.blockers = task.blockers.filter((entry) => entry !== blocker);
    task.updatedAt = this.now();
    return this.snapshotTaskRequired();
  }

  applyInterrupt(event: InterruptEvent): ActiveTask<TMetadata> | null {
    const task = this.requireActiveTask();
    const stamped = event.at ?? this.now();

    switch (event.kind) {
      case "status_question":
      case "clarification":
        task.updatedAt = stamped;
        break;
      case "requirement_update":
        task.requirementLog = [...task.requirementLog, event.message];
        task.updatedAt = stamped;
        break;
      case "redirect":
        task.status = "paused";
        task.updatedAt = stamped;
        this.clearPendingAction();
        break;
      case "cancel":
        task.status = "cancelled";
        task.updatedAt = stamped;
        this.cancelPendingAction();
        break;
      default:
        return this.snapshotTask();
    }

    return this.snapshotTask();
  }

  resumeTask(): ActiveTask<TMetadata> {
    const task = this.requireActiveTask();
    if (task.status === "paused") {
      task.status = "active";
      task.updatedAt = this.now();
    }
    return this.snapshotTaskRequired();
  }

  createPendingAction(input: CreatePendingActionInput<TActionArgs>): PendingAction<TActionArgs> {
    const createdAt = this.now();
    this.pendingAction = {
      actionName: input.actionName,
      args: cloneValue(input.args),
      sourceTurnId: input.sourceTurnId,
      prompt: input.prompt,
      createdAt,
      expiresAt: input.ttlMs == null ? null : createdAt + input.ttlMs,
      consumedAt: null,
      cancelledAt: null,
    };

    return this.getPendingActionRequired();
  }

  getPendingAction(): PendingAction<TActionArgs> | null {
    if (!this.pendingAction) {
      return null;
    }

    if (this.isPendingActionExpired(this.pendingAction)) {
      this.pendingAction = null;
      return null;
    }

    return {
      ...this.pendingAction,
      args: cloneValue(this.pendingAction.args),
    };
  }

  consumePendingAction(): PendingAction<TActionArgs> | null {
    const pending = this.getPendingAction();
    if (!pending) {
      return null;
    }

    this.pendingAction = {
      ...pending,
      consumedAt: this.now(),
    };

    return {
      ...this.pendingAction,
      args: cloneValue(this.pendingAction.args),
    };
  }

  cancelPendingAction(): PendingAction<TActionArgs> | null {
    const pending = this.getPendingAction();
    if (!pending) {
      return null;
    }

    this.pendingAction = {
      ...pending,
      cancelledAt: this.now(),
    };

    return {
      ...this.pendingAction,
      args: cloneValue(this.pendingAction.args),
    };
  }

  clearPendingAction(): void {
    this.pendingAction = null;
  }

  canCompleteTask(): CompletionCheckResult {
    if (!this.activeTask) {
      return {
        ok: false,
        incompleteCheckpointIds: [],
        activeBlockers: [],
        status: null,
      };
    }

    const incompleteCheckpointIds = this.activeTask.checkpoints
      .filter((checkpoint) => checkpoint.status !== "completed" && checkpoint.status !== "cancelled")
      .map((checkpoint) => checkpoint.id);

    return {
      ok:
        this.activeTask.status === "active" &&
        incompleteCheckpointIds.length === 0 &&
        this.activeTask.blockers.length === 0,
      incompleteCheckpointIds,
      activeBlockers: [...this.activeTask.blockers],
      status: this.activeTask.status,
    };
  }

  completeTask(): ActiveTask<TMetadata> {
    const result = this.canCompleteTask();
    if (!result.ok) {
      throw new Error("cannot complete task while checkpoints or blockers remain");
    }

    const task = this.requireActiveTask();
    task.status = "completed";
    task.updatedAt = this.now();
    this.clearPendingAction();
    return this.snapshotTaskRequired();
  }

  snapshot(): { activeTask: ActiveTask<TMetadata> | null; pendingAction: PendingAction<TActionArgs> | null } {
    return {
      activeTask: this.getActiveTask(),
      pendingAction: this.getPendingAction(),
    };
  }

  private requireActiveTask(): ActiveTask<TMetadata> {
    if (!this.activeTask) {
      throw new Error("no active task");
    }

    return this.activeTask;
  }

  private snapshotTask(): ActiveTask<TMetadata> | null {
    if (!this.activeTask) {
      return null;
    }

    return {
      ...this.activeTask,
      checkpoints: this.activeTask.checkpoints.map((checkpoint) => ({ ...checkpoint })),
      blockers: [...this.activeTask.blockers],
      requirementLog: [...this.activeTask.requirementLog],
      metadata: cloneValue(this.activeTask.metadata),
    };
  }

  private snapshotTaskRequired(): ActiveTask<TMetadata> {
    const snapshot = this.snapshotTask();
    if (!snapshot) {
      throw new Error("no active task");
    }

    return snapshot;
  }

  private getPendingActionRequired(): PendingAction<TActionArgs> {
    const pending = this.getPendingAction();
    if (!pending) {
      throw new Error("no pending action");
    }

    return pending;
  }

  private isPendingActionExpired(action: PendingAction<TActionArgs>): boolean {
    if (action.expiresAt == null) {
      return action.cancelledAt != null || action.consumedAt != null;
    }

    return (
      action.cancelledAt != null ||
      action.consumedAt != null ||
      action.expiresAt <= this.now()
    );
  }
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}
