import type { MigrationWorkerResult } from "@/lib/server/migrations/model";
import type { MigrationWorker } from "@/lib/server/migrations/worker";
import {
  safeRuntimeProbe,
  type RuntimeProbeObserver,
} from "@/lib/server/operations/runtime-probe";

const MIN_DELAY_MS = 10;
const MAX_DELAY_MS = 60_000;
const DEFAULT_IDLE_DELAY_MS = 1_000;
const DEFAULT_ERROR_BASE_DELAY_MS = 1_000;
const DEFAULT_ERROR_MAX_DELAY_MS = 30_000;

export type MigrationWorkerRuntimeLogEvent =
  | { event: "migration_runtime.started" }
  | {
      event: "migration_runtime.iteration_completed";
      iteration: number;
      outcome: MigrationWorkerResult["status"];
    }
  | {
      event: "migration_runtime.iteration_failed";
      iteration: number;
      consecutiveErrors: number;
      backoffMs: number;
      errorCode: "WORKER_ITERATION_FAILED";
    }
  | {
      event: "migration_runtime.stopped";
      reason: "aborted" | "max_iterations";
      iterations: number;
      errors: number;
    };

export interface MigrationWorkerRuntimeLogger {
  log(event: MigrationWorkerRuntimeLogEvent): void;
}

export type MigrationWorkerRuntimeOptions = {
  idleDelayMs?: number;
  errorBaseDelayMs?: number;
  errorMaxDelayMs?: number;
  /** A deterministic loop bound intended for tests and controlled one-shot hosts. */
  maxIterations?: number;
  logger?: MigrationWorkerRuntimeLogger;
  probe?: RuntimeProbeObserver;
};

export type MigrationWorkerRuntimeRunOptions = {
  signal?: AbortSignal;
};

export type MigrationWorkerRuntimeResult = {
  reason: "aborted" | "max_iterations";
  iterations: number;
  errors: number;
};

type RunnableMigrationWorker = Pick<MigrationWorker, "runOnce">;

const silentLogger: MigrationWorkerRuntimeLogger = { log: () => undefined };

/**
 * Sequentially drains the migration queue without coupling the loop to a
 * database, process manager, or concrete project-database executor.
 *
 * Abort requests stop polling immediately. An in-flight runOnce is allowed to
 * settle before run() resolves so a host can perform an orderly shutdown.
 */
export class MigrationWorkerRuntime {
  private readonly idleDelayMs: number;
  private readonly errorBaseDelayMs: number;
  private readonly errorMaxDelayMs: number;
  private readonly maxIterations?: number;
  private readonly logger: MigrationWorkerRuntimeLogger;
  private readonly probe?: RuntimeProbeObserver;
  private activeRun: Promise<MigrationWorkerRuntimeResult> | null = null;
  private activeController: AbortController | null = null;

  constructor(
    private readonly worker: RunnableMigrationWorker,
    options: MigrationWorkerRuntimeOptions = {},
  ) {
    this.idleDelayMs = boundedDelay(options.idleDelayMs, DEFAULT_IDLE_DELAY_MS, "idleDelayMs");
    this.errorBaseDelayMs = boundedDelay(
      options.errorBaseDelayMs,
      DEFAULT_ERROR_BASE_DELAY_MS,
      "errorBaseDelayMs",
    );
    this.errorMaxDelayMs = boundedDelay(
      options.errorMaxDelayMs,
      DEFAULT_ERROR_MAX_DELAY_MS,
      "errorMaxDelayMs",
    );
    if (this.errorMaxDelayMs < this.errorBaseDelayMs) {
      throw new Error("errorMaxDelayMs must be greater than or equal to errorBaseDelayMs.");
    }
    if (options.maxIterations !== undefined &&
        (!Number.isSafeInteger(options.maxIterations) || options.maxIterations < 1)) {
      throw new Error("maxIterations must be a positive safe integer when provided.");
    }
    this.maxIterations = options.maxIterations;
    this.logger = options.logger ?? silentLogger;
    this.probe = options.probe;
  }

  run(options: MigrationWorkerRuntimeRunOptions = {}): Promise<MigrationWorkerRuntimeResult> {
    if (this.activeRun) return Promise.reject(new Error("Migration worker runtime is already running."));

    const controller = new AbortController();
    const externalSignal = options.signal;
    const forwardAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", forwardAbort, { once: true });

    this.activeController = controller;
    safeRuntimeProbe(this.probe, "runtimeStarted");
    const execution = this.runLoop(controller.signal).finally(() => {
      safeRuntimeProbe(this.probe, "runtimeStopped");
      externalSignal?.removeEventListener("abort", forwardAbort);
      if (this.activeRun === execution) {
        this.activeRun = null;
        this.activeController = null;
      }
    });
    this.activeRun = execution;
    return execution;
  }

  /** Requests shutdown and waits for any in-flight iteration to settle. */
  async stop(): Promise<void> {
    this.activeController?.abort();
    await this.activeRun;
  }

  private async runLoop(signal: AbortSignal): Promise<MigrationWorkerRuntimeResult> {
    let iterations = 0;
    let errors = 0;
    let consecutiveErrors = 0;
    safeLog(this.logger, { event: "migration_runtime.started" });

    while (!signal.aborted && (this.maxIterations === undefined || iterations < this.maxIterations)) {
      iterations += 1;
      try {
        // Deliberately awaited before the next claim: at most one runOnce from
        // this runtime can be in flight at any time.
        const result = await this.worker.runOnce();
        consecutiveErrors = 0;
        safeRuntimeProbe(this.probe, "iterationSucceeded");
        safeLog(this.logger, {
          event: "migration_runtime.iteration_completed",
          iteration: iterations,
          outcome: result.status,
        });
        if (signal.aborted || this.reachedIterationLimit(iterations)) break;
        if (result.status === "idle" && !(await abortableDelay(this.idleDelayMs, signal))) break;
      } catch {
        errors += 1;
        consecutiveErrors += 1;
        safeRuntimeProbe(this.probe, "iterationFailed");
        const backoffMs = errorBackoff(this.errorBaseDelayMs, this.errorMaxDelayMs, consecutiveErrors);
        safeLog(this.logger, {
          event: "migration_runtime.iteration_failed",
          iteration: iterations,
          consecutiveErrors,
          backoffMs,
          errorCode: "WORKER_ITERATION_FAILED",
        });
        if (signal.aborted || this.reachedIterationLimit(iterations)) break;
        if (!(await abortableDelay(backoffMs, signal))) break;
      }
    }

    const reason = signal.aborted ? "aborted" : "max_iterations";
    const result: MigrationWorkerRuntimeResult = { reason, iterations, errors };
    safeLog(this.logger, { event: "migration_runtime.stopped", ...result });
    return result;
  }

  private reachedIterationLimit(iterations: number): boolean {
    return this.maxIterations !== undefined && iterations >= this.maxIterations;
  }
}

function boundedDelay(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < MIN_DELAY_MS || resolved > MAX_DELAY_MS) {
    throw new Error(`${name} must be an integer between ${MIN_DELAY_MS} and ${MAX_DELAY_MS}.`);
  }
  return resolved;
}

function errorBackoff(baseMs: number, maxMs: number, consecutiveErrors: number): number {
  const exponent = Math.min(Math.max(consecutiveErrors - 1, 0), 16);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const complete = (elapsed: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(elapsed);
    };
    const onAbort = () => complete(false);
    const timer = setTimeout(() => complete(true), delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function safeLog(logger: MigrationWorkerRuntimeLogger, event: MigrationWorkerRuntimeLogEvent): void {
  try {
    logger.log(event);
  } catch {
    // Observability must not control migration execution or process liveness.
  }
}
