import { randomUUID } from "node:crypto";
import {
  InvalidRecordError,
  ProjectProvisioningNotReadyError,
  ResourceNotFoundError,
} from "@/lib/server/db/errors";
import type { ProjectDatabaseProvisioningHealthRecord } from "@/lib/server/db/models";
import type { ControlPlaneRepositories, PostgresControlPlane } from "@/lib/server/db/repositories";
import type { Environment } from "@/lib/types";
import type {
  ProjectDatabaseProvisioningHealth,
  ProjectDatabaseProvisioningService,
  ProjectDatabaseProvisioningStatus,
  RequestProjectDatabaseProvisioningResult,
} from "@/lib/server/provisioning/service";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

export class MemoryProjectDatabaseProvisioningService implements ProjectDatabaseProvisioningService {
  private readonly jobs = new Map<string, ProjectDatabaseProvisioningStatus>();

  async getHealth(): Promise<ProjectDatabaseProvisioningHealth> {
    const measuredAt = new Date().toISOString();
    const jobs = [...this.jobs.values()];
    const pending = jobs.filter((job) => job.status === "pending");
    const failed = jobs.filter((job) => job.status === "failed");
    const errorCount = (code: ProjectDatabaseProvisioningHealthRecordKey) =>
      jobs.filter((job) => job.status !== "succeeded" && job.lastErrorCode === code).length;
    return publicHealth({
      totalCount: jobs.length,
      pendingCount: pending.length,
      readyCount: pending.length,
      scheduledCount: 0,
      runningCount: jobs.filter((job) => job.status === "running").length,
      overduePendingCount: pending.filter(
        (job) => Date.parse(job.createdAt) <= Date.parse(measuredAt) - 300_000,
      ).length,
      expiredLeaseCount: 0,
      succeededCount: jobs.filter((job) => job.status === "succeeded").length,
      failedCount: failed.length,
      recoveryExhaustedCount: failed.filter(
        (job) => job.retryCycleCount >= job.maxRetryCycles,
      ).length,
      activeFailureCount: jobs.filter(
        (job) => job.status !== "succeeded" && job.lastErrorCode,
      ).length,
      activeProviderUnavailableCount: errorCount("PROVIDER_UNAVAILABLE"),
      activeProviderRejectedCount: errorCount("PROVIDER_REJECTED"),
      activeInvalidBindingCount: errorCount("INVALID_BINDING"),
      activeBootstrapUnverifiedCount: errorCount("BOOTSTRAP_UNVERIFIED"),
      activeProvisioningTimeoutCount: errorCount("PROVISIONING_TIMEOUT"),
      observedProvisionerCount: 0,
      activeProvisionerCount: 0,
      staleProvisionerCount: 0,
      oldestPendingAt: oldest(pending.map((job) => job.createdAt)),
      latestFailedAt: latest(failed.map((job) => job.updatedAt)),
      latestHeartbeatAt: null,
      measuredAt,
    });
  }

  async getStatus(
    context: Parameters<ProjectDatabaseProvisioningService["getStatus"]>[0],
    projectId: string,
    environment: Environment,
  ): Promise<ProjectDatabaseProvisioningStatus> {
    const status = this.jobs.get(key(context.organizationId, projectId, environment));
    if (!status) throw new ResourceNotFoundError("Project provisioning job");
    return { ...status };
  }

  async request(
    context: Parameters<ProjectDatabaseProvisioningService["request"]>[0],
    projectId: string,
    environment: Environment,
  ): Promise<RequestProjectDatabaseProvisioningResult> {
    const jobKey = key(context.organizationId, projectId, environment);
    const existing = this.jobs.get(jobKey);
    if (existing) return { ...existing, outcome: "already_requested" };
    const now = new Date().toISOString();
    const status: ProjectDatabaseProvisioningStatus = {
      projectId, environment, jobId: randomUUID(), status: "pending",
      attemptCount: 0, maxAttempts: 5, retryCycleCount: 0, maxRetryCycles: 3,
      createdAt: now, updatedAt: now,
    };
    this.jobs.set(jobKey, status);
    return { ...status, outcome: "requested" };
  }
}

export class PostgresProjectDatabaseProvisioningService implements ProjectDatabaseProvisioningService {
  constructor(private readonly database: TenantRepositoryProvider) {}

  async getHealth(
    context: Parameters<ProjectDatabaseProvisioningService["getHealth"]>[0],
  ): Promise<ProjectDatabaseProvisioningHealth> {
    return this.database.withTenant({
      organizationId: context.organizationId, actorRef: context.actor.ref, readOnly: true,
    }, async (repositories: ControlPlaneRepositories) =>
      publicHealth(await repositories.projectDatabaseProvisioning.health()));
  }

  async getStatus(
    context: Parameters<ProjectDatabaseProvisioningService["getStatus"]>[0],
    projectId: string,
    environment: Environment,
  ): Promise<ProjectDatabaseProvisioningStatus> {
    return this.database.withTenant({
      organizationId: context.organizationId, actorRef: context.actor.ref, readOnly: true,
    }, async (repositories: ControlPlaneRepositories) => {
      await repositories.projects.get(projectId);
      await repositories.environments.get(projectId, environment);
      return publicStatus(projectId, environment, await repositories.projectDatabaseProvisioning.status(
        projectId,
        environment,
      ));
    });
  }

  async request(
    context: Parameters<ProjectDatabaseProvisioningService["request"]>[0],
    projectId: string,
    environment: Environment,
  ): Promise<RequestProjectDatabaseProvisioningResult> {
    return this.database.withTenant({
      organizationId: context.organizationId, actorRef: context.actor.ref,
    }, async (repositories: ControlPlaneRepositories) => {
      const project = await repositories.projects.get(projectId);
      const target = await repositories.environments.get(projectId, environment);
      if (!target.databaseInstanceRef.startsWith("pending:")) throw new ProjectProvisioningNotReadyError();
      const result = await repositories.projectDatabaseProvisioning.request(projectId, environment);
      if (result.created) {
        await repositories.audit.append({
          projectId: project.id,
          environment,
          actorType: context.actor.type ?? "user",
          actorRef: context.actor.ref,
          action: "project.database.provisioning_requested",
          resourceRef: result.status.jobId,
          status: "pending",
          metadata: {
            environment,
            retryCycle: result.status.retryCycleCount,
          },
        });
      }
      return {
        ...publicStatus(projectId, environment, result.status),
        outcome: result.created
          ? result.status.retryCycleCount > 0 ? "retry_requested" : "requested"
          : "already_requested",
      };
    });
  }
}

function publicStatus(
  projectId: string,
  environment: Environment,
  status: Awaited<ReturnType<ControlPlaneRepositories["projectDatabaseProvisioning"]["status"]>>,
): ProjectDatabaseProvisioningStatus {
  if (status.maxAttempts !== 5 || status.attemptCount > status.maxAttempts || status.maxRetryCycles !== 3 ||
      status.retryCycleCount > status.maxRetryCycles) {
    throw new ProjectProvisioningNotReadyError();
  }
  return {
    projectId, environment, jobId: status.jobId, status: status.status,
    attemptCount: status.attemptCount, maxAttempts: status.maxAttempts,
    retryCycleCount: status.retryCycleCount, maxRetryCycles: status.maxRetryCycles,
    ...(status.lastErrorCode ? { lastErrorCode: status.lastErrorCode } : {}),
    createdAt: status.createdAt, updatedAt: status.updatedAt,
  };
}

function key(organizationId: string, projectId: string, environment: Environment): string {
  return `${organizationId}:${projectId}:${environment}`;
}

type ProjectDatabaseProvisioningHealthRecordKey =
  NonNullable<ProjectDatabaseProvisioningStatus["lastErrorCode"]>;

function publicHealth(
  health: ProjectDatabaseProvisioningHealthRecord,
): ProjectDatabaseProvisioningHealth {
  validateHealth(health);
  const activeWork = health.pendingCount + health.runningCount;
  return {
    status: health.recoveryExhaustedCount > 0 ||
        health.expiredLeaseCount > 0 ||
        health.activeInvalidBindingCount > 0 ||
        health.activeBootstrapUnverifiedCount > 0 ||
        (activeWork > 0 && health.activeProvisionerCount === 0)
      ? "critical"
      : health.failedCount > 0 ||
          health.overduePendingCount > 0 ||
          health.activeFailureCount > 0 ||
          health.staleProvisionerCount > 0
        ? "degraded"
        : "healthy",
    measuredAt: health.measuredAt,
    totalCount: health.totalCount,
    pendingCount: health.pendingCount,
    readyCount: health.readyCount,
    scheduledCount: health.scheduledCount,
    runningCount: health.runningCount,
    overduePendingCount: health.overduePendingCount,
    expiredLeaseCount: health.expiredLeaseCount,
    succeededCount: health.succeededCount,
    failedCount: health.failedCount,
    recoveryExhaustedCount: health.recoveryExhaustedCount,
    activeFailureCount: health.activeFailureCount,
    activeProviderUnavailableCount: health.activeProviderUnavailableCount,
    activeProviderRejectedCount: health.activeProviderRejectedCount,
    activeInvalidBindingCount: health.activeInvalidBindingCount,
    activeBootstrapUnverifiedCount: health.activeBootstrapUnverifiedCount,
    activeProvisioningTimeoutCount: health.activeProvisioningTimeoutCount,
    observedProvisionerCount: health.observedProvisionerCount,
    activeProvisionerCount: health.activeProvisionerCount,
    staleProvisionerCount: health.staleProvisionerCount,
    ...(health.oldestPendingAt ? { oldestPendingAt: health.oldestPendingAt } : {}),
    ...(health.latestFailedAt ? { latestFailedAt: health.latestFailedAt } : {}),
    ...(health.latestHeartbeatAt ? { latestHeartbeatAt: health.latestHeartbeatAt } : {}),
    policy: {
      overdueAfterSeconds: 300,
      heartbeatStaleAfterSeconds: 120,
      provisionerObservationWindowSeconds: 86_400,
      expiredLeasesAreCritical: true,
      exhaustedRecoveryIsCritical: true,
      activeWorkWithoutProvisionerIsCritical: true,
      bindingVerificationFailuresAreCritical: true,
    },
  };
}

function validateHealth(health: ProjectDatabaseProvisioningHealthRecord): void {
  const stateTotal = health.pendingCount + health.runningCount +
    health.succeededCount + health.failedCount;
  const failureTotal = health.activeProviderUnavailableCount +
    health.activeProviderRejectedCount + health.activeInvalidBindingCount +
    health.activeBootstrapUnverifiedCount + health.activeProvisioningTimeoutCount;
  if (stateTotal !== health.totalCount ||
      health.readyCount + health.scheduledCount !== health.pendingCount ||
      failureTotal !== health.activeFailureCount ||
      health.recoveryExhaustedCount > health.failedCount ||
      health.observedProvisionerCount !==
        health.activeProvisionerCount + health.staleProvisionerCount) {
    throw new InvalidRecordError("The project provisioning health projection is inconsistent.");
  }
}

function oldest(values: readonly string[]): string | null {
  return values.length === 0 ? null : [...values].sort()[0]!;
}

function latest(values: readonly string[]): string | null {
  return values.length === 0 ? null : [...values].sort().at(-1)!;
}
