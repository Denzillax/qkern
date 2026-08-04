import type {
  MigrationIncidentDeliveryFailureCode,
  MigrationIncidentDeliveryRetryProcessingResult,
  MigrationIncidentOutboxRecord,
} from "@/lib/server/db/models";
import type { ControlPlaneRepositories, PostgresControlPlane } from "@/lib/server/db/repositories";
import type { TenantContext } from "@/lib/server/db/transaction";
import type { MigrationIncidentOutboxLeasePort } from "@/lib/server/migrations/incident-outbox-publisher";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

/** Tenant-scoped adapter exposing only fenced incident-notification leases. */
export class PostgresMigrationIncidentOutboxLeasePort implements MigrationIncidentOutboxLeasePort {
  constructor(
    private readonly database: TenantRepositoryProvider,
    private readonly organizationId: string,
  ) {}

  private withTenant<T>(
    actorRef: string,
    operation: (repositories: ControlPlaneRepositories) => Promise<T>,
  ): Promise<T> {
    const context: TenantContext = { organizationId: this.organizationId, actorRef };
    return this.database.withTenant(context, operation);
  }

  claimNext(publisherId: string, leaseDurationMs?: number): Promise<MigrationIncidentOutboxRecord | null> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationIncidentOutbox.claimNext(publisherId, leaseDurationMs));
  }

  processRetryCommands(
    publisherId: string,
    limit?: number,
  ): Promise<MigrationIncidentDeliveryRetryProcessingResult[]> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationIncidentDeliveryCommands.processPending(limit));
  }

  markPublished(
    eventId: string,
    publisherId: string,
    leaseToken: string,
  ): Promise<MigrationIncidentOutboxRecord> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationIncidentOutbox.markPublished(eventId, publisherId, leaseToken));
  }

  recordFailure(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    failureCode: MigrationIncidentDeliveryFailureCode,
    backoffMs?: number,
  ): Promise<MigrationIncidentOutboxRecord> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationIncidentOutbox.recordFailure(
        eventId, publisherId, leaseToken, failureCode, backoffMs,
      ));
  }

  releaseWithBackoff(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    backoffMs?: number,
  ): Promise<MigrationIncidentOutboxRecord> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationIncidentOutbox.releaseWithBackoff(eventId, publisherId, leaseToken, backoffMs));
  }
}
