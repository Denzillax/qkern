import type { ControlPlaneRepositories, PostgresControlPlane } from "@/lib/server/db/repositories";
import { ResourceNotFoundError } from "@/lib/server/db/errors";
import type { MigrationJobRecord } from "@/lib/server/db/models";
import type {
  MigrationReviewItem,
  MigrationReviewService,
  RequestMigrationReconciliationResult,
} from "@/lib/server/migrations/review-service";
import {
  MigrationReviewCyclesExhaustedError,
  MigrationReviewNotReadyError,
} from "@/lib/server/migrations/review-service";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

export class MemoryMigrationReviewService implements MigrationReviewService {
  async listReviews(): Promise<MigrationReviewItem[]> {
    return [];
  }

  async requestReconciliation(): Promise<RequestMigrationReconciliationResult> {
    throw new ResourceNotFoundError("Migration job");
  }
}

export class PostgresMigrationReviewService implements MigrationReviewService {
  constructor(private readonly database: TenantRepositoryProvider) {}

  async listReviews(
    context: Parameters<MigrationReviewService["listReviews"]>[0],
    input: Parameters<MigrationReviewService["listReviews"]>[1],
  ): Promise<MigrationReviewItem[]> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories: ControlPlaneRepositories) => {
      const jobs = await repositories.migrationJobs.list({
        projectId: input.projectId,
        status: "review_required",
        limit: input.limit,
      });
      return jobs.map(publicReview);
    });
  }

  async requestReconciliation(
    context: Parameters<MigrationReviewService["requestReconciliation"]>[0],
    input: Parameters<MigrationReviewService["requestReconciliation"]>[1],
  ): Promise<RequestMigrationReconciliationResult> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories: ControlPlaneRepositories) => {
      const job = await repositories.migrationJobs.get(input.jobId);
      if (job.status === "applied") return { outcome: "already_applied", jobId: job.id };
      if (job.reconciliationRequired && (job.status === "queued" || job.status === "running")) {
        return { outcome: "already_scheduled", jobId: job.id };
      }
      if (job.status !== "review_required" || !job.reconciliationRequired) {
        throw new MigrationReviewNotReadyError();
      }
      if (job.reviewCycleCount >= job.maxReviewCycles) throw new MigrationReviewCyclesExhaustedError();
      const result = await repositories.migrationReviewCommands.enqueue(
        job.id,
        context.actor.ref,
        input.reasonCode,
      );
      if (result.created) {
        await repositories.audit.append({
          projectId: job.projectId,
          environment: job.environment,
          actorType: context.actor.type ?? "user",
          actorRef: context.actor.ref,
          action: "migration.review.reconciliation_requested",
          resourceRef: result.command.id,
          status: "pending",
          metadata: {
            migrationJobId: job.id,
            changeSetId: job.changeSetId,
            reasonCode: result.command.reasonCode,
            nextReviewCycle: job.reviewCycleCount + 1,
          },
        });
      }
      return {
        outcome: result.created ? "requested" : "already_requested",
        jobId: job.id,
        commandId: result.command.id,
      };
    });
  }
}

function publicReview(job: MigrationJobRecord): MigrationReviewItem {
  if (job.status !== "review_required" || !job.finishedAt) throw new MigrationReviewNotReadyError();
  return {
    jobId: job.id,
    projectId: job.projectId,
    environment: job.environment,
    changeSetId: job.changeSetId,
    state: "review_required",
    reconciliationAttempt: job.reconciliationAttemptCount,
    maxReconciliationAttempts: job.maxReconciliationAttempts,
    reviewCycle: job.reviewCycleCount,
    maxReviewCycles: job.maxReviewCycles,
    ...(job.lastErrorCode ? { errorCode: job.lastErrorCode } : {}),
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
  };
}
