import { describe, expect, it, vi } from "vitest";
import { ProjectQueueWorkerRuntime } from "@/lib/server/project-queues/worker-runtime";

describe("Project Queue worker runtime", () => {
  it("runs one worker operation at a time to a deterministic bound", async () => {
    let active = 0;
    let maximum = 0;
    const runOnce = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { status: "completed" as const, messageId: "message" };
    });
    const runtime = new ProjectQueueWorkerRuntime({ runOnce }, {
      idleDelayMs: 10, errorDelayMs: 10, maxIterations: 3,
    });
    await expect(runtime.run(new AbortController().signal)).resolves.toEqual({
      reason: "max_iterations", iterations: 3, failures: 0,
    });
    expect(maximum).toBe(1);
    expect(runOnce).toHaveBeenCalledTimes(3);
  });

  it("counts a fail-closed claim error and can be aborted during backoff", async () => {
    const controller = new AbortController();
    const runtime = new ProjectQueueWorkerRuntime({
      async runOnce() { controller.abort(); return { status: "claim_failed" }; },
    }, { idleDelayMs: 10, errorDelayMs: 10 });
    await expect(runtime.run(controller.signal)).resolves.toEqual({
      reason: "aborted", iterations: 1, failures: 1,
    });
  });

  it("refuses concurrent run loops", async () => {
    const controller = new AbortController();
    const runtime = new ProjectQueueWorkerRuntime({
      async runOnce() { return { status: "idle" }; },
    }, { idleDelayMs: 50, errorDelayMs: 10 });
    const first = runtime.run(controller.signal);
    await expect(runtime.run(controller.signal)).rejects.toThrow("already running");
    controller.abort();
    await first;
  });
});
