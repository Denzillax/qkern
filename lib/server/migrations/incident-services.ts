import { InvalidRecordError, MigrationNotReadyError, ResourceNotFoundError } from "@/lib/server/db/errors";
import type {
  MigrationIncidentDeliveryHealthRecord,
  MigrationIncidentDeliveryStatusRecord,
  MigrationIncidentRecord,
} from "@/lib/server/db/models";
import type { ControlPlaneRepositories, PostgresControlPlane } from "@/lib/server/db/repositories";
import type {
  AcknowledgeMigrationIncidentResult,
  MigrationIncidentItem,
  MigrationIncidentDeliveryHealth,
  MigrationIncidentService,
  RequestMigrationIncidentDeliveryRetryResult,
  RequestMigrationIncidentResolutionVerificationResult,
} from "@/lib/server/migrations/incident-service";
import {
  MigrationIncidentDeliveryNotRetryableError,
  MigrationIncidentResolutionNotVerifiableError,
} from "@/lib/server/migrations/incident-service";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

export class MemoryMigrationIncidentService implements MigrationIncidentService {
  async listIncidents(): Promise<MigrationIncidentItem[]> {
    return [];
  }

  async acknowledgeIncident(): Promise<AcknowledgeMigrationIncidentResult> {
    throw new ResourceNotFoundError("Migration incident");
  }

  async getDeliveryHealth(): Promise<MigrationIncidentDeliveryHealth> {
    return {
      status: "healthy",
      measuredAt: new Date().toISOString(),
      totalCount: 0,
      pendingCount: 0,
      readyCount: 0,
      scheduledCount: 0,
      inFlightCount: 0,
      overduePendingCount: 0,
      expiredLeaseCount: 0,
      recoveryPendingCount: 0,
      publishedCount: 0,
      deadLetteredCount: 0,
      recoveryExhaustedCount: 0,
      pendingRetryCommandCount: 0,
      activeFailureCount: 0,
      activePublishFailedCount: 0,
      activeInvalidAckCount: 0,
      activeSigningKeyUnavailableCount: 0,
      activeDeliveryTimeoutCount: 0,
      activeDestinationRejectedCount: 0,
      policy: {
        overdueAfterSeconds: 300,
        deadLettersAreCritical: true,
        signingKeyFailuresAreCritical: true,
        activeDeliveryFailuresAreDegraded: true,
      },
    };
  }

  async requestDeliveryRetry(): Promise<RequestMigrationIncidentDeliveryRetryResult> {
    throw new ResourceNotFoundError("Migration incident");
  }

  async requestResolutionVerification(): Promise<RequestMigrationIncidentResolutionVerificationResult> {
    throw new ResourceNotFoundError("Migration incident");
  }
}

export class PostgresMigrationIncidentService implements MigrationIncidentService {
  constructor(private readonly database: TenantRepositoryProvider) {}

  async listIncidents(
    context: Parameters<MigrationIncidentService["listIncidents"]>[0],
    input: Parameters<MigrationIncidentService["listIncidents"]>[1],
  ): Promise<MigrationIncidentItem[]> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories: ControlPlaneRepositories) => {
      const incidents = await repositories.migrationIncidents.list(input);
      const statuses = await repositories.migrationIncidentDeliveryVisibility
        .listStatuses(incidents.map((incident) => incident.id));
      const statusByIncident = new Map(statuses.map((status) => [status.migrationIncidentId, status]));
      return incidents.map((incident) => {
        const delivery = statusByIncident.get(incident.id);
        if (!delivery) throw new InvalidRecordError("Migration incident delivery state is missing.");
        return publicIncident(incident, delivery);
      });
    });
  }

  async getDeliveryHealth(
    context: Parameters<MigrationIncidentService["getDeliveryHealth"]>[0],
  ): Promise<MigrationIncidentDeliveryHealth> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
      readOnly: true,
    }, async (repositories: ControlPlaneRepositories) => {
      const health = await repositories.migrationIncidentDeliveryVisibility.health();
      validateHealthShape(health);
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
    });
  }

  async acknowledgeIncident(
    context: Parameters<MigrationIncidentService["acknowledgeIncident"]>[0],
    input: Parameters<MigrationIncidentService["acknowledgeIncident"]>[1],
  ): Promise<AcknowledgeMigrationIncidentResult> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories: ControlPlaneRepositories) => {
      const result = await repositories.migrationIncidents.acknowledge(
        input.incidentId,
        context.actor.ref,
        input.acknowledgementCode,
      );
      if (result.created) {
        await repositories.audit.append({
          projectId: result.incident.projectId,
          environment: result.incident.environment,
          actorType: context.actor.type ?? "user",
          actorRef: context.actor.ref,
          action: "migration.incident.acknowledged",
          resourceRef: result.incident.id,
          status: "acknowledged",
          metadata: {
            migrationJobId: result.incident.migrationJobId,
            changeSetId: result.incident.changeSetId,
            acknowledgementCode: result.incident.acknowledgementCode,
          },
        });
      }
      return {
        outcome: result.created ? "acknowledged" : "already_acknowledged",
        incidentId: result.incident.id,
      };
    });
  }

  async requestDeliveryRetry(
    context: Parameters<MigrationIncidentService["requestDeliveryRetry"]>[0],
    input: Parameters<MigrationIncidentService["requestDeliveryRetry"]>[1],
  ): Promise<RequestMigrationIncidentDeliveryRetryResult> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories: ControlPlaneRepositories) => {
      const incident = await repositories.migrationIncidents.get(input.incidentId);
      let result;
      try {
        result = await repositories.migrationIncidentDeliveryCommands.enqueue(
          incident.id,
          context.actor.ref,
          input.reasonCode,
          input.expectedFailureCode,
          input.expectedRetryCycle,
        );
        if (result.command.expectedFailureCode !== input.expectedFailureCode ||
            result.command.reasonCode !== input.reasonCode ||
            result.command.expectedRetryCycle !== input.expectedRetryCycle) {
          throw new MigrationNotReadyError();
        }
      } catch (error) {
        if (error instanceof MigrationNotReadyError) throw new MigrationIncidentDeliveryNotRetryableError();
        throw error;
      }
      if (result.created) {
        await repositories.audit.append({
          projectId: incident.projectId,
          environment: incident.environment,
          actorType: context.actor.type ?? "user",
          actorRef: context.actor.ref,
          action: "migration.incident.delivery_retry_requested",
          resourceRef: result.command.id,
          status: "pending",
          metadata: {
            migrationIncidentId: incident.id,
            migrationJobId: incident.migrationJobId,
            changeSetId: incident.changeSetId,
            reasonCode: result.command.reasonCode,
            expectedFailureCode: result.command.expectedFailureCode,
            expectedRetryCycle: result.command.expectedRetryCycle,
          },
        });
      }
      return {
        outcome: result.created ? "requested" : "already_requested",
        incidentId: incident.id,
        commandId: result.command.id,
        expectedFailureCode: input.expectedFailureCode,
        expectedRetryCycle: input.expectedRetryCycle,
      };
    });
  }

  async requestResolutionVerification(
    context: Parameters<MigrationIncidentService["requestResolutionVerification"]>[0],
    input: Parameters<MigrationIncidentService["requestResolutionVerification"]>[1],
  ): Promise<RequestMigrationIncidentResolutionVerificationResult> {
    return this.database.withTenant({
      organizationId: context.organizationId,
      actorRef: context.actor.ref,
    }, async (repositories: ControlPlaneRepositories) => {
      const incident = await repositories.migrationIncidents.get(input.incidentId);
      if (incident.status === "resolved") throw new MigrationIncidentResolutionNotVerifiableError();
      let result;
      try {
        result = await repositories.migrationIncidentResolutionCommands.enqueue(
          incident.id,
          context.actor.ref,
          input.reasonCode,
        );
      } catch (error) {
        if (error instanceof MigrationNotReadyError) {
          throw new MigrationIncidentResolutionNotVerifiableError();
        }
        throw error;
      }
      if (result.created) {
        await repositories.audit.append({
          projectId: incident.projectId,
          environment: incident.environment,
          actorType: context.actor.type ?? "user",
          actorRef: context.actor.ref,
          action: "migration.incident.resolution_verification_requested",
          resourceRef: result.command.id,
          status: "pending",
          metadata: {
            migrationIncidentId: incident.id,
            migrationJobId: incident.migrationJobId,
            changeSetId: incident.changeSetId,
            reasonCode: result.command.reasonCode,
          },
        });
      }
      return {
        outcome: result.created ? "requested" : "already_requested",
        incidentId: incident.id,
        commandId: result.command.id,
      };
    });
  }
}

function publicIncident(
  incident: MigrationIncidentRecord,
  delivery: MigrationIncidentDeliveryStatusRecord,
): MigrationIncidentItem {
  return {
    incidentId: incident.id,
    jobId: incident.migrationJobId,
    projectId: incident.projectId,
    environment: incident.environment,
    changeSetId: incident.changeSetId,
    kind: incident.kind,
    severity: incident.severity,
    status: incident.status,
    detectedReviewCycle: incident.detectedReviewCycle,
    detectedReconciliationAttempt: incident.detectedReconciliationAttempt,
    delivery: {
      eventId: delivery.eventId,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      failureCount: delivery.failureCount,
      maxFailures: delivery.maxFailures,
      ...(delivery.lastFailureCode ? { lastFailureCode: delivery.lastFailureCode } : {}),
      ...(delivery.deadLetteredAt ? { deadLetteredAt: delivery.deadLetteredAt } : {}),
      retryCycleCount: delivery.retryCycleCount,
      maxRetryCycles: delivery.maxRetryCycles,
      availableAt: delivery.availableAt,
      ...(delivery.publishedAt ? { publishedAt: delivery.publishedAt } : {}),
      retryCommandPending: delivery.retryCommandPending,
    },
    ...(incident.acknowledgementCode ? { acknowledgementCode: incident.acknowledgementCode } : {}),
    ...(incident.acknowledgedBy ? { acknowledgedBy: incident.acknowledgedBy } : {}),
    ...(incident.acknowledgedAt ? { acknowledgedAt: incident.acknowledgedAt } : {}),
    ...(incident.resolutionCode ? { resolutionCode: incident.resolutionCode } : {}),
    ...(incident.resolvedBy ? { resolvedBy: incident.resolvedBy } : {}),
    ...(incident.resolvedAt ? { resolvedAt: incident.resolvedAt } : {}),
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
  };
}

function validateHealthShape(health: MigrationIncidentDeliveryHealthRecord): void {
  if (health.totalCount !== health.pendingCount + health.publishedCount + health.deadLetteredCount ||
      health.pendingCount !== health.readyCount + health.scheduledCount + health.inFlightCount ||
      health.overduePendingCount > health.pendingCount ||
      health.expiredLeaseCount > health.pendingCount ||
      health.recoveryPendingCount > health.pendingCount ||
      health.recoveryExhaustedCount > health.deadLetteredCount ||
      health.pendingRetryCommandCount > health.deadLetteredCount ||
      health.activeFailureCount !== health.activePublishFailedCount + health.activeInvalidAckCount +
        health.activeSigningKeyUnavailableCount + health.activeDeliveryTimeoutCount +
        health.activeDestinationRejectedCount ||
      health.activeFailureCount > health.pendingCount + health.deadLetteredCount ||
      (health.pendingCount === 0) !== (health.oldestPendingAt === null) ||
      (health.deadLetteredCount === 0) !== (health.oldestDeadLetteredAt === null) ||
      (health.deadLetteredCount === 0) !== (health.latestDeadLetteredAt === null)) {
    throw new InvalidRecordError("Migration incident delivery health is inconsistent.");
  }
}
