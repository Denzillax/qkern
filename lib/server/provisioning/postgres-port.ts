import type { PostgresControlPlane, ControlPlaneRepositories } from "@/lib/server/db/repositories";
import type {
  ProjectDatabaseProvisioningErrorCode,
  ProjectDatabaseProvisioningJobRecord,
} from "@/lib/server/db/models";
import type {
  ProjectDatabaseProvisioningClaim,
  ProjectDatabaseProvisioningPort,
  ProvisionedProjectDatabaseBinding,
} from "@/lib/server/provisioning/worker";

/** Tenant-scoped control-plane adapter used only through the provisioner database role. */
export class PostgresProjectDatabaseProvisioningPort implements ProjectDatabaseProvisioningPort {
  constructor(
    private readonly database: Pick<PostgresControlPlane, "withTenant">,
    private readonly organizationId: string,
  ) {}

  heartbeat(provisionerId: string): Promise<void> {
    return this.withProvisioner(provisionerId, (repositories) =>
      repositories.projectDatabaseProvisioning.heartbeat(provisionerId));
  }

  quarantineExpired(provisionerId: string): Promise<ProjectDatabaseProvisioningJobRecord[]> {
    return this.withProvisioner(provisionerId, async (repositories) => {
      const jobs = await repositories.projectDatabaseProvisioning.quarantineExpiredLeases();
      for (const job of jobs) {
        await repositories.projects.setProvisioningStatus(job.projectId, "degraded");
        await repositories.audit.append({
          projectId: job.projectId,
          environment: job.environment,
          actorType: "provisioner",
          actorRef: provisionerId,
          action: "project.database.provisioning_failed",
          resourceRef: job.id,
          status: "failed",
          metadata: { environment: job.environment, errorCode: "PROVIDER_UNAVAILABLE", attempt: job.attemptCount },
        });
      }
      return jobs;
    });
  }

  claimNext(provisionerId: string, leaseDurationMs?: number): Promise<ProjectDatabaseProvisioningClaim | null> {
    return this.withProvisioner(provisionerId, async (repositories) => {
      const job = await repositories.projectDatabaseProvisioning.claimNext(provisionerId, leaseDurationMs);
      if (!job) return null;
      const project = await repositories.projects.get(job.projectId);
      return { job, region: project.region };
    });
  }

  complete(
    claim: ProjectDatabaseProvisioningClaim,
    provisionerId: string,
    leaseToken: string,
    binding: ProvisionedProjectDatabaseBinding,
  ) {
    return this.withProvisioner(provisionerId, async (repositories) => {
      const completed = await repositories.projectDatabaseProvisioning.complete(
        claim.job,
        provisionerId,
        leaseToken,
        binding,
      );
      if (!await repositories.environments.hasPending(claim.job.projectId)) {
        await repositories.projects.setProvisioningStatus(claim.job.projectId, "ready");
      }
      await repositories.audit.append({
        projectId: claim.job.projectId,
        environment: claim.job.environment,
        actorType: "provisioner",
        actorRef: provisionerId,
        action: "project.database.provisioned",
        resourceRef: completed.binding.id,
        status: "succeeded",
        metadata: {
          environment: claim.job.environment,
          provisioningJobId: claim.job.id,
          bootstrapContractSha256: completed.binding.bootstrapContractSha256,
          attempt: completed.job.attemptCount,
        },
      });
      return completed;
    });
  }

  recordFailure(
    claim: ProjectDatabaseProvisioningClaim,
    provisionerId: string,
    leaseToken: string,
    errorCode: ProjectDatabaseProvisioningErrorCode,
    backoffMs?: number,
  ): Promise<ProjectDatabaseProvisioningJobRecord> {
    return this.withProvisioner(provisionerId, async (repositories) => {
      const job = await repositories.projectDatabaseProvisioning.recordFailure(
        claim.job.id,
        provisionerId,
        leaseToken,
        errorCode,
        backoffMs,
      );
      if (job.status === "failed") await repositories.projects.setProvisioningStatus(job.projectId, "degraded");
      await repositories.audit.append({
        projectId: job.projectId,
        environment: job.environment,
        actorType: "provisioner",
        actorRef: provisionerId,
        action: job.status === "failed"
          ? "project.database.provisioning_failed"
          : "project.database.provisioning_retry_scheduled",
        resourceRef: job.id,
        status: job.status,
        metadata: { environment: job.environment, errorCode, attempt: job.attemptCount },
      });
      return job;
    });
  }

  releaseAfterAbort(
    claim: ProjectDatabaseProvisioningClaim,
    provisionerId: string,
    leaseToken: string,
    backoffMs?: number,
  ): Promise<ProjectDatabaseProvisioningJobRecord> {
    return this.withProvisioner(provisionerId, (repositories) =>
      repositories.projectDatabaseProvisioning.releaseAfterAbort(
        claim.job.id,
        provisionerId,
        leaseToken,
        backoffMs,
      ));
  }

  private withProvisioner<T>(
    provisionerId: string,
    operation: (repositories: ControlPlaneRepositories) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant({
      organizationId: this.organizationId,
      actorRef: provisionerId,
      statementTimeoutMs: 20_000,
    }, operation);
  }
}
