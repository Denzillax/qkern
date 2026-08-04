import type {
  MigrationOutboxDeliveryFailureCode,
  MigrationOutboxDeliveryRetryProcessingResult,
  MigrationOutboxRecord,
} from "@/lib/server/db/models";
import type { ControlPlaneRepositories, PostgresControlPlane } from "@/lib/server/db/repositories";
import type { TenantContext } from "@/lib/server/db/transaction";
import type { MigrationOutboxLeasePort } from "@/lib/server/migrations/outbox-publisher";

type TenantRepositoryProvider = Pick<PostgresControlPlane, "withTenant">;

/** Tenant-scoped adapter that exposes only fenced outbox lease operations. */
export class PostgresMigrationOutboxLeasePort implements MigrationOutboxLeasePort {
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

  processRetryCommands(
    publisherId: string,
    limit?: number,
  ): Promise<MigrationOutboxDeliveryRetryProcessingResult[]> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationOutboxDeliveryCommands.processPending(limit));
  }

  claimNext(publisherId: string, leaseDurationMs?: number): Promise<MigrationOutboxRecord | null> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationOutbox.claimNext(publisherId, leaseDurationMs));
  }

  markPublished(eventId: string, publisherId: string, leaseToken: string): Promise<MigrationOutboxRecord> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationOutbox.markPublished(eventId, publisherId, leaseToken));
  }

  recordFailure(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    failureCode: MigrationOutboxDeliveryFailureCode,
    backoffMs?: number,
  ): Promise<MigrationOutboxRecord> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationOutbox.recordFailure(
        eventId,
        publisherId,
        leaseToken,
        failureCode,
        backoffMs,
      ));
  }

  releaseWithBackoff(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    backoffMs?: number,
  ): Promise<MigrationOutboxRecord> {
    return this.withTenant(publisherId, (repositories) =>
      repositories.migrationOutbox.releaseWithBackoff(eventId, publisherId, leaseToken, backoffMs));
  }
}
