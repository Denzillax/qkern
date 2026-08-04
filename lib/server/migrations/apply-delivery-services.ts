import { InvalidRecordError, MigrationNotReadyError, ResourceNotFoundError } from "@/lib/server/db/errors";
import type { MigrationOutboxDeliveryHealthRecord } from "@/lib/server/db/models";
import type { ControlPlaneRepositories, PostgresControlPlane } from "@/lib/server/db/repositories";
import {
  MigrationApplyDeliveryNotRetryableError,
  type MigrationApplyDeliveryHealth,
  type MigrationApplyDeliveryService,
  type MigrationApplyDeliveryStatus,
  type RequestMigrationApplyDeliveryRetryResult,
} from "@/lib/server/migrations/apply-delivery-service";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

export class MemoryMigrationApplyDeliveryService implements MigrationApplyDeliveryService {
  async getStatus(): Promise<MigrationApplyDeliveryStatus> {
    throw new ResourceNotFoundError("Migration delivery");
  }

  async getHealth(): Promise<MigrationApplyDeliveryHealth> {
    return healthResponse(emptyHealth());
  }

  async requestRetry(): Promise<RequestMigrationApplyDeliveryRetryResult> {
    throw new ResourceNotFoundError("Migration delivery");
  }
}

export class PostgresMigrationApplyDeliveryService implements MigrationApplyDeliveryService {
  constructor(private readonly database: TenantRepositoryProvider) {}

  async getStatus(
    context: Parameters<MigrationApplyDeliveryService["getStatus"]>[0],
    migrationJobId: string,
  ): Promise<MigrationApplyDeliveryStatus> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories: ControlPlaneRepositories) => {
      await repositories.migrationJobs.get(migrationJobId);
      const status = await repositories.migrationOutboxDeliveryVisibility.status(migrationJobId);
      return {
        migrationJobId: status.migrationJobId,
        eventId: status.eventId,
        status: status.status,
        attemptCount: status.attemptCount,
        failureCount: status.failureCount,
        maxFailures: status.maxFailures,
        ...(status.lastFailureCode ? { lastFailureCode: status.lastFailureCode } : {}),
        ...(status.deadLetteredAt ? { deadLetteredAt: status.deadLetteredAt } : {}),
        retryCycleCount: status.retryCycleCount,
        maxRetryCycles: status.maxRetryCycles,
        availableAt: status.availableAt,
        ...(status.publishedAt ? { publishedAt: status.publishedAt } : {}),
        retryCommandPending: status.retryCommandPending,
      };
    });
  }

  async getHealth(
    context: Parameters<MigrationApplyDeliveryService["getHealth"]>[0],
  ): Promise<MigrationApplyDeliveryHealth> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories: ControlPlaneRepositories) => {
      const health = await repositories.migrationOutboxDeliveryVisibility.health();
      validateHealth(health);
      return healthResponse(health);
    });
  }

  async requestRetry(
    context: Parameters<MigrationApplyDeliveryService["requestRetry"]>[0],
    input: Parameters<MigrationApplyDeliveryService["requestRetry"]>[1],
  ): Promise<RequestMigrationApplyDeliveryRetryResult> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories: ControlPlaneRepositories) => {
      const job = await repositories.migrationJobs.get(input.migrationJobId);
      let result;
      try {
        result = await repositories.migrationOutboxDeliveryCommands.enqueue(
          job.id,
          context.actor.ref,
          input.reasonCode,
          input.expectedFailureCode,
          input.expectedRetryCycle,
        );
        if (result.command.reasonCode !== input.reasonCode ||
            result.command.expectedFailureCode !== input.expectedFailureCode ||
            result.command.expectedRetryCycle !== input.expectedRetryCycle) {
          throw new MigrationNotReadyError();
        }
      } catch (error) {
        if (error instanceof MigrationNotReadyError) throw new MigrationApplyDeliveryNotRetryableError();
        throw error;
      }
      if (result.created) {
        await repositories.audit.append({
          projectId: job.projectId,
          environment: job.environment,
          actorType: context.actor.type ?? "user",
          actorRef: context.actor.ref,
          action: "migration.apply.delivery_retry_requested",
          resourceRef: result.command.id,
          status: "pending",
          metadata: {
            migrationJobId: job.id,
            changeSetId: job.changeSetId,
            reasonCode: result.command.reasonCode,
            expectedFailureCode: result.command.expectedFailureCode,
            expectedRetryCycle: result.command.expectedRetryCycle,
          },
        });
      }
      return {
        outcome: result.created ? "requested" : "already_requested",
        migrationJobId: job.id,
        commandId: result.command.id,
        expectedFailureCode: input.expectedFailureCode,
        expectedRetryCycle: input.expectedRetryCycle,
      };
    });
  }
}

function healthResponse(health: MigrationOutboxDeliveryHealthRecord): MigrationApplyDeliveryHealth {
  validateHealth(health);
  return {
    status: health.deadLetteredCount > 0 || health.activeSigningKeyUnavailableCount > 0
      ? "critical"
      : health.overduePendingCount > 0 || health.expiredLeaseCount > 0 || health.activeFailureCount > 0
        ? "degraded"
        : "healthy",
    measuredAt: health.measuredAt,
    totalCount: health.totalCount,
    pendingCount: health.pendingCount,
    readyCount: health.readyCount,
    scheduledCount: health.scheduledCount,
    inFlightCount: health.inFlightCount,
    overduePendingCount: health.overduePendingCount,
    expiredLeaseCount: health.expiredLeaseCount,
    recoveryPendingCount: health.recoveryPendingCount,
    publishedCount: health.publishedCount,
    deadLetteredCount: health.deadLetteredCount,
    recoveryExhaustedCount: health.recoveryExhaustedCount,
    pendingRetryCommandCount: health.pendingRetryCommandCount,
    activeFailureCount: health.activeFailureCount,
    activePublishFailedCount: health.activePublishFailedCount,
    activeInvalidAckCount: health.activeInvalidAckCount,
    activeSigningKeyUnavailableCount: health.activeSigningKeyUnavailableCount,
    activeDeliveryTimeoutCount: health.activeDeliveryTimeoutCount,
    activeDestinationRejectedCount: health.activeDestinationRejectedCount,
    ...(health.oldestPendingAt ? { oldestPendingAt: health.oldestPendingAt } : {}),
    ...(health.oldestDeadLetteredAt ? { oldestDeadLetteredAt: health.oldestDeadLetteredAt } : {}),
    ...(health.latestDeadLetteredAt ? { latestDeadLetteredAt: health.latestDeadLetteredAt } : {}),
    policy: {
      overdueAfterSeconds: 300,
      deadLettersAreCritical: true,
      signingKeyFailuresAreCritical: true,
      activeDeliveryFailuresAreDegraded: true,
    },
  };
}

function validateHealth(health: MigrationOutboxDeliveryHealthRecord): void {
  if (health.pendingCount + health.publishedCount + health.deadLetteredCount !== health.totalCount ||
      health.readyCount + health.scheduledCount + health.inFlightCount !== health.pendingCount ||
      health.recoveryPendingCount > health.pendingCount || health.recoveryExhaustedCount > health.deadLetteredCount ||
      health.pendingRetryCommandCount > health.deadLetteredCount ||
      health.activePublishFailedCount + health.activeInvalidAckCount +
        health.activeSigningKeyUnavailableCount + health.activeDeliveryTimeoutCount +
        health.activeDestinationRejectedCount !== health.activeFailureCount ||
      health.activeFailureCount > health.pendingCount + health.deadLetteredCount) {
    throw new InvalidRecordError("Migration apply delivery health is inconsistent.");
  }
}

function emptyHealth(): MigrationOutboxDeliveryHealthRecord {
  return {
    totalCount: 0, pendingCount: 0, readyCount: 0, scheduledCount: 0, inFlightCount: 0,
    overduePendingCount: 0, expiredLeaseCount: 0, recoveryPendingCount: 0,
    publishedCount: 0, deadLetteredCount: 0, recoveryExhaustedCount: 0,
    pendingRetryCommandCount: 0, activeFailureCount: 0, activePublishFailedCount: 0,
    activeInvalidAckCount: 0, activeSigningKeyUnavailableCount: 0,
    activeDeliveryTimeoutCount: 0, activeDestinationRejectedCount: 0,
    oldestPendingAt: null, oldestDeadLetteredAt: null, latestDeadLetteredAt: null,
    measuredAt: new Date().toISOString(),
  };
}
