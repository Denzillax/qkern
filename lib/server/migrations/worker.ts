import { approvalActionHash, hashesMatch, sha256, type StatementCipher } from "@/lib/server/control-plane/crypto";
import type { ChangeSetRecord } from "@/lib/server/db/models";
import {
  isOpaqueDatabaseReference,
  ProjectDatabaseExecutionError,
  type ProjectDatabaseExecutor,
} from "@/lib/server/migrations/executor";
import {
  MigrationArtifactError,
  type ClaimedMigrationJob,
  type LeaseMutationResult,
  type MigrationWorkerResult,
} from "@/lib/server/migrations/model";
import type { FailMigrationInput, MigrationQueuePort } from "@/lib/server/migrations/queue-port";
import {
  denyProductionApplyAuthorizer,
  type ProductionApplyAuthorizer,
} from "@/lib/server/migrations/production-apply-authorization";
import { validateSingleSqlStatement } from "@/lib/security";

const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 10 * 60_000;

export type MigrationWorkerLogEvent = {
  event: "migration.claimed" | "migration.applied" | "migration.retry_scheduled" |
    "migration.reconciliation_scheduled" | "migration.review_required" |
    "migration.failed" | "migration.lease_lost" | "migration.completion_deferred";
  jobId: string;
  changeSetId: string;
  attempt: number;
  reconciliationAttempt: number;
  status: string;
  errorCode?: string;
};

export interface MigrationWorkerLogger {
  log(event: MigrationWorkerLogEvent): void;
}

const silentLogger: MigrationWorkerLogger = { log: () => undefined };

export type MigrationWorkerOptions = {
  workerId: string;
  leaseDurationMs?: number;
  retryBaseDelayMs?: number;
  now?: () => Date;
  logger?: MigrationWorkerLogger;
  heartbeatIntervalMs?: number;
  heartbeatDelay?: (delayMs: number, signal: AbortSignal) => Promise<boolean>;
};

type HeartbeatState = "healthy" | "lease_lost" | "renewal_failed";

export class MigrationWorker {
  private readonly leaseDurationMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly now: () => Date;
  private readonly logger: MigrationWorkerLogger;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatDelay: (delayMs: number, signal: AbortSignal) => Promise<boolean>;

  constructor(
    private readonly queue: MigrationQueuePort,
    private readonly executor: ProjectDatabaseExecutor,
    private readonly cipher: StatementCipher,
    private readonly options: MigrationWorkerOptions,
    private readonly productionApplyAuthorizer: ProductionApplyAuthorizer =
      denyProductionApplyAuthorizer,
  ) {
    if (!options.workerId.trim() || options.workerId.length > 200) throw new Error("A bounded workerId is required.");
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
    if (!Number.isInteger(this.leaseDurationMs) || this.leaseDurationMs < MIN_LEASE_MS || this.leaseDurationMs > MAX_LEASE_MS) {
      throw new Error(`leaseDurationMs must be between ${MIN_LEASE_MS} and ${MAX_LEASE_MS}.`);
    }
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    if (!Number.isInteger(this.retryBaseDelayMs) || this.retryBaseDelayMs < 100 || this.retryBaseDelayMs > 60_000) {
      throw new Error("retryBaseDelayMs must be between 100 and 60000.");
    }
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? silentLogger;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(250, Math.floor(this.leaseDurationMs / 3));
    if (!Number.isInteger(this.heartbeatIntervalMs) || this.heartbeatIntervalMs < 100 ||
        this.heartbeatIntervalMs >= this.leaseDurationMs) {
      throw new Error("heartbeatIntervalMs must be an integer between 100 and leaseDurationMs - 1.");
    }
    this.heartbeatDelay = options.heartbeatDelay ?? abortableDelay;
  }

  async runOnce(): Promise<MigrationWorkerResult> {
    const claim = await this.queue.claimNext({
      workerId: this.options.workerId,
      leaseDurationMs: this.leaseDurationMs,
    });
    if (!claim) return { status: "idle" };

    safeLog(this.logger, logEvent(claim, "migration.claimed", "claimed"));
    if (claim.reclaimed || claim.reconciliationRequired) {
      if (!validReconciliationClaim(claim, this.now(), this.options.workerId)) {
        return this.scheduleReconciliation(claim, "INVALID_RECONCILIATION_CLAIM");
      }
      const reconciliation = await this.reconcileClaim(claim);
      if (reconciliation) return reconciliation;
      if (claim.reconciliationRequired) {
        return this.scheduleReconciliation(claim, "MIGRATION_NOT_APPLIED");
      }
    }

    let statement: string;
    try {
      statement = verifyArtifact(claim, this.cipher, this.now(), this.options.workerId);
    } catch (error) {
      const code = error instanceof MigrationArtifactError ? error.code : "INVALID_MIGRATION_ARTIFACT";
      if (claim.reclaimed || claim.reconciliationRequired) return this.scheduleReconciliation(claim, code);
      return this.finishFailure(claim, {
        disposition: "failed",
        errorCode: code,
        redactedMessage: "Migration artifact validation failed.",
      });
    }

    try {
      // This repeats the queue-time authorization with the immutable claimed
      // artifacts. Existing or injected production jobs cannot bypass the
      // release boundary through a worker/deployment misconfiguration.
      try {
        await this.productionApplyAuthorizer.assertAuthorized({
          organizationId: claim.organizationId,
          projectId: claim.projectId,
          environment: claim.environment,
          changeSetId: claim.changeSet.id,
          approvalId: claim.approval.id,
          databaseInstanceRef: claim.databaseInstanceRef,
          statementSha256: claim.changeSet.statementSha256,
          approvalActionHash: claim.approval.actionHash,
        });
      } catch {
        return this.finishFailure(claim, {
          disposition: claim.attempt < claim.maxAttempts ? "retry" : "failed",
          errorCode: "PRODUCTION_APPLY_BLOCKED",
          redactedMessage: "Production apply authorization is unavailable.",
          ...(claim.attempt < claim.maxAttempts
            ? { retryAt: new Date(this.now().getTime() + this.retryBaseDelayMs).toISOString() }
            : {}),
        });
      }
      // Artifact verification, including the plaintext hash and one-statement
      // parser check and production authorization deliberately occur
      // immediately before this call.
      const execution = await this.withLeaseHeartbeat(claim, () => this.executor.execute({
          databaseInstanceRef: claim.databaseInstanceRef,
          changeSetId: claim.changeSet.id,
          statement,
          statementSha256: claim.changeSet.statementSha256,
          jobId: claim.jobId,
          fenceEpoch: claim.fenceEpoch,
          leaseToken: claim.lease.token,
        }));
      if (execution.heartbeat === "lease_lost") return this.leaseLost(claim);
      if (execution.heartbeat === "renewal_failed") return this.scheduleReconciliation(claim, "LEASE_RENEWAL_FAILED");
      if (execution.error !== undefined) throw execution.error;
      const result = execution.value!;
      if (result.status !== "applied" && result.status !== "already_applied") {
        throw new ProjectDatabaseExecutionError({
          code: "INVALID_EXECUTOR_RESULT",
          outcome: "unknown",
        });
      }
      return await this.finishApplied(claim, result.status);
    } catch (error) {
      // A reclaimed claim may persist retry/failure only after the target has
      // durably confirmed this claim's higher fence. Otherwise an older worker
      // could still commit after the Control Plane moved to a terminal state.
      if (claim.reclaimed && (!(error instanceof ProjectDatabaseExecutionError) || error.fenceStatus !== "confirmed")) {
        return this.scheduleReconciliation(claim, "RECLAIMED_EXECUTION_NOT_CONFIRMED");
      }
      return this.finishExecutionFailure(claim, error);
    }
  }

  private async reconcileClaim(claim: ClaimedMigrationJob): Promise<MigrationWorkerResult | null> {
    if (!this.executor.reconcile) {
      return this.scheduleReconciliation(claim, "RECONCILIATION_UNAVAILABLE");
    }
    try {
      const reconciliation = await this.withLeaseHeartbeat(claim, () => this.executor.reconcile!({
        databaseInstanceRef: claim.databaseInstanceRef,
        changeSetId: claim.changeSet.id,
        statementSha256: claim.changeSet.statementSha256,
        jobId: claim.jobId,
        fenceEpoch: claim.fenceEpoch,
        leaseToken: claim.lease.token,
      }));
      if (reconciliation.heartbeat === "lease_lost") return this.leaseLost(claim);
      if (reconciliation.heartbeat === "renewal_failed") {
        return this.scheduleReconciliation(claim, "LEASE_RENEWAL_FAILED");
      }
      if (reconciliation.error !== undefined) throw reconciliation.error;
      const result = reconciliation.value!;
      if (result.status === "applied") return this.finishApplied(claim, "already_applied");
      return null;
    } catch {
      return this.scheduleReconciliation(claim, "RECONCILIATION_FAILED");
    }
  }

  private async withLeaseHeartbeat<T>(
    claim: ClaimedMigrationJob,
    operation: () => Promise<T>,
  ): Promise<{ heartbeat: HeartbeatState; value?: T; error?: unknown }> {
    const controller = new AbortController();
    let heartbeat: HeartbeatState = "healthy";
    const renewal = (async () => {
      while (await this.heartbeatDelay(this.heartbeatIntervalMs, controller.signal)) {
        try {
          const result = await this.queue.renewLease({
            ...leaseIdentity(claim),
            leaseDurationMs: this.leaseDurationMs,
          });
          if (result.status === "lease_lost") {
            heartbeat = "lease_lost";
            return;
          }
        } catch {
          heartbeat = "renewal_failed";
          return;
        }
      }
    })();
    let value: T | undefined;
    let error: unknown;
    try {
      value = await operation();
    } catch (caught) {
      error = caught;
    } finally {
      controller.abort();
      await renewal;
    }
    return { heartbeat, value, ...(error !== undefined ? { error } : {}) };
  }

  private reportCompletionDeferred(claim: ClaimedMigrationJob, errorCode: string): MigrationWorkerResult {
    safeLog(this.logger, logEvent(claim, "migration.completion_deferred", "completion_deferred", errorCode));
    return { status: "completion_deferred", jobId: claim.jobId };
  }

  private async scheduleReconciliation(
    claim: ClaimedMigrationJob,
    errorCode: string,
  ): Promise<MigrationWorkerResult> {
    const completedAt = this.now();
    const delay = this.retryBaseDelayMs * 2 ** Math.min(Math.max(claim.reconciliationAttempt, 0), 10);
    try {
      const result = await this.queue.deferForReconciliation({
        ...leaseIdentity(claim),
        errorCode,
        redactedMessage: "Migration outcome requires target-ledger reconciliation.",
        retryAt: new Date(completedAt.getTime() + delay).toISOString(),
        completedAt: completedAt.toISOString(),
      });
      if (result.status === "lease_lost") return this.leaseLost(claim);
      if (result.status === "already_terminal") {
        if (result.state === "applied") {
          safeLog(this.logger, logEvent(claim, "migration.applied", "already_applied"));
          return { status: "already_applied", jobId: claim.jobId };
        }
        if (result.state === "review_required") {
          safeLog(this.logger, logEvent(claim, "migration.review_required", "review_required", errorCode));
          return { status: "review_required", jobId: claim.jobId };
        }
        return this.reportCompletionDeferred(claim, "QUEUE_TERMINAL_CONFLICT");
      }
      const event = result.state === "review_required"
        ? "migration.review_required" as const
        : "migration.reconciliation_scheduled" as const;
      safeLog(this.logger, logEvent(claim, event, result.state, errorCode));
      return { status: result.state, jobId: claim.jobId };
    } catch {
      return this.reportCompletionDeferred(claim, "QUEUE_UPDATE_FAILED");
    }
  }

  private async finishApplied(
    claim: ClaimedMigrationJob,
    executorResult: "applied" | "already_applied",
  ): Promise<MigrationWorkerResult> {
    let completion: LeaseMutationResult;
    try {
      completion = await this.queue.markApplied({
        ...leaseIdentity(claim),
        statementSha256: claim.changeSet.statementSha256,
        executorResult,
        completedAt: this.now().toISOString(),
      });
    } catch {
      return this.scheduleReconciliation(claim, "QUEUE_APPLIED_UPDATE_FAILED");
    }
    if (completion.status === "lease_lost") return this.leaseLost(claim);
    if (completion.status === "already_terminal" && completion.state === "review_required") {
      safeLog(this.logger, logEvent(claim, "migration.review_required", "review_required", "QUEUE_TERMINAL_CONFLICT"));
      return { status: "review_required", jobId: claim.jobId };
    }
    if (completion.status === "already_terminal" && completion.state === "failed") {
      safeLog(this.logger, logEvent(claim, "migration.completion_deferred", "completion_deferred", "QUEUE_TERMINAL_CONFLICT"));
      return { status: "completion_deferred", jobId: claim.jobId };
    }
    const status = executorResult === "already_applied" ? "already_applied" : "applied";
    const reportedStatus = completion.status === "already_terminal" ? "already_applied" : status;
    safeLog(this.logger, logEvent(claim, "migration.applied", reportedStatus));
    return { status: reportedStatus, jobId: claim.jobId };
  }

  private finishExecutionFailure(claim: ClaimedMigrationJob, error: unknown): Promise<MigrationWorkerResult> {
    if (error instanceof ProjectDatabaseExecutionError &&
        (error.outcome === "rolled_back" || error.outcome === "not_started") &&
        error.retryable && claim.attempt < claim.maxAttempts) {
      const delay = this.retryBaseDelayMs * 2 ** Math.min(Math.max(claim.attempt - 1, 0), 10);
      return this.finishFailure(claim, {
        disposition: "retry",
        errorCode: error.code,
        redactedMessage: error.outcome === "rolled_back"
          ? "Migration execution rolled back and will be retried."
          : "Migration execution did not start and will be retried.",
        retryAt: new Date(this.now().getTime() + delay).toISOString(),
      });
    }
    if (!(error instanceof ProjectDatabaseExecutionError) || error.outcome === "unknown") {
      return this.scheduleReconciliation(claim, "MIGRATION_EXECUTION_OUTCOME_UNKNOWN");
    }
    const errorCode = error instanceof ProjectDatabaseExecutionError
      ? error.code
      : "MIGRATION_EXECUTION_OUTCOME_UNKNOWN";
    return this.finishFailure(claim, {
      disposition: "failed",
      errorCode,
      redactedMessage: errorCode === "MIGRATION_EXECUTION_OUTCOME_UNKNOWN"
        ? "Migration execution outcome is unknown; automatic retry is disabled."
        : "Migration execution failed.",
    });
  }

  private async finishFailure(
    claim: ClaimedMigrationJob,
    failure: Pick<FailMigrationInput, "disposition" | "errorCode" | "redactedMessage" | "retryAt">,
  ): Promise<MigrationWorkerResult> {
    let result: LeaseMutationResult;
    try {
      result = await this.queue.markFailed({
        ...leaseIdentity(claim),
        ...failure,
        completedAt: this.now().toISOString(),
      });
    } catch {
      return this.reportCompletionDeferred(claim, "QUEUE_UPDATE_FAILED");
    }
    if (result.status === "lease_lost") return this.leaseLost(claim);
    if (result.status === "already_terminal" && result.state === "applied") {
      safeLog(this.logger, logEvent(claim, "migration.applied", "already_applied"));
      return { status: "already_applied", jobId: claim.jobId };
    }
    if (result.status === "already_terminal" && result.state === "review_required") {
      safeLog(this.logger, logEvent(claim, "migration.review_required", "review_required", failure.errorCode));
      return { status: "review_required", jobId: claim.jobId };
    }
    const status = result.status === "already_terminal"
      ? "failed"
      : failure.disposition === "retry" ? "retry_scheduled" : "failed";
    safeLog(this.logger, logEvent(
      claim,
      failure.disposition === "retry" ? "migration.retry_scheduled" : "migration.failed",
      status,
      failure.errorCode,
    ));
    return { status, jobId: claim.jobId };
  }

  private leaseLost(claim: ClaimedMigrationJob): MigrationWorkerResult {
    safeLog(this.logger, logEvent(claim, "migration.lease_lost", "lease_lost"));
    return { status: "lease_lost", jobId: claim.jobId };
  }
}

function verifyArtifact(
  job: ClaimedMigrationJob,
  cipher: StatementCipher,
  now: Date,
  expectedWorkerId: string,
): string {
  const change = job.changeSet;
  const approval = job.approval;
  if (!isOpaqueDatabaseReference(job.databaseInstanceRef) ||
      !validAttempts(job) || !validFenceEpoch(job.fenceEpoch) || !validLease(job, now, expectedWorkerId) ||
      change.id !== approval.changeSetId || change.id === "" ||
      change.organizationId !== job.organizationId || approval.organizationId !== job.organizationId ||
      change.projectId !== job.projectId || approval.projectId !== job.projectId ||
      change.environment !== job.environment || approval.environment !== job.environment ||
      change.status !== "approved" || approval.status !== "approved" ||
      !Number.isFinite(Date.parse(approval.expiresAt)) ||
      Date.parse(approval.expiresAt) <= now.getTime()) {
    throw new MigrationArtifactError();
  }

  const plaintext = cipher.decrypt(change.encryptedStatement, {
    changeSetId: change.id,
    organizationId: change.organizationId,
    projectId: change.projectId,
    environment: change.environment,
    statementSha256: change.statementSha256,
  });
  const validation = validateSingleSqlStatement(plaintext);
  if (!validation.valid || !hashesMatch(sha256(plaintext), change.statementSha256) ||
      !hashesMatch(approval.actionHash, expectedActionHash(change, approval.expiresAt, job.databaseInstanceRef))) {
    throw new MigrationArtifactError(validation.valid ? "INVALID_MIGRATION_ARTIFACT" : "INVALID_MIGRATION_SQL");
  }
  return plaintext;
}

function validReconciliationClaim(
  job: ClaimedMigrationJob,
  now: Date,
  expectedWorkerId: string,
): boolean {
  const change = job.changeSet;
  const approval = job.approval;
  return isOpaqueDatabaseReference(job.databaseInstanceRef) &&
    validAttempts(job) && validReconciliationAttempts(job) &&
    validFenceEpoch(job.fenceEpoch) && validLease(job, now, expectedWorkerId) &&
    change.id !== "" && change.id === approval.changeSetId &&
    change.organizationId === job.organizationId && approval.organizationId === job.organizationId &&
    change.projectId === job.projectId && approval.projectId === job.projectId &&
    change.environment === job.environment && approval.environment === job.environment &&
    /^[a-f0-9]{64}$/i.test(change.statementSha256);
}

function expectedActionHash(change: ChangeSetRecord, expiresAt: string, databaseInstanceRef: string): string {
  return approvalActionHash({
    changeSetId: change.id,
    organizationId: change.organizationId,
    projectId: change.projectId,
    environment: change.environment,
    databaseInstanceRef,
    title: change.title,
    statementSha256: change.statementSha256,
    createdBy: change.createdBy,
    risk: change.risk,
    expiresAt,
    requiredScope: "approval:decide",
  });
}

function validAttempts(job: ClaimedMigrationJob): boolean {
  return Number.isInteger(job.attempt) && Number.isInteger(job.maxAttempts) &&
    job.attempt >= 1 && job.maxAttempts >= 1 && job.attempt <= job.maxAttempts;
}

function validReconciliationAttempts(job: ClaimedMigrationJob): boolean {
  if (!Number.isInteger(job.reconciliationAttempt) || !Number.isInteger(job.maxReconciliationAttempts) ||
      job.maxReconciliationAttempts < 1 || job.maxReconciliationAttempts > 20) return false;
  return job.reconciliationRequired
    ? job.reconciliationAttempt >= 1 && job.reconciliationAttempt <= job.maxReconciliationAttempts
    : job.reconciliationAttempt === 0;
}

function validFenceEpoch(value: string): boolean {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) return false;
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

function validLease(job: ClaimedMigrationJob, now: Date, expectedWorkerId: string): boolean {
  return job.lease.workerId === expectedWorkerId && job.lease.token.length > 0 && job.lease.token.length <= 500 &&
    Number.isFinite(Date.parse(job.lease.expiresAt)) && Date.parse(job.lease.expiresAt) > now.getTime();
}

function leaseIdentity(job: ClaimedMigrationJob) {
  return { jobId: job.jobId, workerId: job.lease.workerId, leaseToken: job.lease.token };
}

function logEvent(
  claim: ClaimedMigrationJob,
  event: MigrationWorkerLogEvent["event"],
  status: string,
  errorCode?: string,
): MigrationWorkerLogEvent {
  return {
    event,
    jobId: claim.jobId,
    changeSetId: claim.changeSet.id,
    attempt: claim.attempt,
    reconciliationAttempt: claim.reconciliationAttempt,
    status,
    ...(errorCode ? { errorCode } : {}),
  };
}

function safeLog(logger: MigrationWorkerLogger, event: MigrationWorkerLogEvent): void {
  try {
    logger.log(event);
  } catch {
    // Observability must not control migration execution or process liveness.
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (elapsed: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(elapsed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
