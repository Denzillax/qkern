import type { ProjectQueueWorker, ProjectQueueWorkerOutcome } from "@/lib/server/project-queues/worker";
import { safeRuntimeProbe, type RuntimeProbeObserver } from "@/lib/server/operations/runtime-probe";

export type ProjectQueueWorkerRuntimeResult = Readonly<{
  reason: "aborted" | "max_iterations";
  iterations: number;
  failures: number;
}>;

export class ProjectQueueWorkerRuntime {
  private readonly idleDelayMs: number;
  private readonly errorDelayMs: number;
  private readonly maxIterations?: number;
  private readonly probe?: RuntimeProbeObserver;
  private active: Promise<ProjectQueueWorkerRuntimeResult> | null = null;

  constructor(
    private readonly worker: Pick<ProjectQueueWorker, "runOnce">,
    options: {
      idleDelayMs?: number;
      errorDelayMs?: number;
      maxIterations?: number;
      probe?: RuntimeProbeObserver;
    } = {},
  ) {
    this.idleDelayMs = bounded(options.idleDelayMs ?? 1_000, "idleDelayMs");
    this.errorDelayMs = bounded(options.errorDelayMs ?? 1_000, "errorDelayMs");
    if (options.maxIterations !== undefined &&
        (!Number.isSafeInteger(options.maxIterations) || options.maxIterations < 1)) {
      throw new Error("maxIterations must be a positive safe integer.");
    }
    this.maxIterations = options.maxIterations;
    this.probe = options.probe;
  }

  run(signal: AbortSignal): Promise<ProjectQueueWorkerRuntimeResult> {
    if (this.active) return Promise.reject(new Error("Project queue worker runtime is already running."));
    safeRuntimeProbe(this.probe, "runtimeStarted");
    const operation = this.loop(signal).finally(() => {
      safeRuntimeProbe(this.probe, "runtimeStopped");
      if (this.active === operation) this.active = null;
    });
    this.active = operation;
    return operation;
  }

  private async loop(signal: AbortSignal): Promise<ProjectQueueWorkerRuntimeResult> {
    let iterations = 0;
    let failures = 0;
    while (!signal.aborted && (this.maxIterations === undefined || iterations < this.maxIterations)) {
      iterations += 1;
      let outcome: ProjectQueueWorkerOutcome;
      try {
        outcome = await this.worker.runOnce(signal);
      } catch {
        failures += 1;
        safeRuntimeProbe(this.probe, "iterationFailed");
        if (!await delay(this.errorDelayMs, signal)) break;
        continue;
      }
      if (outcome.status === "claim_failed") {
        failures += 1;
        safeRuntimeProbe(this.probe, "iterationFailed");
      } else {
        safeRuntimeProbe(this.probe, "iterationSucceeded");
      }
      if (signal.aborted || outcome.status === "aborted" || this.reachedLimit(iterations)) break;
      if (["idle", "claim_failed"].includes(outcome.status) && !await delay(
        outcome.status === "idle" ? this.idleDelayMs : this.errorDelayMs,
        signal,
      )) break;
    }
    return {
      reason: signal.aborted ? "aborted" : "max_iterations",
      iterations,
      failures,
    };
  }

  private reachedLimit(iterations: number) {
    return this.maxIterations !== undefined && iterations >= this.maxIterations;
  }
}

function bounded(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 10 || value > 60_000) {
    throw new Error(`${name} must be an integer between 10 and 60000.`);
  }
  return value;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (elapsed: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(elapsed);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
