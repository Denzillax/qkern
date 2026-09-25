import { recognisedByName } from "@/lib/server/errors/identity";
import type { ControlPlaneContext } from "@/lib/server/control-plane/model";
import type {
  MigrationOutboxDeliveryFailureCode,
  MigrationOutboxDeliveryRetryReason,
} from "@/lib/server/db/models";

export type MigrationApplyDeliveryStatus = {
  migrationJobId: string;
  eventId: string;
  status: "pending" | "published" | "dead_lettered";
  attemptCount: number;
  failureCount: number;
  maxFailures: number;
  lastFailureCode?: MigrationOutboxDeliveryFailureCode;
  deadLetteredAt?: string;
  retryCycleCount: number;
  maxRetryCycles: number;
  availableAt: string;
  publishedAt?: string;
  retryCommandPending: boolean;
};

export type MigrationApplyDeliveryHealth = {
  status: "healthy" | "degraded" | "critical";
  measuredAt: string;
  totalCount: number;
  pendingCount: number;
  readyCount: number;
  scheduledCount: number;
  inFlightCount: number;
  overduePendingCount: number;
  expiredLeaseCount: number;
  recoveryPendingCount: number;
  publishedCount: number;
  deadLetteredCount: number;
  recoveryExhaustedCount: number;
  pendingRetryCommandCount: number;
  activeFailureCount: number;
  activePublishFailedCount: number;
  activeInvalidAckCount: number;
  activeSigningKeyUnavailableCount: number;
  activeDeliveryTimeoutCount: number;
  activeDestinationRejectedCount: number;
  oldestPendingAt?: string;
  oldestDeadLetteredAt?: string;
  latestDeadLetteredAt?: string;
  policy: {
    overdueAfterSeconds: 300;
    deadLettersAreCritical: true;
    signingKeyFailuresAreCritical: true;
    activeDeliveryFailuresAreDegraded: true;
  };
};

export type RequestMigrationApplyDeliveryRetryResult = {
  outcome: "requested" | "already_requested";
  migrationJobId: string;
  commandId: string;
  expectedFailureCode: MigrationOutboxDeliveryFailureCode;
  expectedRetryCycle: number;
};

export class MigrationApplyDeliveryNotRetryableError extends Error {
  readonly code = "MIGRATION_APPLY_DELIVERY_NOT_RETRYABLE";
  constructor() {
    super("The migration apply delivery is not dead-lettered or its bounded retry cycles are exhausted.");
    this.name = "MigrationApplyDeliveryNotRetryableError";
  }
}
recognisedByName(MigrationApplyDeliveryNotRetryableError, "MigrationApplyDeliveryNotRetryableError");

export interface MigrationApplyDeliveryService {
  getStatus(context: ControlPlaneContext, migrationJobId: string): Promise<MigrationApplyDeliveryStatus>;
  getHealth(context: ControlPlaneContext): Promise<MigrationApplyDeliveryHealth>;
  requestRetry(
    context: ControlPlaneContext,
    input: {
      migrationJobId: string;
      reasonCode: MigrationOutboxDeliveryRetryReason;
      expectedFailureCode: MigrationOutboxDeliveryFailureCode;
      expectedRetryCycle: number;
    },
  ): Promise<RequestMigrationApplyDeliveryRetryResult>;
}
