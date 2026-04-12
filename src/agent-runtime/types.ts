export type TaskStatus = "active" | "paused" | "completed" | "cancelled";

export type StructuredData =
  | null
  | string
  | number
  | boolean
  | StructuredData[]
  | { [key: string]: StructuredData };

export type CheckpointStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export type CheckpointPriority = "high" | "medium" | "low";

export interface TaskCheckpoint {
  id: string;
  content: string;
  status: CheckpointStatus;
  priority: CheckpointPriority;
}

export interface ActiveTask<TMetadata extends StructuredData = StructuredData> {
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

export type InterruptClassification =
  | "status_question"
  | "requirement_update"
  | "clarification"
  | "redirect"
  | "cancel";

export interface InterruptEvent {
  kind: InterruptClassification;
  message: string;
  at?: number;
}

export interface PendingAction<TArgs extends StructuredData = StructuredData> {
  actionName: string;
  args: TArgs;
  sourceTurnId: string;
  prompt: string;
  createdAt: number;
  expiresAt: number | null;
  consumedAt: number | null;
  cancelledAt: number | null;
}

export interface CompletionCheckResult {
  ok: boolean;
  incompleteCheckpointIds: string[];
  activeBlockers: string[];
  status: TaskStatus | null;
}

export interface AgentRuntimeOptions {
  now?: () => number;
}
