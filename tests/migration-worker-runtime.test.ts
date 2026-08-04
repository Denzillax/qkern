import { afterEach, describe, expect, it, vi } from "vitest";
import type { MigrationWorkerResult } from "@/lib/server/migrations/model";
import {
  MigrationWorkerRuntime,
  type MigrationWorkerRuntimeLogEvent,
} from "@/lib/server/migrations/worker-runtime";

afterEach(() => {
  vi.useRealTimers();
});

describe("MigrationWorkerRuntime", () => {
  it("never overlaps runOnce calls", async () => {
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const worker = {
      runOnce: vi.fn(async (): Promise<MigrationWorkerResult> => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => { release = resolve; });
        active -= 1;
        return { status: "applied", jobId: "redacted-from-runtime-logs" };
      }),
    };
    const runtime = new MigrationWorkerRuntime(worker, { maxIterations: 2 });

    const running = runtime.run();
    await vi.waitFor(() => expect(worker.runOnce).toHaveBeenCalledTimes(1));
    release?.();
    await vi.waitFor(() => expect(worker.runOnce).toHaveBeenCalledTimes(2));
    release?.();

    await expect(running).resolves.toEqual({ reason: "max_iterations", iterations: 2, errors: 0 });
    expect(maxActive).toBe(1);
  });

  it("rejects a concurrent loop start", async () => {
    let release: (() => void) | undefined;
    const runtime = new MigrationWorkerRuntime({
      runOnce: () => new Promise<MigrationWorkerResult>((resolve) => {
        release = () => resolve({ status: "idle" });
      }),
    }, { maxIterations: 1 });

    const first = runtime.run();
    await expect(runtime.run()).rejects.toThrow("already running");
    release?.();
    await first;
  });

  it("applies bounded idle waits and exponential capped error backoff", async () => {
    vi.useFakeTimers();
    const outcomes: Array<MigrationWorkerResult | Error> = [
      { status: "idle" },
      new Error("secret database error"),
      new Error("different secret"),
      new Error("still secret"),
      { status: "idle" },
    ];
    const worker = {
      runOnce: vi.fn(async () => {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome ?? { status: "idle" as const };
      }),
    };
    const logs: MigrationWorkerRuntimeLogEvent[] = [];
    const runtime = new MigrationWorkerRuntime(worker, {
      idleDelayMs: 25,
      errorBaseDelayMs: 100,
      errorMaxDelayMs: 150,
      maxIterations: 5,
      logger: { log: (event) => logs.push(event) },
    });

    const running = runtime.run();
    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(150);

    await expect(running).resolves.toEqual({ reason: "max_iterations", iterations: 5, errors: 3 });
    expect(logs.filter((event) => event.event === "migration_runtime.iteration_failed"))
      .toEqual([
        expect.objectContaining({ backoffMs: 100, errorCode: "WORKER_ITERATION_FAILED" }),
        expect.objectContaining({ backoffMs: 150, errorCode: "WORKER_ITERATION_FAILED" }),
        expect.objectContaining({ backoffMs: 150, errorCode: "WORKER_ITERATION_FAILED" }),
      ]);
    expect(JSON.stringify(logs)).not.toContain("secret");
  });

  it("stops an idle wait immediately when aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const worker = { runOnce: vi.fn(async () => ({ status: "idle" as const })) };
    const runtime = new MigrationWorkerRuntime(worker, { idleDelayMs: 60_000 });

    const running = runtime.run({ signal: controller.signal });
    await vi.waitFor(() => expect(worker.runOnce).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(running).resolves.toEqual({ reason: "aborted", iterations: 1, errors: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for an in-flight iteration during orderly stop and starts no next claim", async () => {
    let release: (() => void) | undefined;
    const worker = {
      runOnce: vi.fn(() => new Promise<MigrationWorkerResult>((resolve) => {
        release = () => resolve({ status: "applied", jobId: "job-1" });
      })),
    };
    const runtime = new MigrationWorkerRuntime(worker);
    const running = runtime.run();
    await vi.waitFor(() => expect(worker.runOnce).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release?.();

    await stopping;
    await expect(running).resolves.toEqual({ reason: "aborted", iterations: 1, errors: 0 });
    expect(worker.runOnce).toHaveBeenCalledTimes(1);
  });

  it("contains worker and logger failures without rejecting the loop", async () => {
    const probe = {
      runtimeStarted: vi.fn(),
      iterationSucceeded: vi.fn(),
      iterationFailed: vi.fn(),
      runtimeStopped: vi.fn(),
    };
    const worker = {
      runOnce: vi.fn()
        .mockRejectedValueOnce(new Error("must not escape"))
        .mockResolvedValueOnce({ status: "applied", jobId: "job-1" }),
    };
    const runtime = new MigrationWorkerRuntime(worker, {
      errorBaseDelayMs: 10,
      errorMaxDelayMs: 10,
      maxIterations: 2,
      logger: { log: () => { throw new Error("logger unavailable"); } },
      probe,
    });

    await expect(runtime.run()).resolves.toEqual({ reason: "max_iterations", iterations: 2, errors: 1 });
    expect(probe.runtimeStarted).toHaveBeenCalledOnce();
    expect(probe.iterationFailed).toHaveBeenCalledOnce();
    expect(probe.iterationSucceeded).toHaveBeenCalledOnce();
    expect(probe.runtimeStopped).toHaveBeenCalledOnce();
  });

  it("validates delay and iteration bounds", () => {
    const worker = { runOnce: vi.fn(async () => ({ status: "idle" as const })) };
    expect(() => new MigrationWorkerRuntime(worker, { idleDelayMs: 0 })).toThrow("idleDelayMs");
    expect(() => new MigrationWorkerRuntime(worker, { errorBaseDelayMs: 200, errorMaxDelayMs: 100 }))
      .toThrow("errorMaxDelayMs");
    expect(() => new MigrationWorkerRuntime(worker, { maxIterations: 0 })).toThrow("maxIterations");
  });
});
