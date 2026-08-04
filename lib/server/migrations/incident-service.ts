import type { ControlPlaneContext } from "@/lib/server/control-plane/model";
import type {
  MigrationIncidentAcknowledgementCode,
  MigrationIncidentDeliveryFailureCode,
  MigrationIncidentDeliveryRetryReason,
  MigrationIncidentResolutionCode,
  MigrationIncidentResolutionReasonCode,
  MigrationIncidentStatus,
} from "@/lib/server/db/models";
import type { Environment } from "@/lib/types";

export type MigrationIncidentItem = {
  incidentId: string;
  jobId: string;
  projectId: string;
  environment: Environment;
  changeSetId: string;
  kind: "migration_outcome_unresolved";
  severity: "critical";
  status: MigrationIncidentStatus;
  detectedReviewCycle: number;
  detectedReconciliationAttempt: number;
  delivery: {
    eventId: string;
    status: "pending" | "published" | "dead_lettered";
    attemptCount: number;
    failureCount: number;
    maxFailures: number;
    lastFailureCode?: MigrationIncidentDeliveryFailureCode;
    deadLetteredAt?: string;
    retryCycleCount: number;
    maxRetryCycles: number;
    availableAt: string;
    publishedAt?: string;
    retryCommandPending: boolean;
  };
  acknowledgementCode?: MigrationIncidentAcknowledgementCode;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolutionCode?: MigrationIncidentResolutionCode;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type MigrationIncidentDeliveryHealth = {
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

export type AcknowledgeMigrationIncidentResult = {
  outcome: "acknowledged" | "already_acknowledged";
  incidentId: string;
};

export type RequestMigrationIncidentDeliveryRetryResult = {
  outcome: "requested" | "already_requested";
  incidentId: string;
  commandId: string;
  expectedFailureCode: MigrationIncidentDeliveryFailureCode;
  expectedRetryCycle: number;
};

export type RequestMigrationIncidentResolutionVerificationResult = {
  outcome: "requested" | "already_requested";
  incidentId: string;
  commandId: string;
};

export class MigrationIncidentDeliveryNotRetryableError extends Error {
  readonly code = "MIGRATION_INCIDENT_DELIVERY_NOT_RETRYABLE";
  constructor() {
    super("The incident notification is not dead-lettered or its bounded retry cycles are exhausted.");
    this.name = "MigrationIncidentDeliveryNotRetryableError";
  }
}

export class MigrationIncidentResolutionNotVerifiableError extends Error {
  readonly code = "MIGRATION_INCIDENT_RESOLUTION_NOT_VERIFIABLE";
  constructor() {
    super("The incident is resolved, not ready for verification, or its bounded verification cycles are exhausted.");
    this.name = "MigrationIncidentResolutionNotVerifiableError";
  }
}

export interface MigrationIncidentService {
  listIncidents(
    context: ControlPlaneContext,
    input: { projectId?: string; status?: MigrationIncidentStatus; limit?: number },
  ): Promise<MigrationIncidentItem[]>;
  getDeliveryHealth(context: ControlPlaneContext): Promise<MigrationIncidentDeliveryHealth>;
  acknowledgeIncident(
    context: ControlPlaneContext,
    input: { incidentId: string; acknowledgementCode: MigrationIncidentAcknowledgementCode },
  ): Promise<AcknowledgeMigrationIncidentResult>;
  requestDeliveryRetry(
    context: ControlPlaneContext,
    input: {
      incidentId: string;
      reasonCode: MigrationIncidentDeliveryRetryReason;
      expectedFailureCode: MigrationIncidentDeliveryFailureCode;
      expectedRetryCycle: number;
    },
  ): Promise<RequestMigrationIncidentDeliveryRetryResult>;
  requestResolutionVerification(
    context: ControlPlaneContext,
    input: {
      incidentId: string;
      reasonCode: MigrationIncidentResolutionReasonCode;
    },
  ): Promise<RequestMigrationIncidentResolutionVerificationResult>;
}
