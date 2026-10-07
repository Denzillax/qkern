import type { AutomationMode, ChangeStatus, Environment, Risk } from "@/lib/types";

export type OrganizationRecord = {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRecord = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  region: string;
  status: "ready" | "provisioning" | "degraded";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Ein geloeschtes Projekt innerhalb seiner Frist (2.173). Mehr braucht die
 * Liste zum Zurueckholen nicht, und mehr soll sie nicht zeigen.
 */
export type DeletedProjectRecord = {
  id: string;
  name: string;
  slug: string;
  deletedAt: string;
  deleteAfter: string;
};

export type ProjectEnvironmentRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  databaseInstanceRef: string;
  createdAt: string;
};

export const PROJECT_DATABASE_PROVISIONING_ERROR_CODES = Object.freeze([
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_REJECTED",
  "INVALID_BINDING",
  "BOOTSTRAP_UNVERIFIED",
  "PROVISIONING_TIMEOUT",
] as const);
export type ProjectDatabaseProvisioningErrorCode =
  (typeof PROJECT_DATABASE_PROVISIONING_ERROR_CODES)[number];

export function isProjectDatabaseProvisioningErrorCode(
  value: unknown,
): value is ProjectDatabaseProvisioningErrorCode {
  return typeof value === "string" &&
    (PROJECT_DATABASE_PROVISIONING_ERROR_CODES as readonly string[]).includes(value);
}

export type ProjectDatabaseProvisioningJobRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  requestedBy: string;
  status: "pending" | "running" | "succeeded" | "failed";
  attemptCount: number;
  maxAttempts: number;
  retryCycleCount: number;
  maxRetryCycles: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: ProjectDatabaseProvisioningErrorCode | null;
  bindingId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDatabaseProvisioningStatusRecord = {
  jobId: string;
  status: ProjectDatabaseProvisioningJobRecord["status"];
  attemptCount: number;
  maxAttempts: number;
  retryCycleCount: number;
  maxRetryCycles: number;
  lastErrorCode: ProjectDatabaseProvisioningErrorCode | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDatabaseProvisioningHealthRecord = {
  totalCount: number;
  pendingCount: number;
  readyCount: number;
  scheduledCount: number;
  runningCount: number;
  overduePendingCount: number;
  expiredLeaseCount: number;
  succeededCount: number;
  failedCount: number;
  recoveryExhaustedCount: number;
  activeFailureCount: number;
  activeProviderUnavailableCount: number;
  activeProviderRejectedCount: number;
  activeInvalidBindingCount: number;
  activeBootstrapUnverifiedCount: number;
  activeProvisioningTimeoutCount: number;
  observedProvisionerCount: number;
  activeProvisionerCount: number;
  staleProvisionerCount: number;
  oldestPendingAt: string | null;
  latestFailedAt: string | null;
  latestHeartbeatAt: string | null;
  measuredAt: string;
};

/** Secret-free immutable output of the trusted infrastructure provisioner. */
export type ProjectDatabaseBindingRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  provisioningJobId: string;
  databaseInstanceRef: string;
  vaultStaticRole: string;
  host: string;
  port: number;
  expectedRole: string;
  expectedDatabase: string;
  expectedLedgerOwner: string;
  serverCertificateSha256: string;
  bootstrapContractSha256: string;
  createdAt: string;
};

export type ChangeSetRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  title: string;
  statementSha256: string;
  encryptedStatement: Uint8Array;
  risk: Risk;
  status: ChangeStatus;
  createdBy: string | null;
  agentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRequestRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  changeSetId: string;
  environment: Environment;
  actionHash: string;
  status: "pending" | "approved" | "rejected" | "expired";
  expiresAt: string;
  createdAt: string;
};

export type ApprovalDecisionRecord = {
  id: string;
  organizationId: string;
  approvalRequestId: string;
  decidedBy: string | null;
  actorType: "user" | "agent" | "system";
  actorRef: string;
  decision: "approved" | "rejected";
  createdAt: string;
};

export type ProjectAutomationPolicyRecord = {
  organizationId: string;
  projectId: string;
  environment: Environment;
  mode: AutomationMode;
  maxAutoRisk: Risk;
  autoQueue: boolean;
  emergencyStop: boolean;
  revision: number;
  updatedBy: string | null;
  updatedAt: string;
};

export type AuditLogRecord = {
  id: string;
  organizationId: string;
  projectId: string | null;
  environment: Environment | null;
  actorType: string;
  actorRef: string;
  action: string;
  resourceRef: string;
  status: string;
  redactedMetadata: Record<string, unknown>;
  previousHash: string | null;
  entryHash: string;
  createdAt: string;
};

export type MigrationJobStatus = "queued" | "running" | "applied" | "failed" | "review_required";

export type MigrationJobRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  databaseInstanceRef: string;
  changeSetId: string;
  approvalRequestId: string;
  /** Canonical PostgreSQL int8 decimal; strictly increases for every claim. */
  claimSequence: string;
  status: MigrationJobStatus;
  attemptCount: number;
  maxAttempts: number;
  /** True means this job may only inspect the target ledger; SQL execution is forbidden. */
  reconciliationRequired: boolean;
  reconciliationAttemptCount: number;
  maxReconciliationAttempts: number;
  /** Number of explicit operator-requested reconciliation cycles already consumed. */
  reviewCycleCount: number;
  maxReviewCycles: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MigrationReviewReasonCode = "dependency_recovered" | "manual_recheck" | "incident_recovery";
export type MigrationReviewCommandStatus = "pending" | "applied" | "rejected";

export type MigrationReviewCommandRecord = {
  id: string;
  organizationId: string;
  migrationJobId: string;
  requestedBy: string;
  reasonCode: MigrationReviewReasonCode;
  status: MigrationReviewCommandStatus;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MigrationIncidentStatus = "open" | "acknowledged" | "resolved";
export type MigrationIncidentAcknowledgementCode =
  | "investigation_started"
  | "external_dependency_engaged"
  | "runbook_in_progress";
export type MigrationIncidentResolutionCode = "target_ledger_match";
export type MigrationIncidentResolutionReasonCode = "target_ledger_recheck";
export type MigrationIncidentResolutionCommandStatus = "pending" | "applied" | "rejected";

export type MigrationIncidentRecord = {
  id: string;
  organizationId: string;
  migrationJobId: string;
  projectId: string;
  environment: Environment;
  changeSetId: string;
  kind: "migration_outcome_unresolved";
  severity: "critical";
  status: MigrationIncidentStatus;
  detectedReviewCycle: number;
  detectedReconciliationAttempt: number;
  acknowledgedBy: string | null;
  acknowledgementCode: MigrationIncidentAcknowledgementCode | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolutionCode: MigrationIncidentResolutionCode | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MigrationIncidentResolutionCommandRecord = {
  id: string;
  organizationId: string;
  migrationIncidentId: string;
  requestedBy: string;
  reasonCode: MigrationIncidentResolutionReasonCode;
  status: MigrationIncidentResolutionCommandStatus;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const MIGRATION_INCIDENT_DELIVERY_FAILURE_CODES = Object.freeze([
  "PUBLISH_FAILED",
  "INVALID_ACK",
  "SIGNING_KEY_UNAVAILABLE",
  "DELIVERY_TIMEOUT",
  "DESTINATION_REJECTED",
] as const);
export type MigrationIncidentDeliveryFailureCode =
  (typeof MIGRATION_INCIDENT_DELIVERY_FAILURE_CODES)[number];

export function isMigrationIncidentDeliveryFailureCode(
  value: unknown,
): value is MigrationIncidentDeliveryFailureCode {
  return typeof value === "string" &&
    (MIGRATION_INCIDENT_DELIVERY_FAILURE_CODES as readonly string[]).includes(value);
}
export const MIGRATION_INCIDENT_DELIVERY_RETRY_REASONS = Object.freeze([
  "destination_recovered",
  "credentials_rotated",
  "provider_incident_resolved",
] as const);
export type MigrationIncidentDeliveryRetryReason =
  (typeof MIGRATION_INCIDENT_DELIVERY_RETRY_REASONS)[number];

export function isMigrationIncidentDeliveryRetryReason(
  value: unknown,
): value is MigrationIncidentDeliveryRetryReason {
  return typeof value === "string" &&
    (MIGRATION_INCIDENT_DELIVERY_RETRY_REASONS as readonly string[]).includes(value);
}

export function isCompatibleIncidentDeliveryRetry(
  reasonCode: MigrationIncidentDeliveryRetryReason,
  failureCode: MigrationIncidentDeliveryFailureCode,
): boolean {
  if (failureCode === "SIGNING_KEY_UNAVAILABLE") return reasonCode === "credentials_rotated";
  if (failureCode === "DESTINATION_REJECTED") return true;
  return reasonCode === "destination_recovered" || reasonCode === "provider_incident_resolved";
}
export type MigrationIncidentDeliveryCommandStatus = "pending" | "applied" | "rejected";

export type MigrationIncidentDeliveryCommandRecord = {
  id: string;
  organizationId: string;
  migrationIncidentId: string;
  requestedBy: string;
  reasonCode: MigrationIncidentDeliveryRetryReason;
  expectedFailureCode: MigrationIncidentDeliveryFailureCode | null;
  expectedRetryCycle: number | null;
  status: MigrationIncidentDeliveryCommandStatus;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MigrationIncidentDeliveryRetryProcessingResult = {
  commandId: string;
  incidentId: string;
  eventId?: string;
  outcome: "applied" | "rejected";
  failureCode?: MigrationIncidentDeliveryFailureCode;
  expectedRetryCycle?: number;
  retryCycle?: number;
};

export type MigrationIncidentDeliveryStatusRecord = {
  migrationIncidentId: string;
  eventId: string;
  status: "pending" | "published" | "dead_lettered";
  attemptCount: number;
  failureCount: number;
  maxFailures: number;
  lastFailureCode: MigrationIncidentDeliveryFailureCode | null;
  deadLetteredAt: string | null;
  retryCycleCount: number;
  maxRetryCycles: number;
  availableAt: string;
  publishedAt: string | null;
  retryCommandPending: boolean;
};

export type MigrationIncidentDeliveryHealthRecord = {
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
  oldestPendingAt: string | null;
  oldestDeadLetteredAt: string | null;
  latestDeadLetteredAt: string | null;
  measuredAt: string;
};

export type MigrationIncidentOutboxRecord = {
  id: string;
  organizationId: string;
  migrationIncidentId: string;
  eventType: "migration.incident.opened";
  status: "pending" | "published" | "dead_lettered";
  attemptCount: number;
  failureCount: number;
  maxFailures: number;
  lastFailureCode: MigrationIncidentDeliveryFailureCode | null;
  deadLetteredAt: string | null;
  retryCycleCount: number;
  maxRetryCycles: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  migrationJobId: string;
  projectId: string;
  environment: Environment;
  changeSetId: string;
  incidentKind: "migration_outcome_unresolved";
  incidentSeverity: "critical";
  incidentCreatedAt: string;
};

export type MigrationOutboxRecord = {
  id: string;
  organizationId: string;
  migrationJobId: string;
  eventType: "migration.apply.requested";
  status: "pending" | "published" | "dead_lettered";
  attemptCount: number;
  failureCount: number;
  maxFailures: number;
  lastFailureCode: MigrationOutboxDeliveryFailureCode | null;
  deadLetteredAt: string | null;
  retryCycleCount: number;
  maxRetryCycles: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const MIGRATION_OUTBOX_DELIVERY_FAILURE_CODES = MIGRATION_INCIDENT_DELIVERY_FAILURE_CODES;
export type MigrationOutboxDeliveryFailureCode = MigrationIncidentDeliveryFailureCode;

export function isMigrationOutboxDeliveryFailureCode(
  value: unknown,
): value is MigrationOutboxDeliveryFailureCode {
  return isMigrationIncidentDeliveryFailureCode(value);
}

export const MIGRATION_OUTBOX_DELIVERY_RETRY_REASONS = MIGRATION_INCIDENT_DELIVERY_RETRY_REASONS;
export type MigrationOutboxDeliveryRetryReason = MigrationIncidentDeliveryRetryReason;

export function isMigrationOutboxDeliveryRetryReason(
  value: unknown,
): value is MigrationOutboxDeliveryRetryReason {
  return isMigrationIncidentDeliveryRetryReason(value);
}

export function isCompatibleMigrationOutboxDeliveryRetry(
  reasonCode: MigrationOutboxDeliveryRetryReason,
  failureCode: MigrationOutboxDeliveryFailureCode,
): boolean {
  return isCompatibleIncidentDeliveryRetry(reasonCode, failureCode);
}

export type MigrationOutboxDeliveryCommandRecord = {
  id: string;
  organizationId: string;
  migrationJobId: string;
  requestedBy: string;
  reasonCode: MigrationOutboxDeliveryRetryReason;
  expectedFailureCode: MigrationOutboxDeliveryFailureCode;
  expectedRetryCycle: number;
  status: "pending" | "applied" | "rejected";
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MigrationOutboxDeliveryRetryProcessingResult = {
  commandId: string;
  migrationJobId: string;
  eventId?: string;
  outcome: "applied" | "rejected";
  failureCode: MigrationOutboxDeliveryFailureCode;
  expectedRetryCycle: number;
  retryCycle?: number;
};

export type MigrationOutboxDeliveryHealthRecord = {
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
  oldestPendingAt: string | null;
  oldestDeadLetteredAt: string | null;
  latestDeadLetteredAt: string | null;
  measuredAt: string;
};

export type MigrationOutboxDeliveryStatusRecord = {
  migrationJobId: string;
  eventId: string;
  status: "pending" | "published" | "dead_lettered";
  attemptCount: number;
  failureCount: number;
  maxFailures: number;
  lastFailureCode: MigrationOutboxDeliveryFailureCode | null;
  deadLetteredAt: string | null;
  retryCycleCount: number;
  maxRetryCycles: number;
  availableAt: string;
  publishedAt: string | null;
  retryCommandPending: boolean;
};
