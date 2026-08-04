import type {
  ProjectQueueFailureCode,
  ProjectQueueJson,
  ProjectQueuePrincipal,
  ProjectQueueScope,
} from "@/lib/server/project-queues/model";
import { ProjectQueueError, type ProjectQueueService } from "@/lib/server/project-queues/service";

type HandlerFailureCode = Exclude<ProjectQueueFailureCode, "LEASE_EXPIRED" | "HANDLER_TIMEOUT">;

export class ProjectQueueHandlerError extends Error {
  constructor(readonly failureCode: HandlerFailureCode) {
    super("Project queue handler failed.");
    this.name = "ProjectQueueHandlerError";
  }
}

export type ProjectQueueHandlerMessage = Readonly<{
  id: string;
  queue: string;
  payload: ProjectQueueJson;
  attempt: number;
  createdAt: string;
}>;

export interface ProjectQueueHandler {
  handle(message: ProjectQueueHandlerMessage, options: { signal: AbortSignal }): Promise<void>;
}

export type ProjectQueueWorkerOutcome =
  | { status: "idle" | "aborted" | "claim_failed" }
  | { status: "completed" | "retry_scheduled" | "dead_lettered" | "lease_lost"; messageId: string };

export type ProjectQueueWorkerLogEvent = Readonly<{
  event: "project_queue_worker.claimed" | "project_queue_worker.completed" |
    "project_queue_worker.retry_scheduled" | "project_queue_worker.dead_lettered" |
    "project_queue_worker.lease_lost" | "project_queue_worker.aborted" |
    "project_queue_worker.claim_failed";
  queue: string;
  status: ProjectQueueWorkerOutcome["status"] | "claimed";
  messageId?: string;
  attempt?: number;
  failureCode?: ProjectQueueFailureCode | "CLAIM_FAILED";
}>;

export interface ProjectQueueWorkerLogger {
  log(event: ProjectQueueWorkerLogEvent): void;
}

export type ProjectQueueWorkerSnapshot = Readonly<{
  claimed: number;
  completed: number;
  retryScheduled: number;
  deadLettered: number;
  timedOut: number;
  leaseLost: number;
  renewals: number;
  claimFailures: number;
}>;

export class ProjectQueueWorkerMetrics {
  private counters = {
    claimed: 0, completed: 0, retryScheduled: 0, deadLettered: 0,
    timedOut: 0, leaseLost: 0, renewals: 0, claimFailures: 0,
  };

  increment(counter: keyof ProjectQueueWorkerSnapshot) { this.counters[counter] += 1; }
  snapshot(): ProjectQueueWorkerSnapshot { return Object.freeze({ ...this.counters }); }
}

export class ProjectQueueWorker {
  private readonly timeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly logger: ProjectQueueWorkerLogger;
  readonly metrics: ProjectQueueWorkerMetrics;

  constructor(private readonly options: {
    service: ProjectQueueService;
    principal: ProjectQueuePrincipal;
    scope: ProjectQueueScope;
    queue: string;
    workerId: string;
    handler: ProjectQueueHandler;
    timeoutMs?: number;
    heartbeatMs?: number;
    logger?: ProjectQueueWorkerLogger;
    metrics?: ProjectQueueWorkerMetrics;
  }) {
    if (options.principal.role !== "service_role" || options.principal.organizationId !== options.scope.organizationId) {
      throw new Error("Project queue worker requires one scope-bound service principal.");
    }
    this.timeoutMs = bounded(options.timeoutMs ?? 60_000, 10, 900_000, "timeoutMs");
    this.heartbeatMs = bounded(options.heartbeatMs ?? 10_000, 10, 300_000, "heartbeatMs");
    if (this.heartbeatMs >= this.timeoutMs) throw new Error("heartbeatMs must be lower than timeoutMs.");
    this.logger = options.logger ?? { log() {} };
    this.metrics = options.metrics ?? new ProjectQueueWorkerMetrics();
  }

  async runOnce(signal?: AbortSignal): Promise<ProjectQueueWorkerOutcome> {
    if (signal?.aborted) return { status: "aborted" };
    let claim;
    try {
      claim = (await this.options.service.claim(
        this.options.principal,
        this.options.scope,
        this.options.queue,
        { workerId: this.options.workerId, limit: 1 },
      ))[0];
    } catch {
      this.metrics.increment("claimFailures");
      safeLog(this.logger, {
        event: "project_queue_worker.claim_failed",
        queue: this.options.queue,
        status: "claim_failed",
        failureCode: "CLAIM_FAILED",
      });
      return { status: "claim_failed" };
    }
    if (!claim) return signal?.aborted ? { status: "aborted" } : { status: "idle" };

    this.metrics.increment("claimed");
    safeLog(this.logger, {
      event: "project_queue_worker.claimed", queue: this.options.queue,
      status: "claimed", messageId: claim.id, attempt: claim.attempt,
    });
    const execution = startHandler(this.options.handler, {
      id: claim.id,
      queue: claim.queue,
      payload: claim.payload,
      attempt: claim.attempt,
      createdAt: claim.createdAt,
    }, this.timeoutMs, signal);

    while (true) {
      const next = await Promise.race([
        execution.result.then((outcome) => ({ kind: "handler" as const, outcome })),
        abortableDelay(this.heartbeatMs, signal).then((elapsed) => ({ kind: "heartbeat" as const, elapsed })),
      ]);
      if (next.kind === "handler") return await this.settle(claim, next.outcome);
      if (!next.elapsed) {
        execution.cancel("aborted");
        safeLog(this.logger, {
          event: "project_queue_worker.aborted", queue: this.options.queue,
          status: "aborted", messageId: claim.id, attempt: claim.attempt,
        });
        return { status: "aborted" };
      }
      try {
        await this.options.service.renewLease(
          this.options.principal, this.options.scope, this.options.queue, claim.id,
          { workerId: this.options.workerId, leaseToken: claim.leaseToken },
        );
        this.metrics.increment("renewals");
      } catch {
        execution.cancel("aborted");
        this.metrics.increment("leaseLost");
        safeLog(this.logger, {
          event: "project_queue_worker.lease_lost", queue: this.options.queue,
          status: "lease_lost", messageId: claim.id, attempt: claim.attempt,
        });
        return { status: "lease_lost", messageId: claim.id };
      }
    }
  }

  private async settle(
    claim: { id: string; attempt: number; leaseToken: string },
    outcome: HandlerOutcome,
  ): Promise<ProjectQueueWorkerOutcome> {
    if (outcome.status === "aborted") {
      safeLog(this.logger, {
        event: "project_queue_worker.aborted", queue: this.options.queue,
        status: "aborted", messageId: claim.id, attempt: claim.attempt,
      });
      return { status: "aborted" };
    }
    try {
      if (outcome.status === "completed") {
        await this.options.service.acknowledge(
          this.options.principal, this.options.scope, this.options.queue, claim.id,
          { workerId: this.options.workerId, leaseToken: claim.leaseToken },
        );
        this.metrics.increment("completed");
        safeLog(this.logger, {
          event: "project_queue_worker.completed", queue: this.options.queue,
          status: "completed", messageId: claim.id, attempt: claim.attempt,
        });
        return { status: "completed", messageId: claim.id };
      }
      if (outcome.failureCode === "HANDLER_TIMEOUT") this.metrics.increment("timedOut");
      const failed = await this.options.service.fail(
        this.options.principal, this.options.scope, this.options.queue, claim.id,
        { workerId: this.options.workerId, leaseToken: claim.leaseToken, failureCode: outcome.failureCode },
      );
      const status = failed.status === "dead_lettered" ? "dead_lettered" : "retry_scheduled";
      this.metrics.increment(status === "dead_lettered" ? "deadLettered" : "retryScheduled");
      safeLog(this.logger, {
        event: status === "dead_lettered" ? "project_queue_worker.dead_lettered" :
          "project_queue_worker.retry_scheduled",
        queue: this.options.queue, status, messageId: claim.id, attempt: claim.attempt,
        failureCode: outcome.failureCode,
      });
      return { status, messageId: claim.id };
    } catch (error) {
      if (!(error instanceof ProjectQueueError) || error.code !== "QUEUE_LEASE_LOST") throw error;
      this.metrics.increment("leaseLost");
      safeLog(this.logger, {
        event: "project_queue_worker.lease_lost", queue: this.options.queue,
        status: "lease_lost", messageId: claim.id, attempt: claim.attempt,
      });
      return { status: "lease_lost", messageId: claim.id };
    }
  }
}

type HandlerOutcome =
  | { status: "completed" }
  | { status: "failed"; failureCode: HandlerFailureCode | "HANDLER_TIMEOUT" }
  | { status: "aborted" };

function startHandler(
  handler: ProjectQueueHandler,
  message: ProjectQueueHandlerMessage,
  timeoutMs: number,
  externalSignal?: AbortSignal,
) {
  const controller = new AbortController();
  let complete!: (outcome: HandlerOutcome) => void;
  let settled = false;
  const result = new Promise<HandlerOutcome>((resolve) => { complete = resolve; });
  const finish = (outcome: HandlerOutcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
    if (outcome.status !== "completed") controller.abort();
    complete(outcome);
  };
  const abort = () => finish({ status: "aborted" });
  const timeout = setTimeout(() => finish({ status: "failed", failureCode: "HANDLER_TIMEOUT" }), timeoutMs);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  Promise.resolve().then(() => handler.handle(message, { signal: controller.signal })).then(
    () => finish({ status: "completed" }),
    (error) => finish({
      status: "failed",
      failureCode: error instanceof ProjectQueueHandlerError ? error.failureCode : "HANDLER_ERROR",
    }),
  );
  return { result, cancel: (_reason: "aborted") => finish({ status: "aborted" }) };
}

function bounded(value: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (elapsed: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(elapsed);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function safeLog(logger: ProjectQueueWorkerLogger, event: ProjectQueueWorkerLogEvent) {
  try { logger.log(Object.freeze({ ...event })); } catch { /* Observability is not execution authority. */ }
}
