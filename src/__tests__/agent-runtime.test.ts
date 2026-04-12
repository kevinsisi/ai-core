import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../agent-runtime/agent-runtime.js";
import type { TaskCheckpoint } from "../agent-runtime/types.js";

function makeCheckpoints(): TaskCheckpoint[] {
  return [
    { id: "read-rules", content: "Read governing rules", status: "completed", priority: "high" },
    { id: "implement", content: "Implement the requested change", status: "in_progress", priority: "high" },
    { id: "verify", content: "Verify the result", status: "pending", priority: "high" },
  ];
}

describe("AgentRuntime", () => {
  it("keeps the active task alive on status-question interrupts", () => {
    const runtime = new AgentRuntime<{ project: string }>({ now: () => 1_000 });
    runtime.startTask({
      id: "task-1",
      objective: "Fix playback bug",
      checkpoints: makeCheckpoints(),
      metadata: { project: "home-media" },
      currentStep: "Implementing player fix",
    });

    const task = runtime.applyInterrupt({ kind: "status_question", message: "進度？", at: 2_000 });
    expect(task?.status).toBe("active");
    expect(task?.currentStep).toBe("Implementing player fix");
    expect(task?.updatedAt).toBe(2_000);
  });

  it("merges requirement updates into the active task", () => {
    const runtime = new AgentRuntime();
    runtime.startTask({
      id: "task-2",
      objective: "Harden agent behavior",
      checkpoints: makeCheckpoints(),
      metadata: null,
    });

    const task = runtime.applyInterrupt({
      kind: "requirement_update",
      message: "另外要加入探索式測試",
      at: 3_000,
    });

    expect(task?.requirementLog).toEqual(["另外要加入探索式測試"]);
    expect(task?.status).toBe("active");
  });

  it("stores and consumes pending actions deterministically", () => {
    let now = 10_000;
    const runtime = new AgentRuntime({ now: () => now });

    runtime.createPendingAction({
      actionName: "generate_copy",
      args: { item: "B165", platform: "官網" },
      sourceTurnId: "turn-1",
      prompt: "是否直接生成官網文案？",
      ttlMs: 30_000,
    });

    const pending = runtime.getPendingAction();
    expect(pending?.actionName).toBe("generate_copy");
    expect(pending?.args).toEqual({ item: "B165", platform: "官網" });

    now = 12_000;
    const consumed = runtime.consumePendingAction();
    expect(consumed?.consumedAt).toBe(12_000);
    expect(runtime.getPendingAction()).toBeNull();
  });

  it("does not leak mutable references from task metadata or pending action args", () => {
    const runtime = new AgentRuntime<{ flags: string[] }, { item: string[] }>();
    const checkpoints = makeCheckpoints();
    const metadata = { flags: ["initial"] };
    const args = { item: ["B165"] };

    runtime.startTask({
      id: "task-4",
      objective: "Protect runtime state",
      checkpoints,
      metadata,
    });
    runtime.createPendingAction({
      actionName: "generate_copy",
      args,
      sourceTurnId: "turn-1",
      prompt: "是否生成？",
    });

    metadata.flags.push("mutated-outside");
    checkpoints[0].status = "cancelled";
    args.item.push("mutated-outside");

    const task = runtime.getActiveTask();
    const pending = runtime.getPendingAction();
    expect(task?.metadata.flags).toEqual(["initial"]);
    expect(task?.checkpoints[0]?.status).toBe("completed");
    expect(pending?.args.item).toEqual(["B165"]);
  });

  it("clears pending action when a new task starts", () => {
    const runtime = new AgentRuntime();

    runtime.createPendingAction({
      actionName: "deploy",
      args: { environment: "prod" },
      sourceTurnId: "turn-1",
      prompt: "是否部署？",
    });

    runtime.startTask({
      id: "task-5",
      objective: "A different task",
      checkpoints: makeCheckpoints(),
      metadata: null,
    });

    expect(runtime.getPendingAction()).toBeNull();
  });

  it("clears pending action on redirect interrupts", () => {
    const runtime = new AgentRuntime();
    runtime.startTask({
      id: "task-6",
      objective: "Current task",
      checkpoints: makeCheckpoints(),
      metadata: null,
    });
    runtime.createPendingAction({
      actionName: "deploy",
      args: { environment: "prod" },
      sourceTurnId: "turn-2",
      prompt: "是否部署？",
    });

    const task = runtime.applyInterrupt({ kind: "redirect", message: "先去看別的" });

    expect(task?.status).toBe("paused");
    expect(runtime.getPendingAction()).toBeNull();
  });

  it("expires pending actions after ttl", () => {
    let now = 100;
    const runtime = new AgentRuntime({ now: () => now });

    runtime.createPendingAction({
      actionName: "deploy",
      args: { environment: "prod" },
      sourceTurnId: "turn-9",
      prompt: "是否現在部署？",
      ttlMs: 50,
    });

    now = 151;
    expect(runtime.getPendingAction()).toBeNull();
  });

  it("blocks completion until checkpoints and blockers are cleared", () => {
    const runtime = new AgentRuntime();
    runtime.startTask({
      id: "task-3",
      objective: "Ship the fix",
      checkpoints: makeCheckpoints(),
      metadata: null,
    });

    runtime.addBlocker("Need live verification");
    let check = runtime.canCompleteTask();
    expect(check.ok).toBe(false);
    expect(check.activeBlockers).toEqual(["Need live verification"]);
    expect(check.incompleteCheckpointIds).toEqual(["implement", "verify"]);

    runtime.clearBlocker("Need live verification");
    runtime.updateCheckpoint("implement", "completed");
    runtime.updateCheckpoint("verify", "completed");
    check = runtime.canCompleteTask();
    expect(check.ok).toBe(true);

    const completed = runtime.completeTask();
    expect(completed.status).toBe("completed");
  });
});
