import { approvalActionHash, hashesMatch } from "@/lib/server/control-plane/crypto";
import type { ControlPlaneRepositories } from "@/lib/server/db/repositories";
import {
  MigrationLeaseLostError,
  MigrationNotReadyError,
  ResourceNotFoundError,
} from "@/lib/server/db/errors";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { TenantContext } from "@/lib/server/db/transaction";
import type {
  ClaimedMigrationJob,
  EnqueueMigrationInput,
  EnqueueMigrationResult,
  LeaseMutationResult,
  MigrationJobStatus,
  ReconciliationDeferralResult,
} from "@/lib/server/migrations/model";
import type {
  ClaimMigrationInput,
  CompleteMigrationInput,
  DeferMigrationForReconciliationInput,
  FailMigrationInput,
  LeaseRenewalResult,
  MigrationQueuePort,
  RenewMigrationLeaseInput,
} from "@/lib/server/migrations/queue-port";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

function publicStatus(job: Awaited<ReturnType<ControlPlaneRepositories["migrationJobs"]["get"]>>): MigrationJobStatus {
  const state = job.status === "review_required"
    ? "review_required"
    : job.reconciliationRequired
      ? job.status === "running" ? "reconciling" : "reconciliation_scheduled"
      : job.status === "running"
        ? "claimed"
        : job.status === "queued" && job.attemptCount > 0
          ? "retry_scheduled"
          : job.status;
  return {
    jobId: job.id,
    organizationId: job.organizationId,
    projectId: job.projectId,
    environment: job.environment,
    changeSetId: job.changeSetId,
    state,
    attempt: job.attemptCount,
    maxAttempts: job.maxAttempts,
    reconciliationRequired: job.reconciliationRequired,
    reconciliationAttempt: job.reconciliationAttemptCount,
    maxReconciliationAttempts: job.maxReconciliationAttempts,
    ...(job.lastErrorCode ? { errorCode: job.lastErrorCode } : {}),
  };
}

export class PostgresMigrationQueue implements MigrationQueuePort {
  constructor(
    private readonly database: TenantRepositoryProvider,
    private readonly organizationId: string,
  ) {}

  private withTenant<T>(actorRef: string, operation: (repositories: ControlPlaneRepositories) => Promise<T>): Promise<T> {
    const context: TenantContext = { organizationId: this.organizationId, actorRef };
    return this.database.withTenant(context, operation);
  }

  async enqueue(input: EnqueueMigrationInput): Promise<EnqueueMigrationResult> {
    if (input.organizationId !== this.organizationId) return { status: "not_found" };
    return this.withTenant(input.requestedBy, async (repositories) => {
      let change;
      try {
        change = await repositories.changeSets.get(input.changeSetId);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) return { status: "not_found" } as const;
        throw error;
      }
      if (change.projectId !== input.projectId || change.environment !== input.environment) return { status: "not_found" };
      if (change.status === "applied") {
        const existing = await repositories.migrationJobs.getForChangeSet(change.id);
        return { status: "already_applied", jobId: existing?.id ?? change.id };
      }
      if (change.status !== "approved") return { status: "not_approved" };
      const [environment, approval] = await Promise.all([
        repositories.environments.get(change.projectId, change.environment),
        repositories.approvals.getForChangeSet(change.id),
      ]);
      if (environment.databaseInstanceRef.startsWith("pending:")) throw new MigrationNotReadyError();
      if (!approval || approval.status !== "approved" || approval.environment !== change.environment ||
          Date.parse(approval.expiresAt) <= Date.now() || !hashesMatch(approval.actionHash, approvalActionHash({
        changeSetId: change.id,
        organizationId: change.organizationId,
        projectId: change.projectId,
        environment: change.environment,
        databaseInstanceRef: environment.databaseInstanceRef,
        title: change.title,
        statementSha256: change.statementSha256,
        createdBy: change.createdBy,
        risk: change.risk,
        expiresAt: approval.expiresAt,
        requiredScope: "approval:decide",
      }))) throw new MigrationNotReadyError();
      const result = await repositories.migrationJobs.enqueueApproved(change.id, approval.id);
      if (result.created) {
        await repositories.audit.append({
          projectId: change.projectId,
          environment: change.environment,
          actorType: "user",
          actorRef: input.requestedBy,
          action: "migration.apply.queued",
          resourceRef: result.job.id,
          status: "pending",
          metadata: { changeSetId: change.id },
        });
      }
      if (result.job.status === "applied") return { status: "already_applied", jobId: result.job.id };
      return { status: result.created ? "queued" : "already_queued", jobId: result.job.id };
    });
  }

  async getStatus(input: { organizationId: string; projectId: string; changeSetId: string }): Promise<MigrationJobStatus | null> {
    if (input.organizationId !== this.organizationId) return null;
    return this.withTenant("migration-status", async (repositories) => {
      const job = await repositories.migrationJobs.getForChangeSet(input.changeSetId);
      return job && job.projectId === input.projectId ? publicStatus(job) : null;
    });
  }

  async claimNext(input: ClaimMigrationInput): Promise<ClaimedMigrationJob | null> {
    return this.withTenant(input.workerId, async (repositories) => {
      const resolutionCommands = await repositories.migrationIncidentResolutionCommands.processPending();
      for (const processed of resolutionCommands) {
        const incident = await repositories.migrationIncidents.get(processed.command.migrationIncidentId);
        const current = processed.job ?? await repositories.migrationJobs.get(incident.migrationJobId);
        await repositories.audit.append({
          projectId: current.projectId,
          environment: current.environment,
          actorType: "system",
          actorRef: input.workerId,
          action: processed.job
            ? "migration.incident.resolution_verification_scheduled"
            : "migration.incident.resolution_verification_rejected",
          resourceRef: processed.command.id,
          status: processed.job ? "pending" : "blocked",
          metadata: {
            migrationIncidentId: incident.id,
            migrationJobId: current.id,
            changeSetId: current.changeSetId,
            reasonCode: processed.command.reasonCode,
          },
        });
      }
      const reviewCommands = await repositories.migrationReviewCommands.processPending();
      for (const processed of reviewCommands) {
        const current = processed.job ?? await repositories.migrationJobs.get(processed.command.migrationJobId);
        await repositories.audit.append({
          projectId: current.projectId,
          environment: current.environment,
          actorType: "system",
          actorRef: input.workerId,
          action: processed.job
            ? "migration.review.reconciliation_scheduled"
            : "migration.review.reconciliation_rejected",
          resourceRef: processed.command.id,
          status: processed.job ? "pending" : "blocked",
          metadata: {
            migrationJobId: current.id,
            changeSetId: current.changeSetId,
            reasonCode: processed.command.reasonCode,
            reviewCycle: current.reviewCycleCount,
          },
        });
      }
      const quarantined = await repositories.migrationJobs.quarantineExpiredReconciliations();
      for (const exhausted of quarantined) {
        await repositories.audit.append({
          projectId: exhausted.projectId,
          environment: exhausted.environment,
          actorType: "system",
          actorRef: input.workerId,
          action: "migration.apply.review_required",
          resourceRef: exhausted.id,
          status: "blocked",
          metadata: {
            changeSetId: exhausted.changeSetId,
            errorCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
            reconciliationAttempt: exhausted.reconciliationAttemptCount,
          },
        });
      }
      const incidents = await repositories.migrationIncidents.escalateExhausted();
      for (const incident of incidents) {
        await repositories.audit.append({
          projectId: incident.projectId,
          environment: incident.environment,
          actorType: "system",
          actorRef: input.workerId,
          action: "migration.incident.opened",
          resourceRef: incident.id,
          status: "blocked",
          metadata: {
            migrationJobId: incident.migrationJobId,
            changeSetId: incident.changeSetId,
            kind: incident.kind,
            severity: incident.severity,
            detectedReviewCycle: incident.detectedReviewCycle,
            detectedReconciliationAttempt: incident.detectedReconciliationAttempt,
          },
        });
      }
      const job = await repositories.migrationJobs.claimNext(input.workerId, input.leaseDurationMs);
      if (!job) return null;
      try {
        const [changeSet, approval] = await Promise.all([
          repositories.changeSets.get(job.changeSetId),
          repositories.approvals.get(job.approvalRequestId),
        ]);
        if (!approval || approval.status !== "approved" || approval.environment !== job.environment ||
            !job.leaseOwner || !job.leaseToken || !job.leaseExpiresAt) throw new MigrationNotReadyError();
        return {
          jobId: job.id,
          organizationId: job.organizationId,
          projectId: job.projectId,
          environment: job.environment,
          databaseInstanceRef: job.databaseInstanceRef,
          reclaimed: job.reclaimed === true,
          changeSet,
          approval,
          attempt: job.attemptCount,
          maxAttempts: job.maxAttempts,
          reconciliationRequired: job.reconciliationRequired,
          reconciliationAttempt: job.reconciliationAttemptCount,
          maxReconciliationAttempts: job.maxReconciliationAttempts,
          fenceEpoch: job.claimSequence,
          lease: { workerId: job.leaseOwner, token: job.leaseToken, expiresAt: job.leaseExpiresAt },
        };
      } catch (error) {
        if (!(error instanceof ResourceNotFoundError) && !(error instanceof MigrationNotReadyError)) throw error;
        if (job.reclaimed === true || job.reconciliationRequired) {
          const deferred = await repositories.migrationJobs.deferForReconciliation({
            jobId: job.id,
            workerId: input.workerId,
            leaseToken: job.leaseToken ?? "invalid",
            errorCode: "MIGRATION_ARTIFACT_UNAVAILABLE",
            errorMessage: "Migration artifact validation failed.",
          });
          await repositories.audit.append({
            projectId: deferred.projectId,
            environment: deferred.environment,
            actorType: "system",
            actorRef: input.workerId,
            action: deferred.status === "review_required"
              ? "migration.apply.review_required"
              : "migration.apply.reconciliation_scheduled",
            resourceRef: deferred.id,
            status: "blocked",
            metadata: {
              changeSetId: deferred.changeSetId,
              errorCode: "MIGRATION_ARTIFACT_UNAVAILABLE",
              reconciliationAttempt: deferred.reconciliationAttemptCount,
            },
          });
          return null;
        }
        await repositories.migrationJobs.markFailed({
          jobId: job.id,
          workerId: input.workerId,
          leaseToken: job.leaseToken ?? "invalid",
          errorCode: "MIGRATION_ARTIFACT_UNAVAILABLE",
          errorMessage: "Migration artifact validation failed.",
          terminal: true,
        });
        return null;
      }
    });
  }

  async markApplied(input: CompleteMigrationInput): Promise<LeaseMutationResult> {
    return this.withTenant(input.workerId, async (repositories) => {
      const current = await repositories.migrationJobs.get(input.jobId);
      if (current.status === "applied" || current.status === "failed" || current.status === "review_required") {
        return { status: "already_terminal", state: current.status };
      }
      const change = await repositories.changeSets.get(current.changeSetId);
      if (!hashesMatch(change.statementSha256, input.statementSha256)) {
        throw new MigrationNotReadyError();
      }
      try {
        const applied = await repositories.migrationJobs.markApplied(current.id, input.workerId, input.leaseToken);
        const resolvedIncident = input.executorResult === "already_applied"
          ? await repositories.migrationIncidents.resolveAppliedJob(applied.id)
          : null;
        await repositories.audit.append({
          projectId: applied.projectId,
          environment: applied.environment,
          actorType: "system",
          actorRef: input.workerId,
          action: "migration.apply.completed",
          resourceRef: applied.id,
          status: "success",
          metadata: { changeSetId: applied.changeSetId, executorResult: input.executorResult },
        });
        if (resolvedIncident) {
          await repositories.audit.append({
            projectId: resolvedIncident.projectId,
            environment: resolvedIncident.environment,
            actorType: "system",
            actorRef: input.workerId,
            action: "migration.incident.resolved",
            resourceRef: resolvedIncident.id,
            status: "success",
            metadata: {
              migrationJobId: resolvedIncident.migrationJobId,
              changeSetId: resolvedIncident.changeSetId,
              resolutionCode: resolvedIncident.resolutionCode,
            },
          });
        }
        return { status: "updated" };
      } catch (error) {
        return this.resolveLeaseMutation(error, repositories, input.jobId);
      }
    });
  }

  async renewLease(input: RenewMigrationLeaseInput): Promise<LeaseRenewalResult> {
    return this.withTenant(input.workerId, async (repositories) => {
      try {
        const renewed = await repositories.migrationJobs.renewLease(
          input.jobId,
          input.workerId,
          input.leaseToken,
          input.leaseDurationMs,
        );
        if (!renewed.leaseExpiresAt) return { status: "lease_lost" };
        return { status: "updated", expiresAt: renewed.leaseExpiresAt };
      } catch (error) {
        if (error instanceof MigrationLeaseLostError) return { status: "lease_lost" };
        throw error;
      }
    });
  }

  async markFailed(input: FailMigrationInput): Promise<LeaseMutationResult> {
    return this.withTenant(input.workerId, async (repositories) => {
      const current = await repositories.migrationJobs.get(input.jobId);
      if (current.status === "applied" || current.status === "failed" || current.status === "review_required") {
        return { status: "already_terminal", state: current.status };
      }
      const retryAt = input.retryAt ? Date.parse(input.retryAt) : Number.NaN;
      const completedAt = Date.parse(input.completedAt);
      const backoffMs = input.disposition === "retry" && Number.isFinite(retryAt) && Number.isFinite(completedAt)
        ? Math.max(0, Math.min(86_400_000, retryAt - completedAt))
        : 0;
      try {
        const result = await repositories.migrationJobs.markFailed({
          jobId: input.jobId,
          workerId: input.workerId,
          leaseToken: input.leaseToken,
          errorCode: input.errorCode,
          errorMessage: input.redactedMessage,
          backoffMs,
          terminal: input.disposition === "failed",
        });
        await repositories.audit.append({
          projectId: result.projectId,
          environment: result.environment,
          actorType: "system",
          actorRef: input.workerId,
          action: result.status === "failed" ? "migration.apply.failed" : "migration.apply.retry_scheduled",
          resourceRef: result.id,
          status: "blocked",
          metadata: { changeSetId: result.changeSetId, errorCode: result.lastErrorCode ?? "MIGRATION_ERROR" },
        });
        return { status: "updated" };
      } catch (error) {
        return this.resolveLeaseMutation(error, repositories, input.jobId);
      }
    });
  }

  async deferForReconciliation(
    input: DeferMigrationForReconciliationInput,
  ): Promise<ReconciliationDeferralResult> {
    return this.withTenant(input.workerId, async (repositories) => {
      const current = await repositories.migrationJobs.get(input.jobId);
      if (current.status === "applied" || current.status === "failed" || current.status === "review_required") {
        return { status: "already_terminal", state: current.status };
      }
      const retryAt = Date.parse(input.retryAt);
      const completedAt = Date.parse(input.completedAt);
      const backoffMs = Number.isFinite(retryAt) && Number.isFinite(completedAt)
        ? Math.max(0, Math.min(86_400_000, retryAt - completedAt))
        : 0;
      try {
        const result = await repositories.migrationJobs.deferForReconciliation({
          jobId: input.jobId,
          workerId: input.workerId,
          leaseToken: input.leaseToken,
          errorCode: input.errorCode,
          errorMessage: input.redactedMessage,
          backoffMs,
        });
        const state = result.status === "review_required" ? "review_required" : "reconciliation_scheduled";
        await repositories.audit.append({
          projectId: result.projectId,
          environment: result.environment,
          actorType: "system",
          actorRef: input.workerId,
          action: state === "review_required"
            ? "migration.apply.review_required"
            : "migration.apply.reconciliation_scheduled",
          resourceRef: result.id,
          status: "blocked",
          metadata: {
            changeSetId: result.changeSetId,
            errorCode: result.lastErrorCode ?? "RECONCILIATION_REQUIRED",
            reconciliationAttempt: result.reconciliationAttemptCount,
          },
        });
        return { status: "updated", state };
      } catch (error) {
        return this.resolveReconciliationMutation(error, repositories, input.jobId);
      }
    });
  }

  private async resolveLeaseMutation(
    error: unknown,
    repositories: ControlPlaneRepositories,
    jobId: string,
  ): Promise<LeaseMutationResult> {
    if (!(error instanceof MigrationLeaseLostError)) throw error;
    const latest = await repositories.migrationJobs.get(jobId);
    if (latest.status === "applied" || latest.status === "failed" || latest.status === "review_required") {
      return { status: "already_terminal", state: latest.status };
    }
    return { status: "lease_lost" };
  }

  private async resolveReconciliationMutation(
    error: unknown,
    repositories: ControlPlaneRepositories,
    jobId: string,
  ): Promise<ReconciliationDeferralResult> {
    if (!(error instanceof MigrationLeaseLostError)) throw error;
    const latest = await repositories.migrationJobs.get(jobId);
    if (latest.status === "applied" || latest.status === "failed" || latest.status === "review_required") {
      return { status: "already_terminal", state: latest.status };
    }
    return { status: "lease_lost" };
  }
}
