import { redactSensitive, redactSensitiveText } from "@/lib/security";
import {
  isCompatibleMigrationOutboxDeliveryRetry,
  isCompatibleIncidentDeliveryRetry,
  isMigrationIncidentDeliveryFailureCode,
  isMigrationIncidentDeliveryRetryReason,
  isMigrationOutboxDeliveryFailureCode,
  isMigrationOutboxDeliveryRetryReason,
  isProjectDatabaseProvisioningErrorCode,
} from "@/lib/server/db/models";
import type { AutomationMode, ChangeStatus, Environment, Risk } from "@/lib/types";
import {
  ApprovalAlreadyDecidedError,
  ApprovalExpiredError,
  InvalidRecordError,
  MigrationLeaseLostError,
  MigrationNotReadyError,
  ProjectProvisioningLeaseLostError,
  ProjectProvisioningNotReadyError,
  ResourceNotFoundError,
} from "@/lib/server/db/errors";
import type {
  ApprovalDecisionRecord,
  ApprovalRequestRecord,
  AuditLogRecord,
  ChangeSetRecord,
  MigrationIncidentAcknowledgementCode,
  MigrationIncidentDeliveryCommandRecord,
  MigrationIncidentDeliveryFailureCode,
  MigrationIncidentDeliveryHealthRecord,
  MigrationIncidentDeliveryRetryProcessingResult,
  MigrationIncidentDeliveryRetryReason,
  MigrationIncidentDeliveryStatusRecord,
  MigrationIncidentOutboxRecord,
  MigrationIncidentRecord,
  MigrationIncidentResolutionCode,
  MigrationIncidentResolutionCommandRecord,
  MigrationIncidentResolutionReasonCode,
  MigrationIncidentStatus,
  MigrationJobRecord,
  MigrationOutboxDeliveryCommandRecord,
  MigrationOutboxDeliveryFailureCode,
  MigrationOutboxDeliveryHealthRecord,
  MigrationOutboxDeliveryRetryProcessingResult,
  MigrationOutboxDeliveryRetryReason,
  MigrationOutboxDeliveryStatusRecord,
  MigrationOutboxRecord,
  MigrationReviewCommandRecord,
  MigrationReviewReasonCode,
  OrganizationRecord,
  ProjectRecord,
  ProjectEnvironmentRecord,
  ProjectDatabaseBindingRecord,
  ProjectDatabaseProvisioningErrorCode,
  ProjectDatabaseProvisioningHealthRecord,
  ProjectDatabaseProvisioningJobRecord,
  ProjectDatabaseProvisioningStatusRecord,
  ProjectAutomationPolicyRecord,
} from "@/lib/server/db/models";
import type { SqlPool } from "@/lib/server/db/sql";
import { assertTenantResourceId, type TenantContext, type TenantTransaction, withTenantTransaction } from "@/lib/server/db/transaction";

type DbRow = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new InvalidRecordError("The database returned an invalid timestamp.");
}

function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new InvalidRecordError("The database returned invalid encrypted data.");
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) throw new InvalidRecordError(`The database returned an invalid ${field}.`);
  return parsed;
}

function count(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InvalidRecordError(`The database returned an invalid ${field}.`);
  }
  return parsed;
}

function incidentDeliveryFailureCode(value: unknown): MigrationIncidentDeliveryFailureCode | null {
  if (value === null || value === undefined) return null;
  if (!isMigrationIncidentDeliveryFailureCode(value)) {
    throw new InvalidRecordError("The database returned an invalid incident delivery failure code.");
  }
  return value;
}

function incidentDeliveryRetryReason(value: unknown): MigrationIncidentDeliveryRetryReason {
  if (!isMigrationIncidentDeliveryRetryReason(value)) {
    throw new InvalidRecordError("The database returned an invalid incident delivery retry reason.");
  }
  return value;
}

function migrationOutboxDeliveryFailureCode(value: unknown): MigrationOutboxDeliveryFailureCode | null {
  if (value === null || value === undefined) return null;
  if (!isMigrationOutboxDeliveryFailureCode(value)) {
    throw new InvalidRecordError("The database returned an invalid migration delivery failure code.");
  }
  return value;
}

function migrationOutboxDeliveryRetryReason(value: unknown): MigrationOutboxDeliveryRetryReason {
  if (!isMigrationOutboxDeliveryRetryReason(value)) {
    throw new InvalidRecordError("The database returned an invalid migration delivery retry reason.");
  }
  return value;
}

function incidentResolutionCode(value: unknown): MigrationIncidentResolutionCode | null {
  if (value === null || value === undefined) return null;
  if (value !== "target_ledger_match") {
    throw new InvalidRecordError("The database returned an invalid incident resolution code.");
  }
  return value;
}

function incidentStatus(value: unknown): MigrationIncidentStatus {
  if (value !== "open" && value !== "acknowledged" && value !== "resolved") {
    throw new InvalidRecordError("The database returned an invalid migration incident status.");
  }
  return value;
}

function incidentAcknowledgementCode(value: unknown): MigrationIncidentAcknowledgementCode | null {
  if (value === null || value === undefined) return null;
  if (value !== "investigation_started" && value !== "external_dependency_engaged" &&
      value !== "runbook_in_progress") {
    throw new InvalidRecordError("The database returned an invalid incident acknowledgement code.");
  }
  return value;
}

function postgresInt8(value: unknown, field: string): string {
  const canonical = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^(0|[1-9][0-9]{0,18})$/.test(canonical) || BigInt(canonical) > 9_223_372_036_854_775_807n) {
    throw new InvalidRecordError(`The database returned an invalid ${field}.`);
  }
  return canonical;
}

function organizationFromRow(row: DbRow): OrganizationRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function projectFromRow(row: DbRow): ProjectRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    slug: String(row.slug),
    region: String(row.region),
    status: row.status as ProjectRecord["status"],
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function projectEnvironmentFromRow(row: DbRow): ProjectEnvironmentRecord {
  return {
    id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: row.environment as Environment, databaseInstanceRef: String(row.database_instance_ref), createdAt: iso(row.created_at),
  };
}

function projectProvisioningErrorCode(value: unknown): ProjectDatabaseProvisioningErrorCode | null {
  if (value === null || value === undefined) return null;
  if (!isProjectDatabaseProvisioningErrorCode(value)) {
    throw new InvalidRecordError("The database returned an invalid project provisioning error code.");
  }
  return value;
}

function projectProvisioningStatus(value: unknown): ProjectDatabaseProvisioningJobRecord["status"] {
  if (value !== "pending" && value !== "running" && value !== "succeeded" && value !== "failed") {
    throw new InvalidRecordError("The database returned an invalid project provisioning status.");
  }
  return value;
}

function projectDatabaseProvisioningJobFromRow(row: DbRow): ProjectDatabaseProvisioningJobRecord {
  const record: ProjectDatabaseProvisioningJobRecord = {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: row.environment as Environment,
    requestedBy: String(row.requested_by),
    status: projectProvisioningStatus(row.status),
    attemptCount: count(row.attempt_count, "project provisioning attempt count"),
    maxAttempts: count(row.max_attempts, "project provisioning maximum attempt count"),
    retryCycleCount: count(row.retry_cycle_count, "project provisioning retry cycle count"),
    maxRetryCycles: count(row.max_retry_cycles, "project provisioning maximum retry cycles"),
    availableAt: iso(row.available_at),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    lastErrorCode: projectProvisioningErrorCode(row.last_error_code),
    bindingId: row.binding_id ? String(row.binding_id) : null,
    startedAt: nullableIso(row.started_at),
    finishedAt: nullableIso(row.finished_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  const unleased = record.leaseOwner === null && record.leaseToken === null && record.leaseExpiresAt === null;
  const leased = record.leaseOwner !== null && record.leaseToken !== null && record.leaseExpiresAt !== null;
  if (record.maxAttempts !== 5 || record.attemptCount > record.maxAttempts || record.maxRetryCycles !== 3 ||
      record.retryCycleCount > record.maxRetryCycles ||
      (record.status === "pending" && (!unleased || record.finishedAt !== null || record.bindingId !== null)) ||
      (record.status === "running" && (!leased || record.startedAt === null || record.finishedAt !== null || record.bindingId !== null)) ||
      (record.status === "succeeded" && (!unleased || record.finishedAt === null || record.bindingId === null || record.lastErrorCode !== null)) ||
      (record.status === "failed" && (!unleased || record.finishedAt === null || record.bindingId !== null ||
        record.lastErrorCode === null || record.attemptCount !== record.maxAttempts))) {
    throw new InvalidRecordError("The database returned an inconsistent project provisioning job.");
  }
  return record;
}

function projectProvisioningStatusFromRow(row: DbRow): ProjectDatabaseProvisioningStatusRecord {
  return {
    jobId: String(row.job_id),
    status: projectProvisioningStatus(row.job_status),
    attemptCount: count(row.attempt_count, "project provisioning attempt count"),
    maxAttempts: count(row.max_attempts, "project provisioning maximum attempt count"),
    retryCycleCount: count(row.retry_cycle_count, "project provisioning retry cycle count"),
    maxRetryCycles: count(row.max_retry_cycles, "project provisioning maximum retry cycles"),
    lastErrorCode: projectProvisioningErrorCode(row.last_error_code),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function projectProvisioningHealthFromRow(row: DbRow): ProjectDatabaseProvisioningHealthRecord {
  return {
    totalCount: count(row.total_count, "project provisioning total count"),
    pendingCount: count(row.pending_count, "project provisioning pending count"),
    readyCount: count(row.ready_count, "project provisioning ready count"),
    scheduledCount: count(row.scheduled_count, "project provisioning scheduled count"),
    runningCount: count(row.running_count, "project provisioning running count"),
    overduePendingCount: count(row.overdue_pending_count, "project provisioning overdue count"),
    expiredLeaseCount: count(row.expired_lease_count, "project provisioning expired lease count"),
    succeededCount: count(row.succeeded_count, "project provisioning succeeded count"),
    failedCount: count(row.failed_count, "project provisioning failed count"),
    recoveryExhaustedCount: count(
      row.recovery_exhausted_count,
      "project provisioning exhausted recovery count",
    ),
    activeFailureCount: count(row.active_failure_count, "project provisioning active failure count"),
    activeProviderUnavailableCount: count(
      row.active_provider_unavailable_count,
      "project provisioning provider unavailable count",
    ),
    activeProviderRejectedCount: count(
      row.active_provider_rejected_count,
      "project provisioning provider rejected count",
    ),
    activeInvalidBindingCount: count(
      row.active_invalid_binding_count,
      "project provisioning invalid binding count",
    ),
    activeBootstrapUnverifiedCount: count(
      row.active_bootstrap_unverified_count,
      "project provisioning bootstrap verification count",
    ),
    activeProvisioningTimeoutCount: count(
      row.active_provisioning_timeout_count,
      "project provisioning timeout count",
    ),
    observedProvisionerCount: count(
      row.observed_provisioner_count,
      "project provisioning observed provisioner count",
    ),
    activeProvisionerCount: count(
      row.active_provisioner_count,
      "project provisioning active provisioner count",
    ),
    staleProvisionerCount: count(
      row.stale_provisioner_count,
      "project provisioning stale provisioner count",
    ),
    oldestPendingAt: nullableIso(row.oldest_pending_at),
    latestFailedAt: nullableIso(row.latest_failed_at),
    latestHeartbeatAt: nullableIso(row.latest_heartbeat_at),
    measuredAt: iso(row.measured_at),
  };
}

function projectDatabaseBindingFromRow(row: DbRow): ProjectDatabaseBindingRecord {
  const record: ProjectDatabaseBindingRecord = {
    id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: row.environment as Environment, provisioningJobId: String(row.provisioning_job_id),
    databaseInstanceRef: String(row.database_instance_ref), vaultStaticRole: String(row.vault_static_role),
    host: String(row.host), port: integer(row.port, "project database port"),
    expectedRole: String(row.expected_role), expectedDatabase: String(row.expected_database),
    expectedLedgerOwner: String(row.expected_ledger_owner),
    serverCertificateSha256: String(row.server_certificate_sha256),
    bootstrapContractSha256: String(row.bootstrap_contract_sha256), createdAt: iso(row.created_at),
  };
  if (!/^managed:[a-z0-9][a-z0-9._:-]{0,119}$/.test(record.databaseInstanceRef) ||
      !/^[a-f0-9]{64}$/.test(record.serverCertificateSha256) ||
      !/^[a-f0-9]{64}$/.test(record.bootstrapContractSha256) ||
      record.port < 1 || record.port > 65_535) {
    throw new InvalidRecordError("The database returned an invalid project database binding.");
  }
  return record;
}

function changeSetFromRow(row: DbRow): ChangeSetRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: row.environment as Environment,
    title: String(row.title),
    statementSha256: String(row.statement_sha256),
    encryptedStatement: bytes(row.encrypted_statement),
    risk: row.risk as Risk,
    status: row.status as ChangeStatus,
    createdBy: row.created_by ? String(row.created_by) : null,
    agentSessionId: row.agent_session_id ? String(row.agent_session_id) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function approvalFromRow(row: DbRow): ApprovalRequestRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    changeSetId: String(row.change_set_id),
    environment: row.environment as Environment,
    actionHash: String(row.action_hash),
    status: row.status as ApprovalRequestRecord["status"],
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
  };
}

function decisionFromRow(row: DbRow): ApprovalDecisionRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    approvalRequestId: String(row.approval_request_id),
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    actorType: (row.actor_type ?? "user") as ApprovalDecisionRecord["actorType"],
    actorRef: String(row.actor_ref ?? row.decided_by),
    decision: row.decision as ApprovalDecisionRecord["decision"],
    createdAt: iso(row.created_at),
  };
}

function automationPolicyFromRow(row: DbRow): ProjectAutomationPolicyRecord {
  const mode = row.mode as AutomationMode;
  const maxAutoRisk = row.max_auto_risk as Risk;
  const revision = count(row.revision, "automation policy revision");
  if (!["manual", "guarded", "autonomous"].includes(mode) ||
      !["low", "medium", "high", "critical"].includes(maxAutoRisk) || revision < 1) {
    throw new InvalidRecordError("The database returned an invalid automation policy.");
  }
  return {
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: row.environment as Environment,
    mode,
    maxAutoRisk,
    autoQueue: row.auto_queue === true,
    emergencyStop: row.emergency_stop === true,
    revision,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: iso(row.updated_at),
  };
}

function auditFromRow(row: DbRow): AuditLogRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: row.project_id ? String(row.project_id) : null,
    environment: row.environment ? row.environment as Environment : null,
    actorType: String(row.actor_type),
    actorRef: String(row.actor_ref),
    action: String(row.action),
    resourceRef: String(row.resource_ref),
    status: String(row.status),
    redactedMetadata: object(row.redacted_metadata),
    previousHash: row.previous_hash ? String(row.previous_hash) : null,
    entryHash: String(row.entry_hash),
    createdAt: iso(row.created_at),
  };
}

function migrationJobFromRow(row: DbRow): MigrationJobRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: row.environment as Environment,
    databaseInstanceRef: String(row.database_instance_ref),
    changeSetId: String(row.change_set_id),
    approvalRequestId: String(row.approval_request_id),
    claimSequence: postgresInt8(row.claim_sequence, "claim sequence"),
    status: row.status as MigrationJobRecord["status"],
    attemptCount: integer(row.attempt_count, "attempt count"),
    maxAttempts: integer(row.max_attempts, "maximum attempt count"),
    reconciliationRequired: row.reconciliation_required === true,
    reconciliationAttemptCount: integer(row.reconciliation_attempt_count, "reconciliation attempt count"),
    maxReconciliationAttempts: integer(row.max_reconciliation_attempts, "maximum reconciliation attempt count"),
    reviewCycleCount: integer(row.review_cycle_count, "review cycle count"),
    maxReviewCycles: integer(row.max_review_cycles, "maximum review cycle count"),
    availableAt: iso(row.available_at),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
    startedAt: nullableIso(row.started_at),
    finishedAt: nullableIso(row.finished_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function migrationReviewCommandFromRow(row: DbRow): MigrationReviewCommandRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    migrationJobId: String(row.migration_job_id),
    requestedBy: String(row.requested_by),
    reasonCode: row.reason_code as MigrationReviewCommandRecord["reasonCode"],
    status: row.status as MigrationReviewCommandRecord["status"],
    processedAt: nullableIso(row.processed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function migrationIncidentResolutionCommandFromRow(row: DbRow): MigrationIncidentResolutionCommandRecord {
  if (row.reason_code !== "target_ledger_recheck") {
    throw new InvalidRecordError("The database returned an invalid incident resolution reason.");
  }
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    migrationIncidentId: String(row.migration_incident_id),
    requestedBy: String(row.requested_by),
    reasonCode: row.reason_code,
    status: row.status as MigrationIncidentResolutionCommandRecord["status"],
    processedAt: nullableIso(row.processed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function migrationIncidentFromRow(row: DbRow): MigrationIncidentRecord {
  const status = incidentStatus(row.status);
  const acknowledgedBy = row.acknowledged_by ? String(row.acknowledged_by) : null;
  const acknowledgementCode = incidentAcknowledgementCode(row.acknowledgement_code);
  const acknowledgedAt = nullableIso(row.acknowledged_at);
  const resolvedBy = row.resolved_by ? String(row.resolved_by) : null;
  const resolutionCode = incidentResolutionCode(row.resolution_code);
  const resolvedAt = nullableIso(row.resolved_at);
  const acknowledgementComplete = acknowledgedBy !== null && acknowledgementCode !== null && acknowledgedAt !== null;
  const acknowledgementEmpty = acknowledgedBy === null && acknowledgementCode === null && acknowledgedAt === null;
  const resolutionComplete = resolvedBy !== null && resolutionCode === "target_ledger_match" && resolvedAt !== null;
  const resolutionEmpty = resolvedBy === null && resolutionCode === null && resolvedAt === null;
  if ((status === "open" && (!acknowledgementEmpty || !resolutionEmpty)) ||
      (status === "acknowledged" && (!acknowledgementComplete || !resolutionEmpty)) ||
      (status === "resolved" && (!(acknowledgementEmpty || acknowledgementComplete) || !resolutionComplete))) {
    throw new InvalidRecordError("The database returned an inconsistent migration incident state.");
  }
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    migrationJobId: String(row.migration_job_id),
    projectId: String(row.project_id),
    environment: row.environment as Environment,
    changeSetId: String(row.change_set_id),
    kind: row.kind as MigrationIncidentRecord["kind"],
    severity: row.severity as MigrationIncidentRecord["severity"],
    status,
    detectedReviewCycle: integer(row.detected_review_cycle, "detected review cycle"),
    detectedReconciliationAttempt: integer(row.detected_reconciliation_attempt, "detected reconciliation attempt"),
    acknowledgedBy,
    acknowledgementCode,
    acknowledgedAt,
    resolvedBy,
    resolutionCode,
    resolvedAt,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function migrationIncidentOutboxFromRow(row: DbRow): MigrationIncidentOutboxRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    migrationIncidentId: String(row.migration_incident_id),
    eventType: row.event_type as MigrationIncidentOutboxRecord["eventType"],
    status: row.status as MigrationIncidentOutboxRecord["status"],
    attemptCount: integer(row.attempt_count, "incident outbox attempt count"),
    failureCount: integer(row.failure_count, "incident outbox failure count"),
    maxFailures: integer(row.max_failures, "incident outbox maximum failure count"),
    lastFailureCode: incidentDeliveryFailureCode(row.last_failure_code),
    deadLetteredAt: nullableIso(row.dead_lettered_at),
    retryCycleCount: integer(row.retry_cycle_count, "incident outbox retry cycle count"),
    maxRetryCycles: integer(row.max_retry_cycles, "incident outbox maximum retry cycles"),
    availableAt: iso(row.available_at),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    publishedAt: nullableIso(row.published_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    migrationJobId: String(row.migration_job_id),
    projectId: String(row.project_id),
    environment: row.environment as Environment,
    changeSetId: String(row.change_set_id),
    incidentKind: row.incident_kind as MigrationIncidentOutboxRecord["incidentKind"],
    incidentSeverity: row.incident_severity as MigrationIncidentOutboxRecord["incidentSeverity"],
    incidentCreatedAt: iso(row.incident_created_at),
  };
}

function migrationIncidentDeliveryCommandFromRow(row: DbRow): MigrationIncidentDeliveryCommandRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    migrationIncidentId: String(row.migration_incident_id),
    requestedBy: String(row.requested_by),
    reasonCode: incidentDeliveryRetryReason(row.reason_code),
    expectedFailureCode: incidentDeliveryFailureCode(row.expected_failure_code),
    expectedRetryCycle: row.expected_retry_cycle === null || row.expected_retry_cycle === undefined
      ? null
      : count(row.expected_retry_cycle, "incident delivery expected retry cycle"),
    status: row.status as MigrationIncidentDeliveryCommandRecord["status"],
    processedAt: nullableIso(row.processed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function migrationIncidentDeliveryStatusFromRow(row: DbRow): MigrationIncidentDeliveryStatusRecord {
  return {
    migrationIncidentId: String(row.migration_incident_id),
    eventId: String(row.event_id),
    status: row.delivery_status as MigrationIncidentDeliveryStatusRecord["status"],
    attemptCount: integer(row.attempt_count, "incident delivery attempt count"),
    failureCount: integer(row.failure_count, "incident delivery failure count"),
    maxFailures: integer(row.max_failures, "incident delivery maximum failure count"),
    lastFailureCode: incidentDeliveryFailureCode(row.last_failure_code),
    deadLetteredAt: nullableIso(row.dead_lettered_at),
    retryCycleCount: integer(row.retry_cycle_count, "incident delivery retry cycle count"),
    maxRetryCycles: integer(row.max_retry_cycles, "incident delivery maximum retry cycles"),
    availableAt: iso(row.available_at),
    publishedAt: nullableIso(row.published_at),
    retryCommandPending: row.retry_command_pending === true,
  };
}

function migrationIncidentDeliveryHealthFromRow(row: DbRow): MigrationIncidentDeliveryHealthRecord {
  return {
    totalCount: count(row.total_count, "incident delivery total count"),
    pendingCount: count(row.pending_count, "incident delivery pending count"),
    readyCount: count(row.ready_count, "incident delivery ready count"),
    scheduledCount: count(row.scheduled_count, "incident delivery scheduled count"),
    inFlightCount: count(row.in_flight_count, "incident delivery in-flight count"),
    overduePendingCount: count(row.overdue_pending_count, "incident delivery overdue count"),
    expiredLeaseCount: count(row.expired_lease_count, "incident delivery expired lease count"),
    recoveryPendingCount: count(row.recovery_pending_count, "incident delivery recovery count"),
    publishedCount: count(row.published_count, "incident delivery published count"),
    deadLetteredCount: count(row.dead_lettered_count, "incident delivery dead-letter count"),
    recoveryExhaustedCount: count(
      row.recovery_exhausted_count,
      "incident delivery exhausted recovery count",
    ),
    pendingRetryCommandCount: count(
      row.pending_retry_command_count,
      "incident delivery pending retry command count",
    ),
    activeFailureCount: count(row.active_failure_count, "incident delivery active failure count"),
    activePublishFailedCount: count(
      row.active_publish_failed_count,
      "incident delivery active publish failure count",
    ),
    activeInvalidAckCount: count(
      row.active_invalid_ack_count,
      "incident delivery active invalid acknowledgement count",
    ),
    activeSigningKeyUnavailableCount: count(
      row.active_signing_key_unavailable_count,
      "incident delivery active signing key failure count",
    ),
    activeDeliveryTimeoutCount: count(
      row.active_delivery_timeout_count,
      "incident delivery active timeout count",
    ),
    activeDestinationRejectedCount: count(
      row.active_destination_rejected_count,
      "incident delivery active destination rejection count",
    ),
    oldestPendingAt: nullableIso(row.oldest_pending_at),
    oldestDeadLetteredAt: nullableIso(row.oldest_dead_lettered_at),
    latestDeadLetteredAt: nullableIso(row.latest_dead_lettered_at),
    measuredAt: iso(row.measured_at),
  };
}

function migrationOutboxFromRow(row: DbRow): MigrationOutboxRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    migrationJobId: String(row.migration_job_id),
    eventType: row.event_type as MigrationOutboxRecord["eventType"],
    status: row.status as MigrationOutboxRecord["status"],
    attemptCount: integer(row.attempt_count, "outbox attempt count"),
    failureCount: integer(row.failure_count, "outbox failure count"),
    maxFailures: integer(row.max_failures, "outbox maximum failure count"),
    lastFailureCode: migrationOutboxDeliveryFailureCode(row.last_failure_code),
    deadLetteredAt: nullableIso(row.dead_lettered_at),
    retryCycleCount: integer(row.retry_cycle_count, "outbox retry cycle count"),
    maxRetryCycles: integer(row.max_retry_cycles, "outbox maximum retry cycles"),
    availableAt: iso(row.available_at),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    publishedAt: nullableIso(row.published_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function migrationOutboxDeliveryCommandFromRow(row: DbRow): MigrationOutboxDeliveryCommandRecord {
  const expectedFailureCode = migrationOutboxDeliveryFailureCode(row.expected_failure_code);
  if (!expectedFailureCode) {
    throw new InvalidRecordError("The database returned an unbound migration delivery command.");
  }
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    migrationJobId: String(row.migration_job_id),
    requestedBy: String(row.requested_by),
    reasonCode: migrationOutboxDeliveryRetryReason(row.reason_code),
    expectedFailureCode,
    expectedRetryCycle: count(row.expected_retry_cycle, "migration delivery expected retry cycle"),
    status: row.status as MigrationOutboxDeliveryCommandRecord["status"],
    processedAt: nullableIso(row.processed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function migrationOutboxDeliveryHealthFromRow(row: DbRow): MigrationOutboxDeliveryHealthRecord {
  return {
    totalCount: count(row.total_count, "migration delivery total count"),
    pendingCount: count(row.pending_count, "migration delivery pending count"),
    readyCount: count(row.ready_count, "migration delivery ready count"),
    scheduledCount: count(row.scheduled_count, "migration delivery scheduled count"),
    inFlightCount: count(row.in_flight_count, "migration delivery in-flight count"),
    overduePendingCount: count(row.overdue_pending_count, "migration delivery overdue count"),
    expiredLeaseCount: count(row.expired_lease_count, "migration delivery expired lease count"),
    recoveryPendingCount: count(row.recovery_pending_count, "migration delivery recovery count"),
    publishedCount: count(row.published_count, "migration delivery published count"),
    deadLetteredCount: count(row.dead_lettered_count, "migration delivery dead-letter count"),
    recoveryExhaustedCount: count(row.recovery_exhausted_count, "migration delivery exhausted recovery count"),
    pendingRetryCommandCount: count(row.pending_retry_command_count, "migration delivery retry command count"),
    activeFailureCount: count(row.active_failure_count, "migration delivery active failure count"),
    activePublishFailedCount: count(row.active_publish_failed_count, "migration delivery publish failure count"),
    activeInvalidAckCount: count(row.active_invalid_ack_count, "migration delivery invalid acknowledgement count"),
    activeSigningKeyUnavailableCount: count(
      row.active_signing_key_unavailable_count,
      "migration delivery signing key failure count",
    ),
    activeDeliveryTimeoutCount: count(row.active_delivery_timeout_count, "migration delivery timeout count"),
    activeDestinationRejectedCount: count(
      row.active_destination_rejected_count,
      "migration delivery destination rejection count",
    ),
    oldestPendingAt: nullableIso(row.oldest_pending_at),
    oldestDeadLetteredAt: nullableIso(row.oldest_dead_lettered_at),
    latestDeadLetteredAt: nullableIso(row.latest_dead_lettered_at),
    measuredAt: iso(row.measured_at),
  };
}

function migrationOutboxDeliveryStatusFromRow(row: DbRow): MigrationOutboxDeliveryStatusRecord {
  return {
    migrationJobId: String(row.migration_job_id),
    eventId: String(row.event_id),
    status: row.delivery_status as MigrationOutboxDeliveryStatusRecord["status"],
    attemptCount: integer(row.attempt_count, "migration delivery attempt count"),
    failureCount: integer(row.failure_count, "migration delivery failure count"),
    maxFailures: integer(row.max_failures, "migration delivery maximum failure count"),
    lastFailureCode: migrationOutboxDeliveryFailureCode(row.last_failure_code),
    deadLetteredAt: nullableIso(row.dead_lettered_at),
    retryCycleCount: integer(row.retry_cycle_count, "migration delivery retry cycle count"),
    maxRetryCycles: integer(row.max_retry_cycles, "migration delivery maximum retry cycles"),
    availableAt: iso(row.available_at),
    publishedAt: nullableIso(row.published_at),
    retryCommandPending: row.retry_command_pending === true,
  };
}

function validateSha256(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new InvalidRecordError(`${field} must be a SHA-256 hex digest.`);
}

function boundedLimit(value: number | undefined, maximum: number): number {
  const limit = value ?? Math.min(100, maximum);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new InvalidRecordError(`limit must be between 1 and ${maximum}.`);
  }
  return limit;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new InvalidRecordError(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function workerReference(value: string): string {
  const resolved = value.trim();
  if (!resolved || resolved.length > 200) throw new InvalidRecordError("workerId must contain between 1 and 200 characters.");
  return resolved;
}

function safeErrorCode(value: string): string {
  const resolved = value.trim().toUpperCase().replace(/[^A-Z0-9_.:-]/g, "_").slice(0, 100);
  return resolved || "WORKER_FAILURE";
}

export class OrganizationRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async getCurrent(): Promise<OrganizationRecord> {
    const result = await this.tx.query(
      `SELECT id, name, slug, created_by, created_at, updated_at
       FROM organizations
       WHERE id = $1 AND deleted_at IS NULL`,
      [this.tx.organizationId],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Organization");
    return organizationFromRow(result.rows[0]);
  }

  async create(input: { name: string; slug: string; createdBy: string }): Promise<OrganizationRecord> {
    const result = await this.tx.query(
      `INSERT INTO organizations (id, name, slug, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, created_by, created_at, updated_at`,
      [this.tx.organizationId, input.name, input.slug, input.createdBy],
    );
    return organizationFromRow(result.rows[0]);
  }
}

export class ProjectRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async list(limit?: number): Promise<ProjectRecord[]> {
    const result = await this.tx.query(
      `SELECT id, organization_id, name, slug, region, status, created_by, created_at, updated_at
       FROM projects
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [this.tx.organizationId, boundedLimit(limit, 250)],
    );
    return result.rows.map(projectFromRow);
  }

  async get(projectId: string): Promise<ProjectRecord> {
    const result = await this.tx.query(
      `SELECT id, organization_id, name, slug, region, status, created_by, created_at, updated_at
       FROM projects
       WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tx.organizationId, projectId],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Project");
    return projectFromRow(result.rows[0]);
  }

  async create(input: {
    name: string;
    slug: string;
    region: string;
    createdBy: string;
    status?: ProjectRecord["status"];
  }): Promise<ProjectRecord> {
    const result = await this.tx.query(
      `INSERT INTO projects (organization_id, name, slug, region, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, name, slug, region, status, created_by, created_at, updated_at`,
      [this.tx.organizationId, input.name, input.slug, input.region, input.status ?? "provisioning", input.createdBy],
    );
    return projectFromRow(result.rows[0]);
  }

  async setProvisioningStatus(projectId: string, status: "ready" | "degraded"): Promise<ProjectRecord> {
    const result = await this.tx.query(
      `UPDATE projects SET status = $3, updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id, organization_id, name, slug, region, status, created_by, created_at, updated_at`,
      [this.tx.organizationId, projectId, status],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Project");
    return projectFromRow(result.rows[0]);
  }
}

export class ProjectEnvironmentRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async list(projectId?: string): Promise<ProjectEnvironmentRecord[]> {
    const result = await this.tx.query(
      `SELECT id, organization_id, project_id, environment, database_instance_ref, created_at
       FROM project_environments
       WHERE organization_id = $1 AND ($2::uuid IS NULL OR project_id = $2)
       ORDER BY created_at ASC`,
      [this.tx.organizationId, projectId ?? null],
    );
    return result.rows.map(projectEnvironmentFromRow);
  }

  async get(projectId: string, environment: Environment): Promise<ProjectEnvironmentRecord> {
    const result = await this.tx.query(
      `SELECT id, organization_id, project_id, environment, database_instance_ref, created_at
       FROM project_environments
       WHERE organization_id = $1 AND project_id = $2 AND environment = $3`,
      [this.tx.organizationId, projectId, environment],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Project environment");
    return projectEnvironmentFromRow(result.rows[0]);
  }

  async bindProvisioned(
    projectId: string,
    environment: Environment,
    databaseInstanceRef: string,
  ): Promise<ProjectEnvironmentRecord> {
    const result = await this.tx.query(
      `UPDATE project_environments
       SET database_instance_ref = $4
       WHERE organization_id = $1 AND project_id = $2 AND environment = $3
         AND database_instance_ref ~* '^pending:'
       RETURNING id, organization_id, project_id, environment, database_instance_ref, created_at`,
      [this.tx.organizationId, projectId, environment, databaseInstanceRef],
    );
    if (!result.rows[0]) throw new ProjectProvisioningNotReadyError();
    return projectEnvironmentFromRow(result.rows[0]);
  }

  async hasPending(projectId: string): Promise<boolean> {
    const result = await this.tx.query(
      `SELECT EXISTS (
         SELECT 1 FROM project_environments
         WHERE organization_id = $1 AND project_id = $2
           AND database_instance_ref ~* '^pending:'
       ) AS has_pending`,
      [this.tx.organizationId, projectId],
    );
    return result.rows[0]?.has_pending === true;
  }
}

const PROJECT_PROVISIONING_JOB_COLUMNS = `
  id, organization_id, project_id, environment, requested_by, status,
  attempt_count, max_attempts, retry_cycle_count, max_retry_cycles,
  available_at, lease_owner, lease_token, lease_expires_at, last_error_code,
  binding_id, started_at, finished_at, created_at, updated_at`;

const PROJECT_DATABASE_BINDING_COLUMNS = `
  id, organization_id, project_id, environment, provisioning_job_id,
  database_instance_ref, vault_static_role, host, port, expected_role,
  expected_database, expected_ledger_owner, server_certificate_sha256,
  bootstrap_contract_sha256, created_at`;

export type ProjectDatabaseProvisioningBindingInput = Omit<
  ProjectDatabaseBindingRecord,
  "id" | "organizationId" | "projectId" | "environment" | "provisioningJobId" | "createdAt"
>;

export class ProjectDatabaseProvisioningRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async heartbeat(provisionerId: string): Promise<void> {
    const owner = workerReference(provisionerId);
    await this.tx.query(
      `INSERT INTO project_database_provisioner_heartbeats
         (organization_id, provisioner_id, started_at, last_seen_at)
       VALUES ($1, $2, now(), now())
       ON CONFLICT (organization_id, provisioner_id)
       DO UPDATE SET last_seen_at = now()`,
      [this.tx.organizationId, owner],
    );
  }

  async health(): Promise<ProjectDatabaseProvisioningHealthRecord> {
    const result = await this.tx.query(
      `SELECT total_count, pending_count, ready_count, scheduled_count,
              running_count, overdue_pending_count, expired_lease_count,
              succeeded_count, failed_count, recovery_exhausted_count,
              active_failure_count, active_provider_unavailable_count,
              active_provider_rejected_count, active_invalid_binding_count,
              active_bootstrap_unverified_count, active_provisioning_timeout_count,
              observed_provisioner_count, active_provisioner_count,
              stale_provisioner_count, oldest_pending_at, latest_failed_at,
              latest_heartbeat_at, measured_at
       FROM qkern_project_database_provisioning_health()`,
    );
    if (!result.rows[0] || result.rows.length !== 1) {
      throw new InvalidRecordError("Project provisioning health is unavailable.");
    }
    return projectProvisioningHealthFromRow(result.rows[0]);
  }

  async request(projectId: string, environment: Environment): Promise<{
    status: ProjectDatabaseProvisioningStatusRecord;
    created: boolean;
  }> {
    const result = await this.tx.query(
      `SELECT job_id, job_status, attempt_count, max_attempts, retry_cycle_count,
              max_retry_cycles, last_error_code, created_at, updated_at, created
       FROM qkern_request_project_database_provisioning($1::uuid, $2::qkern_environment)`,
      [projectId, environment],
    );
    if (!result.rows[0] || result.rows.length !== 1) throw new ProjectProvisioningNotReadyError();
    return { status: projectProvisioningStatusFromRow(result.rows[0]), created: result.rows[0].created === true };
  }

  async status(projectId: string, environment: Environment): Promise<ProjectDatabaseProvisioningStatusRecord> {
    const result = await this.tx.query(
      `SELECT job_id, job_status, attempt_count, max_attempts, retry_cycle_count,
              max_retry_cycles, last_error_code, created_at, updated_at
       FROM qkern_project_database_provisioning_status($1::uuid, $2::qkern_environment)`,
      [projectId, environment],
    );
    if (!result.rows[0] || result.rows.length !== 1) throw new ResourceNotFoundError("Project provisioning job");
    return projectProvisioningStatusFromRow(result.rows[0]);
  }

  async claimNext(provisionerId: string, leaseDurationMs = 60_000): Promise<ProjectDatabaseProvisioningJobRecord | null> {
    const owner = workerReference(provisionerId);
    const leaseMs = boundedInteger(leaseDurationMs, 60_000, 1_000, 900_000, "provisioning leaseDurationMs");
    const result = await this.tx.query(
      `WITH candidate AS (
         SELECT id AS candidate_id
         FROM project_database_provisioning_jobs
         WHERE organization_id = $1 AND attempt_count < max_attempts
           AND available_at <= now()
           AND (status = 'pending' OR (status = 'running' AND lease_expires_at <= now()))
         ORDER BY available_at ASC, created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE project_database_provisioning_jobs AS job
       SET status = 'running', attempt_count = job.attempt_count + 1,
           lease_owner = $2, lease_token = gen_random_uuid(),
           lease_expires_at = now() + ($3::integer * interval '1 millisecond'),
           started_at = coalesce(job.started_at, now()), updated_at = now()
       FROM candidate
       WHERE job.organization_id = $1 AND job.id = candidate.candidate_id
       RETURNING ${PROJECT_PROVISIONING_JOB_COLUMNS}`,
      [this.tx.organizationId, owner, leaseMs],
    );
    return result.rows[0] ? projectDatabaseProvisioningJobFromRow(result.rows[0]) : null;
  }

  async quarantineExpiredLeases(): Promise<ProjectDatabaseProvisioningJobRecord[]> {
    const result = await this.tx.query(
      `UPDATE project_database_provisioning_jobs
       SET status = 'failed', last_error_code = 'PROVIDER_UNAVAILABLE',
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           finished_at = now(), updated_at = now()
       WHERE organization_id = $1 AND status = 'running' AND lease_expires_at <= now()
         AND attempt_count >= max_attempts
       RETURNING ${PROJECT_PROVISIONING_JOB_COLUMNS}`,
      [this.tx.organizationId],
    );
    return result.rows.map(projectDatabaseProvisioningJobFromRow);
  }

  async recordFailure(
    jobId: string,
    provisionerId: string,
    leaseToken: string,
    errorCode: ProjectDatabaseProvisioningErrorCode,
    backoffMs = 5_000,
  ): Promise<ProjectDatabaseProvisioningJobRecord> {
    if (!isProjectDatabaseProvisioningErrorCode(errorCode)) {
      throw new InvalidRecordError("Invalid project provisioning error code.");
    }
    const owner = workerReference(provisionerId);
    const delay = boundedInteger(backoffMs, 5_000, 0, 86_400_000, "provisioning backoffMs");
    const result = await this.tx.query(
      `UPDATE project_database_provisioning_jobs
       SET status = CASE WHEN attempt_count >= max_attempts
             THEN 'failed'::qkern_project_provisioning_status
             ELSE 'pending'::qkern_project_provisioning_status END,
           available_at = CASE WHEN attempt_count >= max_attempts
             THEN available_at ELSE now() + ($6::integer * interval '1 millisecond') END,
           last_error_code = $5, finished_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'running'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${PROJECT_PROVISIONING_JOB_COLUMNS}`,
      [this.tx.organizationId, jobId, owner, leaseToken, errorCode, delay],
    );
    if (!result.rows[0]) throw new ProjectProvisioningLeaseLostError();
    return projectDatabaseProvisioningJobFromRow(result.rows[0]);
  }

  async releaseAfterAbort(
    jobId: string,
    provisionerId: string,
    leaseToken: string,
    backoffMs = 5_000,
  ): Promise<ProjectDatabaseProvisioningJobRecord> {
    const owner = workerReference(provisionerId);
    const delay = boundedInteger(backoffMs, 5_000, 0, 86_400_000, "provisioning abort backoffMs");
    const result = await this.tx.query(
      `UPDATE project_database_provisioning_jobs
       SET status = 'pending', available_at = now() + ($5::integer * interval '1 millisecond'),
           attempt_count = greatest(attempt_count - 1, 0),
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'running'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${PROJECT_PROVISIONING_JOB_COLUMNS}`,
      [this.tx.organizationId, jobId, owner, leaseToken, delay],
    );
    if (!result.rows[0]) throw new ProjectProvisioningLeaseLostError();
    return projectDatabaseProvisioningJobFromRow(result.rows[0]);
  }

  async complete(
    job: Pick<ProjectDatabaseProvisioningJobRecord, "id" | "projectId" | "environment">,
    provisionerId: string,
    leaseToken: string,
    binding: ProjectDatabaseProvisioningBindingInput,
  ): Promise<{ job: ProjectDatabaseProvisioningJobRecord; binding: ProjectDatabaseBindingRecord }> {
    const owner = workerReference(provisionerId);
    const result = await this.tx.query(
      `WITH active_job AS (
         SELECT id, project_id, environment
         FROM project_database_provisioning_jobs
         WHERE organization_id = $1 AND id = $2 AND project_id = $3 AND environment = $4
           AND status = 'running' AND lease_owner = $5 AND lease_token = $6 AND lease_expires_at > now()
         FOR UPDATE
       ), inserted_binding AS (
         INSERT INTO project_database_bindings
           (organization_id, project_id, environment, provisioning_job_id,
            database_instance_ref, vault_static_role, host, port, expected_role,
            expected_database, expected_ledger_owner, server_certificate_sha256,
            bootstrap_contract_sha256)
         SELECT $1, active_job.project_id, active_job.environment, active_job.id,
                $7, $8, $9, $10, $11, $12, $13, $14, $15
         FROM active_job
         RETURNING ${PROJECT_DATABASE_BINDING_COLUMNS}
       ), bound_environment AS (
         UPDATE project_environments AS environment
         SET database_instance_ref = inserted.database_instance_ref
         FROM active_job, inserted_binding AS inserted
         WHERE environment.organization_id = $1 AND environment.project_id = active_job.project_id
           AND environment.environment = active_job.environment
           AND environment.database_instance_ref ~* '^pending:'
         RETURNING environment.id
       ), completed AS (
         UPDATE project_database_provisioning_jobs AS target
         SET status = 'succeeded', binding_id = inserted.id, last_error_code = NULL,
             lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
             finished_at = now(), updated_at = now()
         FROM inserted_binding AS inserted, bound_environment
         WHERE target.organization_id = $1 AND target.id = $2
         RETURNING ${PROJECT_PROVISIONING_JOB_COLUMNS}
       )
       SELECT completed.*, inserted.id AS provisioned_binding_id,
              inserted.organization_id AS binding_organization_id,
              inserted.project_id AS binding_project_id,
              inserted.environment AS binding_environment,
              inserted.provisioning_job_id AS binding_provisioning_job_id,
              inserted.database_instance_ref AS binding_database_instance_ref,
              inserted.vault_static_role AS binding_vault_static_role,
              inserted.host AS binding_host, inserted.port AS binding_port,
              inserted.expected_role AS binding_expected_role,
              inserted.expected_database AS binding_expected_database,
              inserted.expected_ledger_owner AS binding_expected_ledger_owner,
              inserted.server_certificate_sha256 AS binding_server_certificate_sha256,
              inserted.bootstrap_contract_sha256 AS binding_bootstrap_contract_sha256,
              inserted.created_at AS binding_created_at
       FROM completed, inserted_binding AS inserted`,
      [this.tx.organizationId, job.id, job.projectId, job.environment, owner, leaseToken,
       binding.databaseInstanceRef, binding.vaultStaticRole, binding.host, binding.port,
       binding.expectedRole, binding.expectedDatabase, binding.expectedLedgerOwner,
       binding.serverCertificateSha256, binding.bootstrapContractSha256],
    );
    const row = result.rows[0];
    if (!row) throw new ProjectProvisioningLeaseLostError();
    const completedJob = projectDatabaseProvisioningJobFromRow(row);
    const completedBinding = projectDatabaseBindingFromRow({
      id: row.provisioned_binding_id, organization_id: row.binding_organization_id,
      project_id: row.binding_project_id, environment: row.binding_environment,
      provisioning_job_id: row.binding_provisioning_job_id,
      database_instance_ref: row.binding_database_instance_ref, vault_static_role: row.binding_vault_static_role,
      host: row.binding_host, port: row.binding_port, expected_role: row.binding_expected_role,
      expected_database: row.binding_expected_database, expected_ledger_owner: row.binding_expected_ledger_owner,
      server_certificate_sha256: row.binding_server_certificate_sha256,
      bootstrap_contract_sha256: row.binding_bootstrap_contract_sha256, created_at: row.binding_created_at,
    });
    return { job: completedJob, binding: completedBinding };
  }
}

export class ProjectDatabaseBindingRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async getByReference(databaseInstanceRef: string): Promise<ProjectDatabaseBindingRecord> {
    const result = await this.tx.query(
      `SELECT ${PROJECT_DATABASE_BINDING_COLUMNS}
       FROM project_database_bindings
       WHERE organization_id = $1 AND database_instance_ref = $2`,
      [this.tx.organizationId, databaseInstanceRef],
    );
    if (!result.rows[0] || result.rows.length !== 1) throw new ResourceNotFoundError("Project database binding");
    return projectDatabaseBindingFromRow(result.rows[0]);
  }
}

export class ChangeSetRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async list(input: { projectId?: string; environment?: Environment; limit?: number } = {}): Promise<ChangeSetRecord[]> {
    const result = await this.tx.query(
      `SELECT id, organization_id, project_id, environment, title, statement_sha256, encrypted_statement,
              risk, status, created_by, agent_session_id, created_at, updated_at
       FROM change_sets
       WHERE organization_id = $1
         AND ($2::uuid IS NULL OR project_id = $2)
         AND ($3::qkern_environment IS NULL OR environment = $3)
       ORDER BY created_at DESC
       LIMIT $4`,
      [this.tx.organizationId, input.projectId ?? null, input.environment ?? null, boundedLimit(input.limit, 250)],
    );
    return result.rows.map(changeSetFromRow);
  }

  async get(changeSetId: string): Promise<ChangeSetRecord> {
    const result = await this.tx.query(
      `SELECT id, organization_id, project_id, environment, title, statement_sha256, encrypted_statement,
              risk, status, created_by, agent_session_id, created_at, updated_at
       FROM change_sets
       WHERE organization_id = $1 AND id = $2`,
      [this.tx.organizationId, changeSetId],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Change set");
    return changeSetFromRow(result.rows[0]);
  }

  async create(input: {
    id: string;
    projectId: string;
    environment: Environment;
    title: string;
    statementSha256: string;
    encryptedStatement: Uint8Array;
    risk: Risk;
    status?: ChangeStatus;
    createdBy?: string | null;
    agentSessionId?: string | null;
  }): Promise<ChangeSetRecord> {
    validateSha256(input.statementSha256, "statementSha256");
    if (!input.encryptedStatement.byteLength) throw new InvalidRecordError("encryptedStatement cannot be empty.");
    const result = await this.tx.query(
      `INSERT INTO change_sets
         (organization_id, project_id, environment, title, statement_sha256, encrypted_statement,
          risk, status, created_by, agent_session_id, id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, organization_id, project_id, environment, title, statement_sha256, encrypted_statement,
                 risk, status, created_by, agent_session_id, created_at, updated_at`,
      [
        this.tx.organizationId, input.projectId, input.environment, input.title, input.statementSha256,
        input.encryptedStatement, input.risk, input.status ?? "ready", input.createdBy ?? null,
        input.agentSessionId ?? null, input.id,
      ],
    );
    return changeSetFromRow(result.rows[0]);
  }

  async setStatus(changeSetId: string, status: ChangeStatus): Promise<ChangeSetRecord> {
    const result = await this.tx.query(
      `UPDATE change_sets
       SET status = $3, updated_at = now()
       WHERE organization_id = $1 AND id = $2
       RETURNING id, organization_id, project_id, environment, title, statement_sha256, encrypted_statement,
                 risk, status, created_by, agent_session_id, created_at, updated_at`,
      [this.tx.organizationId, changeSetId, status],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Change set");
    return changeSetFromRow(result.rows[0]);
  }
}

export class ApprovalRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async list(input: { projectId?: string; status?: ApprovalRequestRecord["status"]; limit?: number } = {}): Promise<ApprovalRequestRecord[]> {
    const result = await this.tx.query(
      `SELECT id, organization_id, project_id, change_set_id, environment, action_hash, status, expires_at, created_at
       FROM approval_requests
       WHERE organization_id = $1
         AND ($2::uuid IS NULL OR project_id = $2)
         AND ($3::text IS NULL OR status = $3)
       ORDER BY created_at DESC
       LIMIT $4`,
      [this.tx.organizationId, input.projectId ?? null, input.status ?? null, boundedLimit(input.limit, 250)],
    );
    return result.rows.map(approvalFromRow);
  }

  async getForChangeSet(changeSetId: string): Promise<ApprovalRequestRecord | null> {
    const result = await this.tx.query(
      `SELECT id, organization_id, project_id, change_set_id, environment, action_hash, status, expires_at, created_at
       FROM approval_requests
       WHERE organization_id = $1 AND change_set_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [this.tx.organizationId, changeSetId],
    );
    return result.rows[0] ? approvalFromRow(result.rows[0]) : null;
  }

  async get(requestId: string): Promise<ApprovalRequestRecord> {
    const result = await this.tx.query(
      `SELECT id, organization_id, project_id, change_set_id, environment, action_hash, status, expires_at, created_at
       FROM approval_requests
       WHERE organization_id = $1 AND id = $2`,
      [this.tx.organizationId, requestId],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Approval request");
    return approvalFromRow(result.rows[0]);
  }

  async create(input: {
    projectId: string;
    changeSetId: string;
    environment: Environment;
    actionHash: string;
    expiresAt: Date;
  }): Promise<ApprovalRequestRecord> {
    validateSha256(input.actionHash, "actionHash");
    if (input.expiresAt.getTime() <= Date.now()) throw new InvalidRecordError("expiresAt must be in the future.");
    const result = await this.tx.query(
      `INSERT INTO approval_requests
         (organization_id, project_id, change_set_id, environment, action_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, project_id, change_set_id, environment, action_hash, status, expires_at, created_at`,
      [this.tx.organizationId, input.projectId, input.changeSetId, input.environment, input.actionHash, input.expiresAt],
    );
    return approvalFromRow(result.rows[0]);
  }

  async decide(
    approvalId: string,
    decision: "approved" | "rejected",
    actor: string | { id?: string | null; type: "user" | "agent" | "system"; ref: string },
  ): Promise<{ approval: ApprovalRequestRecord; decision: ApprovalDecisionRecord }> {
    const locked = await this.tx.query(
      `SELECT id, organization_id, project_id, change_set_id, environment, action_hash, status, expires_at, created_at
       FROM approval_requests
       WHERE organization_id = $1 AND id = $2
       FOR UPDATE`,
      [this.tx.organizationId, approvalId],
    );
    if (!locked.rows[0]) throw new ResourceNotFoundError("Approval request");
    const current = approvalFromRow(locked.rows[0]);
    if (current.status !== "pending") throw new ApprovalAlreadyDecidedError();
    if (new Date(current.expiresAt).getTime() <= Date.now()) throw new ApprovalExpiredError();

    const normalizedActor = typeof actor === "string"
      ? { id: actor, type: "user" as const, ref: actor }
      : actor;
    if (!normalizedActor.ref || normalizedActor.ref.length > 200 ||
        (normalizedActor.type === "user" && !normalizedActor.id) ||
        (normalizedActor.type !== "user" && normalizedActor.id)) {
      throw new InvalidRecordError("Invalid approval decision actor.");
    }
    const decisionResult = await this.tx.query(
      `INSERT INTO approval_decisions
         (organization_id, approval_request_id, decided_by, actor_type, actor_ref, decision)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, approval_request_id, decided_by, actor_type, actor_ref, decision, created_at`,
      [
        this.tx.organizationId,
        approvalId,
        normalizedActor.id ?? null,
        normalizedActor.type,
        normalizedActor.ref,
        decision,
      ],
    );
    const approvalResult = await this.tx.query(
      `UPDATE approval_requests
       SET status = $3
       WHERE organization_id = $1 AND id = $2 AND status = 'pending'
       RETURNING id, organization_id, project_id, change_set_id, environment, action_hash, status, expires_at, created_at`,
      [this.tx.organizationId, approvalId, decision],
    );
    if (!approvalResult.rows[0]) throw new ApprovalAlreadyDecidedError();
    await this.tx.query(
      `UPDATE change_sets
       SET status = $3::qkern_change_status, updated_at = now()
       WHERE organization_id = $1 AND id = $2`,
      [this.tx.organizationId, current.changeSetId, decision],
    );
    return {
      approval: approvalFromRow(approvalResult.rows[0]),
      decision: decisionFromRow(decisionResult.rows[0]),
    };
  }
}

export class ProjectAutomationPolicyRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async get(projectId: string, environment: Environment): Promise<ProjectAutomationPolicyRecord | null> {
    const result = await this.tx.query(
      `SELECT organization_id, project_id, environment, mode, max_auto_risk,
              auto_queue, emergency_stop, revision, updated_by, updated_at
       FROM project_automation_policies
       WHERE organization_id = $1 AND project_id = $2 AND environment = $3`,
      [this.tx.organizationId, projectId, environment],
    );
    return result.rows[0] ? automationPolicyFromRow(result.rows[0]) : null;
  }

  async set(input: {
    projectId: string;
    environment: Environment;
    mode: AutomationMode;
    maxAutoRisk: Risk;
    autoQueue: boolean;
    emergencyStop: boolean;
    updatedBy: string;
  }): Promise<ProjectAutomationPolicyRecord> {
    const result = await this.tx.query(
      `INSERT INTO project_automation_policies
         (organization_id, project_id, environment, mode, max_auto_risk,
          auto_queue, emergency_stop, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, project_id, environment)
       DO UPDATE SET mode = EXCLUDED.mode,
                     max_auto_risk = EXCLUDED.max_auto_risk,
                     auto_queue = EXCLUDED.auto_queue,
                     emergency_stop = EXCLUDED.emergency_stop,
                     revision = project_automation_policies.revision + 1,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = now()
       RETURNING organization_id, project_id, environment, mode, max_auto_risk,
                 auto_queue, emergency_stop, revision, updated_by, updated_at`,
      [
        this.tx.organizationId,
        input.projectId,
        input.environment,
        input.mode,
        input.maxAutoRisk,
        input.autoQueue,
        input.emergencyStop,
        input.updatedBy,
      ],
    );
    if (!result.rows[0]) throw new InvalidRecordError("Automation policy could not be persisted.");
    return automationPolicyFromRow(result.rows[0]);
  }
}

export class AuditRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async list(input: { projectId?: string; environment?: Environment; limit?: number } = {}): Promise<AuditLogRecord[]> {
    const result = await this.tx.query(
      `SELECT id, organization_id, project_id, environment, actor_type, actor_ref, action, resource_ref,
              status, redacted_metadata, previous_hash, entry_hash, created_at
       FROM audit_logs
       WHERE organization_id = $1
         AND ($2::uuid IS NULL OR project_id = $2)
         AND ($3::qkern_environment IS NULL OR environment = $3)
       ORDER BY created_at DESC
       LIMIT $4`,
      [this.tx.organizationId, input.projectId ?? null, input.environment ?? null, boundedLimit(input.limit, 500)],
    );
    return result.rows.map(auditFromRow);
  }

  async append(input: {
    projectId?: string | null;
    environment?: Environment | null;
    actorType: string;
    actorRef: string;
    action: string;
    resourceRef: string;
    status: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogRecord> {
    const redacted = object(redactSensitive(input.metadata ?? {}));
    const result = await this.tx.query(
      `INSERT INTO audit_logs
         (organization_id, project_id, environment, actor_type, actor_ref, action, resource_ref,
          status, redacted_metadata, previous_hash, entry_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NULL, repeat('0', 64))
       RETURNING id, organization_id, project_id, environment, actor_type, actor_ref, action, resource_ref,
                 status, redacted_metadata, previous_hash, entry_hash, created_at`,
      [
        this.tx.organizationId, input.projectId ?? null, input.environment ?? null, input.actorType,
        input.actorRef, input.action, input.resourceRef, input.status, JSON.stringify(redacted),
      ],
    );
    return auditFromRow(result.rows[0]);
  }
}

const MIGRATION_JOB_COLUMNS = `
  id, organization_id, project_id, environment, database_instance_ref, change_set_id, approval_request_id,
  claim_sequence, status,
  attempt_count, max_attempts, reconciliation_required, reconciliation_attempt_count,
  max_reconciliation_attempts, review_cycle_count, max_review_cycles, available_at, lease_owner, lease_token,
  lease_expires_at, last_error_code, last_error_message, started_at,
  finished_at, created_at, updated_at`;

export class MigrationJobRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async list(input: { projectId?: string; status?: MigrationJobRecord["status"]; limit?: number } = {}): Promise<MigrationJobRecord[]> {
    const result = await this.tx.query(
      `SELECT ${MIGRATION_JOB_COLUMNS}
       FROM migration_jobs
       WHERE organization_id = $1
         AND ($2::uuid IS NULL OR project_id = $2)
         AND ($3::qkern_migration_job_status IS NULL OR status = $3)
       ORDER BY created_at DESC
       LIMIT $4`,
      [this.tx.organizationId, input.projectId ?? null, input.status ?? null, boundedLimit(input.limit, 250)],
    );
    return result.rows.map(migrationJobFromRow);
  }

  async get(jobId: string): Promise<MigrationJobRecord> {
    const result = await this.tx.query(
      `SELECT ${MIGRATION_JOB_COLUMNS}
       FROM migration_jobs
       WHERE organization_id = $1 AND id = $2`,
      [this.tx.organizationId, jobId],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Migration job");
    return migrationJobFromRow(result.rows[0]);
  }

  async getForChangeSet(changeSetId: string): Promise<MigrationJobRecord | null> {
    const result = await this.tx.query(
      `SELECT ${MIGRATION_JOB_COLUMNS}
       FROM migration_jobs
       WHERE organization_id = $1 AND change_set_id = $2`,
      [this.tx.organizationId, changeSetId],
    );
    return result.rows[0] ? migrationJobFromRow(result.rows[0]) : null;
  }

  async enqueueApproved(
    changeSetId: string,
    approvalRequestId: string,
    options: { maxAttempts?: number; availableAt?: Date } = {},
  ): Promise<{ job: MigrationJobRecord; created: boolean }> {
    const maxAttempts = boundedInteger(options.maxAttempts, 5, 1, 100, "maxAttempts");
    const availableAt = options.availableAt ?? new Date();
    if (!Number.isFinite(availableAt.getTime())) throw new InvalidRecordError("availableAt must be a valid timestamp.");

    // The transaction-level lock closes the INSERT ... ON CONFLICT visibility
    // race while retaining one stable row and one stable outbox event.
    await this.tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))",
      [this.tx.organizationId, changeSetId],
    );
    const existing = await this.tx.query(
      `SELECT ${MIGRATION_JOB_COLUMNS}
       FROM migration_jobs
       WHERE organization_id = $1 AND change_set_id = $2`,
      [this.tx.organizationId, changeSetId],
    );

    let row = existing.rows[0];
    let created = false;
    if (!row) {
      const inserted = await this.tx.query(
        `INSERT INTO migration_jobs
           (organization_id, project_id, environment, database_instance_ref, change_set_id,
            approval_request_id, max_attempts, available_at)
         SELECT change_set.organization_id, change_set.project_id, change_set.environment,
                environment.database_instance_ref, change_set.id, approval.id, $4, $5
         FROM change_sets AS change_set
         JOIN project_environments AS environment
           ON environment.organization_id = change_set.organization_id
          AND environment.project_id = change_set.project_id
          AND environment.environment = change_set.environment
         JOIN approval_requests AS approval
           ON approval.organization_id = change_set.organization_id
          AND approval.project_id = change_set.project_id
          AND approval.environment = change_set.environment
          AND approval.change_set_id = change_set.id
          AND approval.id = $3
          AND approval.status = 'approved'
         WHERE change_set.organization_id = $1 AND change_set.id = $2 AND change_set.status = 'approved'
           AND environment.database_instance_ref !~* '^pending:'
         RETURNING ${MIGRATION_JOB_COLUMNS}`,
        [this.tx.organizationId, changeSetId, approvalRequestId, maxAttempts, availableAt],
      );
      row = inserted.rows[0];
      created = Boolean(row);
    }
    if (!row) throw new MigrationNotReadyError();

    await this.tx.query(
      `INSERT INTO migration_outbox (organization_id, migration_job_id, event_type)
       VALUES ($1, $2, 'migration.apply.requested')
       ON CONFLICT (organization_id, migration_job_id, event_type) DO NOTHING`,
      [this.tx.organizationId, String(row.id)],
    );
    return { job: migrationJobFromRow(row), created };
  }

  async claimNext(workerId: string, leaseDurationMs = 60_000): Promise<(MigrationJobRecord & { reclaimed: boolean }) | null> {
    const owner = workerReference(workerId);
    const leaseMs = boundedInteger(leaseDurationMs, 60_000, 1_000, 900_000, "leaseDurationMs");

    const result = await this.tx.query(
      `WITH candidate AS (
         SELECT id AS candidate_id, status = 'running' AS reclaimed
         FROM migration_jobs
         WHERE organization_id = $1
           AND (
             (status = 'queued' AND available_at <= now() AND (
               (NOT reconciliation_required AND attempt_count < max_attempts) OR
               (reconciliation_required AND reconciliation_attempt_count < max_reconciliation_attempts)
             )) OR
             (status = 'running' AND lease_expires_at <= now() AND (
               NOT reconciliation_required OR reconciliation_attempt_count < max_reconciliation_attempts
             ))
           )
         ORDER BY available_at ASC, created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE migration_jobs AS job
       SET status = 'running',
           attempt_count = CASE WHEN job.reconciliation_required THEN job.attempt_count
                                ELSE least(job.attempt_count + 1, job.max_attempts) END,
           reconciliation_attempt_count = CASE WHEN job.reconciliation_required
             THEN least(job.reconciliation_attempt_count + 1, job.max_reconciliation_attempts)
             ELSE job.reconciliation_attempt_count END,
           claim_sequence = job.claim_sequence + 1,
           lease_owner = $2, lease_token = gen_random_uuid(),
           lease_expires_at = now() + ($3::integer * interval '1 millisecond'),
           started_at = coalesce(job.started_at, now()), updated_at = now()
       FROM candidate
       WHERE job.organization_id = $1 AND job.id = candidate.candidate_id
         AND job.claim_sequence < 9223372036854775807
       RETURNING ${MIGRATION_JOB_COLUMNS}, candidate.reclaimed`,
      [this.tx.organizationId, owner, leaseMs],
    );
    return result.rows[0]
      ? { ...migrationJobFromRow(result.rows[0]), reclaimed: result.rows[0].reclaimed === true }
      : null;
  }

  async quarantineExpiredReconciliations(limit = 50): Promise<MigrationJobRecord[]> {
    const bounded = boundedInteger(limit, 50, 1, 250, "reconciliation quarantine limit");
    const result = await this.tx.query(
      `WITH candidates AS (
         SELECT id
         FROM migration_jobs
         WHERE organization_id = $1 AND status = 'running' AND reconciliation_required
           AND reconciliation_attempt_count >= max_reconciliation_attempts
           AND lease_expires_at <= now()
         ORDER BY lease_expires_at ASC, created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE migration_jobs AS job
       SET status = 'review_required',
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           last_error_code = 'RECONCILIATION_ATTEMPTS_EXHAUSTED',
           last_error_message = 'Migration outcome requires manual review.',
           finished_at = now(), updated_at = now()
       FROM candidates
       WHERE job.organization_id = $1 AND job.id = candidates.id
       RETURNING ${MIGRATION_JOB_COLUMNS}`,
      [this.tx.organizationId, bounded],
    );
    return result.rows.map(migrationJobFromRow);
  }

  async renewLease(jobId: string, workerId: string, leaseToken: string, leaseDurationMs = 60_000): Promise<MigrationJobRecord> {
    const owner = workerReference(workerId);
    const leaseMs = boundedInteger(leaseDurationMs, 60_000, 1_000, 900_000, "leaseDurationMs");
    const result = await this.tx.query(
      `UPDATE migration_jobs
       SET lease_expires_at = now() + ($5::integer * interval '1 millisecond'), updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'running'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${MIGRATION_JOB_COLUMNS}`,
      [this.tx.organizationId, jobId, owner, leaseToken, leaseMs],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    return migrationJobFromRow(result.rows[0]);
  }

  async markApplied(jobId: string, workerId: string, leaseToken: string): Promise<MigrationJobRecord> {
    const owner = workerReference(workerId);
    const result = await this.tx.query(
      `UPDATE migration_jobs
       SET status = 'applied', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           reconciliation_required = false, reconciliation_attempt_count = 0,
           last_error_code = NULL, last_error_message = NULL, finished_at = now(), updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'running'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${MIGRATION_JOB_COLUMNS}`,
      [this.tx.organizationId, jobId, owner, leaseToken],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    const job = migrationJobFromRow(result.rows[0]);
    const changeSet = await this.tx.query(
      `UPDATE change_sets
       SET status = 'applied', updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'approved'
       RETURNING id`,
      [this.tx.organizationId, job.changeSetId],
    );
    if (!changeSet.rows[0]) throw new MigrationNotReadyError();
    return job;
  }

  async markFailed(input: {
    jobId: string;
    workerId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
    backoffMs?: number;
    terminal?: boolean;
  }): Promise<MigrationJobRecord> {
    const owner = workerReference(input.workerId);
    const backoffMs = boundedInteger(input.backoffMs, 5_000, 0, 86_400_000, "backoffMs");
    const locked = await this.tx.query(
      `SELECT ${MIGRATION_JOB_COLUMNS}
       FROM migration_jobs
       WHERE organization_id = $1 AND id = $2 AND status = 'running'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       FOR UPDATE`,
      [this.tx.organizationId, input.jobId, owner, input.leaseToken],
    );
    if (!locked.rows[0]) throw new MigrationLeaseLostError();
    const current = migrationJobFromRow(locked.rows[0]);
    if (current.reconciliationRequired) throw new MigrationNotReadyError();
    const exhausted = input.terminal === true || current.attemptCount >= current.maxAttempts;
    const result = await this.tx.query(
      `UPDATE migration_jobs
       SET status = $5::qkern_migration_job_status,
           available_at = CASE WHEN $5 = 'queued' THEN now() + ($6::integer * interval '1 millisecond') ELSE available_at END,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           last_error_code = $7, last_error_message = $8,
           finished_at = CASE WHEN $5 = 'failed' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'running'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${MIGRATION_JOB_COLUMNS}`,
      [
        this.tx.organizationId, input.jobId, owner, input.leaseToken,
        exhausted ? "failed" : "queued", backoffMs, safeErrorCode(input.errorCode),
        redactSensitiveText(input.errorMessage).slice(0, 1_000),
      ],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    const job = migrationJobFromRow(result.rows[0]);
    if (exhausted) {
      await this.tx.query(
        `UPDATE change_sets
         SET status = 'failed', updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status <> 'applied'`,
        [this.tx.organizationId, job.changeSetId],
      );
    }
    return job;
  }

  async deferForReconciliation(input: {
    jobId: string;
    workerId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
    backoffMs?: number;
  }): Promise<MigrationJobRecord> {
    const owner = workerReference(input.workerId);
    const backoffMs = boundedInteger(input.backoffMs, 5_000, 0, 86_400_000, "backoffMs");
    const locked = await this.tx.query(
      `SELECT ${MIGRATION_JOB_COLUMNS}
       FROM migration_jobs
       WHERE organization_id = $1 AND id = $2 AND status = 'running'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       FOR UPDATE`,
      [this.tx.organizationId, input.jobId, owner, input.leaseToken],
    );
    if (!locked.rows[0]) throw new MigrationLeaseLostError();
    const current = migrationJobFromRow(locked.rows[0]);
    const reviewRequired = current.reconciliationRequired &&
      current.reconciliationAttemptCount >= current.maxReconciliationAttempts;
    const result = await this.tx.query(
      `UPDATE migration_jobs
       SET status = $5::qkern_migration_job_status,
           available_at = CASE WHEN $5 = 'queued' THEN now() + ($6::integer * interval '1 millisecond') ELSE available_at END,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           reconciliation_required = true,
           last_error_code = $7, last_error_message = $8,
           finished_at = CASE WHEN $5 = 'review_required' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'running'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${MIGRATION_JOB_COLUMNS}`,
      [
        this.tx.organizationId, input.jobId, owner, input.leaseToken,
        reviewRequired ? "review_required" : "queued", backoffMs, safeErrorCode(input.errorCode),
        redactSensitiveText(input.errorMessage).slice(0, 1_000),
      ],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    return migrationJobFromRow(result.rows[0]);
  }
}

const MIGRATION_REVIEW_COMMAND_COLUMNS = `
  id, organization_id, migration_job_id, requested_by, reason_code, status,
  processed_at, created_at, updated_at`;

const MIGRATION_REVIEW_REASON_CODES = new Set<MigrationReviewReasonCode>([
  "dependency_recovered", "manual_recheck", "incident_recovery",
]);

export class MigrationReviewCommandRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async enqueue(
    migrationJobId: string,
    requestedBy: string,
    reasonCode: MigrationReviewReasonCode,
  ): Promise<{ command: MigrationReviewCommandRecord; created: boolean }> {
    const actor = workerReference(requestedBy);
    if (!MIGRATION_REVIEW_REASON_CODES.has(reasonCode)) throw new InvalidRecordError("Invalid review reason code.");
    const inserted = await this.tx.query(
      `INSERT INTO migration_review_commands
         (organization_id, migration_job_id, requested_by, reason_code)
       SELECT $1, job.id, $3, $4
       FROM migration_jobs AS job
       WHERE job.organization_id = $1 AND job.id = $2 AND job.status = 'review_required'
         AND job.review_cycle_count < job.max_review_cycles
       ON CONFLICT (organization_id, migration_job_id) WHERE status = 'pending' DO NOTHING
       RETURNING ${MIGRATION_REVIEW_COMMAND_COLUMNS}`,
      [this.tx.organizationId, migrationJobId, actor, reasonCode],
    );
    if (inserted.rows[0]) return { command: migrationReviewCommandFromRow(inserted.rows[0]), created: true };
    const existing = await this.tx.query(
      `SELECT ${MIGRATION_REVIEW_COMMAND_COLUMNS}
       FROM migration_review_commands
       WHERE organization_id = $1 AND migration_job_id = $2 AND status = 'pending'`,
      [this.tx.organizationId, migrationJobId],
    );
    if (!existing.rows[0]) throw new MigrationNotReadyError();
    return { command: migrationReviewCommandFromRow(existing.rows[0]), created: false };
  }

  async processPending(limit = 20): Promise<Array<{
    command: MigrationReviewCommandRecord;
    job: MigrationJobRecord | null;
  }>> {
    const bounded = boundedInteger(limit, 20, 1, 100, "review command limit");
    const pending = await this.tx.query(
      `SELECT ${MIGRATION_REVIEW_COMMAND_COLUMNS}
       FROM migration_review_commands
       WHERE organization_id = $1 AND status = 'pending'
       ORDER BY created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [this.tx.organizationId, bounded],
    );
    const processed: Array<{ command: MigrationReviewCommandRecord; job: MigrationJobRecord | null }> = [];
    for (const row of pending.rows) {
      const command = migrationReviewCommandFromRow(row);
      const jobResult = await this.tx.query(
        `UPDATE migration_jobs
         SET status = 'queued', available_at = now(),
             lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
             reconciliation_required = true, reconciliation_attempt_count = 0,
             review_cycle_count = review_cycle_count + 1,
             last_error_code = 'OPERATOR_RECONCILIATION_REQUESTED',
             last_error_message = 'An authorized operator requested target-ledger reconciliation.',
             finished_at = NULL, updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'review_required'
           AND reconciliation_required AND review_cycle_count < max_review_cycles
         RETURNING ${MIGRATION_JOB_COLUMNS}`,
        [this.tx.organizationId, command.migrationJobId],
      );
      const job = jobResult.rows[0] ? migrationJobFromRow(jobResult.rows[0]) : null;
      const completed = await this.tx.query(
        `UPDATE migration_review_commands
         SET status = $3::qkern_migration_review_command_status, processed_at = now(), updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'
         RETURNING ${MIGRATION_REVIEW_COMMAND_COLUMNS}`,
        [this.tx.organizationId, command.id, job ? "applied" : "rejected"],
      );
      if (!completed.rows[0]) throw new InvalidRecordError("The review command changed while locked.");
      processed.push({ command: migrationReviewCommandFromRow(completed.rows[0]), job });
    }
    return processed;
  }
}

const MIGRATION_INCIDENT_RESOLUTION_COMMAND_COLUMNS = `
  id, organization_id, migration_incident_id, requested_by, reason_code, status,
  processed_at, created_at, updated_at`;

export class MigrationIncidentResolutionCommandRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async enqueue(
    migrationIncidentId: string,
    requestedBy: string,
    reasonCode: MigrationIncidentResolutionReasonCode,
  ): Promise<{ command: MigrationIncidentResolutionCommandRecord; created: boolean }> {
    const actor = workerReference(requestedBy);
    if (reasonCode !== "target_ledger_recheck") {
      throw new InvalidRecordError("Invalid incident resolution reason code.");
    }
    const inserted = await this.tx.query(
      `INSERT INTO migration_incident_resolution_commands
         (organization_id, migration_incident_id, requested_by, reason_code)
       VALUES ($1, $2, $3, $4::qkern_migration_incident_resolution_reason_code)
       ON CONFLICT (organization_id, migration_incident_id) WHERE status = 'pending' DO NOTHING
       RETURNING ${MIGRATION_INCIDENT_RESOLUTION_COMMAND_COLUMNS}`,
      [this.tx.organizationId, migrationIncidentId, actor, reasonCode],
    );
    if (inserted.rows[0]) {
      return { command: migrationIncidentResolutionCommandFromRow(inserted.rows[0]), created: true };
    }
    const existing = await this.tx.query(
      `SELECT ${MIGRATION_INCIDENT_RESOLUTION_COMMAND_COLUMNS}
       FROM migration_incident_resolution_commands
       WHERE organization_id = $1 AND migration_incident_id = $2 AND status = 'pending'`,
      [this.tx.organizationId, migrationIncidentId],
    );
    if (!existing.rows[0]) throw new MigrationNotReadyError();
    const command = migrationIncidentResolutionCommandFromRow(existing.rows[0]);
    if (command.reasonCode !== reasonCode) throw new MigrationNotReadyError();
    return { command, created: false };
  }

  async processPending(limit = 20): Promise<Array<{
    command: MigrationIncidentResolutionCommandRecord;
    job: MigrationJobRecord | null;
  }>> {
    const bounded = boundedInteger(limit, 20, 1, 100, "incident resolution command limit");
    const pending = await this.tx.query(
      `SELECT ${MIGRATION_INCIDENT_RESOLUTION_COMMAND_COLUMNS}
       FROM migration_incident_resolution_commands
       WHERE organization_id = $1 AND status = 'pending'
       ORDER BY created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [this.tx.organizationId, bounded],
    );
    const processed: Array<{
      command: MigrationIncidentResolutionCommandRecord;
      job: MigrationJobRecord | null;
    }> = [];
    for (const row of pending.rows) {
      const command = migrationIncidentResolutionCommandFromRow(row);
      const jobResult = await this.tx.query(
        `UPDATE migration_jobs AS job
         SET status = 'queued', available_at = now(),
             lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
             reconciliation_required = true, reconciliation_attempt_count = 0,
             last_error_code = 'INCIDENT_RESOLUTION_VERIFICATION_REQUESTED',
             last_error_message = 'An authorized operator requested target-ledger resolution verification.',
             finished_at = NULL, updated_at = now()
         WHERE job.organization_id = $1
           AND job.status = 'review_required' AND job.reconciliation_required
           AND EXISTS (
             SELECT 1
             FROM migration_incidents AS incident
             WHERE incident.organization_id = job.organization_id
               AND incident.id = $2
               AND incident.migration_job_id = job.id
               AND incident.status IN ('open', 'acknowledged')
               AND (
                 SELECT count(*)
                 FROM migration_incident_resolution_commands AS prior
                 WHERE prior.organization_id = incident.organization_id
                   AND prior.migration_incident_id = incident.id
                   AND prior.status = 'applied'
               ) < 3
           )
         RETURNING ${MIGRATION_JOB_COLUMNS}`,
        [this.tx.organizationId, command.migrationIncidentId],
      );
      const job = jobResult.rows[0] ? migrationJobFromRow(jobResult.rows[0]) : null;
      const completed = await this.tx.query(
        `UPDATE migration_incident_resolution_commands
         SET status = $3::qkern_migration_incident_resolution_command_status,
             processed_at = now(), updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'
         RETURNING ${MIGRATION_INCIDENT_RESOLUTION_COMMAND_COLUMNS}`,
        [this.tx.organizationId, command.id, job ? "applied" : "rejected"],
      );
      if (!completed.rows[0]) {
        throw new InvalidRecordError("The incident resolution command changed while locked.");
      }
      processed.push({
        command: migrationIncidentResolutionCommandFromRow(completed.rows[0]),
        job,
      });
    }
    return processed;
  }
}

const MIGRATION_INCIDENT_COLUMNS = `
  id, organization_id, migration_job_id, project_id, environment, change_set_id,
  kind, severity, status, detected_review_cycle, detected_reconciliation_attempt,
  acknowledged_by, acknowledgement_code, acknowledged_at,
  resolved_by, resolution_code, resolved_at, created_at, updated_at`;

const MIGRATION_INCIDENT_ACKNOWLEDGEMENT_CODES = new Set<MigrationIncidentAcknowledgementCode>([
  "investigation_started", "external_dependency_engaged", "runbook_in_progress",
]);

export class MigrationIncidentRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async escalateExhausted(limit = 20): Promise<MigrationIncidentRecord[]> {
    const bounded = boundedInteger(limit, 20, 1, 100, "incident escalation limit");
    const result = await this.tx.query(
      `INSERT INTO migration_incidents
         (organization_id, migration_job_id, project_id, environment, change_set_id,
          detected_review_cycle, detected_reconciliation_attempt)
       SELECT $1, job.id, job.project_id, job.environment, job.change_set_id,
              job.review_cycle_count, job.reconciliation_attempt_count
       FROM (
         SELECT id, project_id, environment, change_set_id, review_cycle_count,
                reconciliation_attempt_count, finished_at
         FROM migration_jobs
         WHERE organization_id = $1 AND status = 'review_required'
           AND reconciliation_required
           AND review_cycle_count >= max_review_cycles
         ORDER BY finished_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       ) AS job
       ON CONFLICT (organization_id, migration_job_id) DO NOTHING
       RETURNING ${MIGRATION_INCIDENT_COLUMNS}`,
      [this.tx.organizationId, bounded],
    );
    const incidents = result.rows.map(migrationIncidentFromRow);
    if (incidents.length > 0) {
      await this.tx.query(
        `INSERT INTO migration_incident_outbox
           (organization_id, migration_incident_id, event_type)
         SELECT $1, incident_id, 'migration.incident.opened'
         FROM unnest($2::uuid[]) AS incident_id
         ON CONFLICT (organization_id, migration_incident_id, event_type) DO NOTHING`,
        [this.tx.organizationId, incidents.map((incident) => incident.id)],
      );
    }
    return incidents;
  }

  async list(input: {
    projectId?: string;
    status?: MigrationIncidentStatus;
    limit?: number;
  } = {}): Promise<MigrationIncidentRecord[]> {
    const limit = boundedLimit(input.limit, 100);
    const result = await this.tx.query(
      `SELECT ${MIGRATION_INCIDENT_COLUMNS}
       FROM migration_incidents
       WHERE organization_id = $1
         AND ($2::uuid IS NULL OR project_id = $2)
         AND ($3::qkern_migration_incident_status IS NULL OR status = $3)
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [this.tx.organizationId, input.projectId ?? null, input.status ?? null, limit],
    );
    return result.rows.map(migrationIncidentFromRow);
  }

  async get(incidentId: string): Promise<MigrationIncidentRecord> {
    const result = await this.tx.query(
      `SELECT ${MIGRATION_INCIDENT_COLUMNS}
       FROM migration_incidents
       WHERE organization_id = $1 AND id = $2`,
      [this.tx.organizationId, incidentId],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("Migration incident");
    return migrationIncidentFromRow(result.rows[0]);
  }

  async acknowledge(
    incidentId: string,
    acknowledgedBy: string,
    acknowledgementCode: MigrationIncidentAcknowledgementCode,
  ): Promise<{ incident: MigrationIncidentRecord; created: boolean }> {
    workerReference(acknowledgedBy);
    if (!MIGRATION_INCIDENT_ACKNOWLEDGEMENT_CODES.has(acknowledgementCode)) {
      throw new InvalidRecordError("Invalid incident acknowledgement code.");
    }
    const updated = await this.tx.query(
      `UPDATE migration_incidents
       SET status = 'acknowledged',
           acknowledgement_code = $3::qkern_migration_incident_acknowledgement_code
       WHERE organization_id = $1 AND id = $2 AND status = 'open'
       RETURNING ${MIGRATION_INCIDENT_COLUMNS}`,
      [this.tx.organizationId, incidentId, acknowledgementCode],
    );
    if (updated.rows[0]) return { incident: migrationIncidentFromRow(updated.rows[0]), created: true };
    const existing = await this.tx.query(
      `SELECT ${MIGRATION_INCIDENT_COLUMNS}
       FROM migration_incidents
       WHERE organization_id = $1 AND id = $2`,
      [this.tx.organizationId, incidentId],
    );
    if (!existing.rows[0]) throw new ResourceNotFoundError("Migration incident");
    const incident = migrationIncidentFromRow(existing.rows[0]);
    if (incident.status !== "acknowledged") throw new InvalidRecordError("Migration incident changed during acknowledgement.");
    return { incident, created: false };
  }

  async resolveAppliedJob(migrationJobId: string): Promise<MigrationIncidentRecord | null> {
    const updated = await this.tx.query(
      `UPDATE migration_incidents
       SET status = 'resolved',
           resolution_code = 'target_ledger_match'::qkern_migration_incident_resolution_code
       WHERE organization_id = $1 AND migration_job_id = $2
         AND status IN ('open', 'acknowledged')
       RETURNING ${MIGRATION_INCIDENT_COLUMNS}`,
      [this.tx.organizationId, migrationJobId],
    );
    return updated.rows[0] ? migrationIncidentFromRow(updated.rows[0]) : null;
  }
}

const MIGRATION_INCIDENT_OUTBOX_COLUMNS = `
  event.id, event.organization_id, event.migration_incident_id, event.event_type,
  event.status, event.attempt_count, event.failure_count, event.max_failures,
  event.last_failure_code, event.dead_lettered_at, event.retry_cycle_count,
  event.max_retry_cycles, event.available_at, event.lease_owner,
  event.lease_token, event.lease_expires_at, event.published_at,
  event.created_at, event.updated_at,
  incident.migration_job_id, incident.project_id, incident.environment,
  incident.change_set_id, incident.kind AS incident_kind,
  incident.severity AS incident_severity, incident.created_at AS incident_created_at`;

const MIGRATION_INCIDENT_DELIVERY_COMMAND_COLUMNS = `
  id, organization_id, migration_incident_id, requested_by, reason_code,
  expected_failure_code, expected_retry_cycle, status, processed_at, created_at, updated_at`;

export class MigrationIncidentDeliveryCommandRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async enqueue(
    incidentId: string,
    requestedBy: string,
    reasonCode: MigrationIncidentDeliveryRetryReason,
    expectedFailureCode: MigrationIncidentDeliveryFailureCode,
    expectedRetryCycle: number,
  ): Promise<{ command: MigrationIncidentDeliveryCommandRecord; created: boolean }> {
    const actor = workerReference(requestedBy);
    if (!isMigrationIncidentDeliveryRetryReason(reasonCode) ||
        !isMigrationIncidentDeliveryFailureCode(expectedFailureCode) ||
        !isCompatibleIncidentDeliveryRetry(reasonCode, expectedFailureCode) ||
        !Number.isSafeInteger(expectedRetryCycle) || expectedRetryCycle < 0 || expectedRetryCycle > 10) {
      throw new InvalidRecordError("Invalid incident delivery retry reason code.");
    }
    const inserted = await this.tx.query(
      `INSERT INTO migration_incident_delivery_commands
         (organization_id, migration_incident_id, requested_by, reason_code,
          expected_failure_code, expected_retry_cycle)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, migration_incident_id) WHERE status = 'pending' DO NOTHING
       RETURNING ${MIGRATION_INCIDENT_DELIVERY_COMMAND_COLUMNS}`,
      [this.tx.organizationId, incidentId, actor, reasonCode, expectedFailureCode, expectedRetryCycle],
    );
    if (inserted.rows[0]) {
      return { command: migrationIncidentDeliveryCommandFromRow(inserted.rows[0]), created: true };
    }
    const existing = await this.tx.query(
      `SELECT ${MIGRATION_INCIDENT_DELIVERY_COMMAND_COLUMNS}
       FROM migration_incident_delivery_commands
       WHERE organization_id = $1 AND migration_incident_id = $2 AND status = 'pending'`,
      [this.tx.organizationId, incidentId],
    );
    if (!existing.rows[0]) throw new MigrationNotReadyError();
    const command = migrationIncidentDeliveryCommandFromRow(existing.rows[0]);
    if (command.reasonCode !== reasonCode || command.expectedFailureCode !== expectedFailureCode ||
        command.expectedRetryCycle !== expectedRetryCycle) {
      throw new MigrationNotReadyError();
    }
    return { command, created: false };
  }

  async processPending(limit = 20): Promise<MigrationIncidentDeliveryRetryProcessingResult[]> {
    const bounded = boundedInteger(limit, 20, 1, 100, "incident delivery command limit");
    const pending = await this.tx.query(
      `SELECT ${MIGRATION_INCIDENT_DELIVERY_COMMAND_COLUMNS}
       FROM migration_incident_delivery_commands
       WHERE organization_id = $1 AND status = 'pending'
       ORDER BY created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [this.tx.organizationId, bounded],
    );
    const processed: MigrationIncidentDeliveryRetryProcessingResult[] = [];
    for (const row of pending.rows) {
      const command = migrationIncidentDeliveryCommandFromRow(row);
      const requeued = await this.tx.query(
        `WITH updated AS (
           UPDATE migration_incident_outbox
           SET status = 'pending', failure_count = 0, last_failure_code = NULL,
               dead_lettered_at = NULL, retry_cycle_count = retry_cycle_count + 1,
               available_at = now(), lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, updated_at = now()
           WHERE organization_id = $1 AND migration_incident_id = $2
             AND status = 'dead_lettered' AND retry_cycle_count < max_retry_cycles
             AND last_failure_code = $3
             AND retry_cycle_count = $4
           RETURNING *
         )
         SELECT ${MIGRATION_INCIDENT_OUTBOX_COLUMNS}
         FROM updated AS event
         JOIN migration_incidents AS incident
           ON incident.organization_id = event.organization_id AND incident.id = event.migration_incident_id`,
        [
          this.tx.organizationId,
          command.migrationIncidentId,
          command.expectedFailureCode,
          command.expectedRetryCycle,
        ],
      );
      const event = requeued.rows[0] ? migrationIncidentOutboxFromRow(requeued.rows[0]) : null;
      const completed = await this.tx.query(
        `UPDATE migration_incident_delivery_commands
         SET status = $3::qkern_migration_incident_delivery_command_status,
             processed_at = now(), updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'
         RETURNING ${MIGRATION_INCIDENT_DELIVERY_COMMAND_COLUMNS}`,
        [this.tx.organizationId, command.id, event ? "applied" : "rejected"],
      );
      if (!completed.rows[0]) throw new InvalidRecordError("The incident delivery command changed while locked.");
      processed.push({
        commandId: command.id,
        incidentId: command.migrationIncidentId,
        outcome: event ? "applied" : "rejected",
        ...(command.expectedFailureCode ? { failureCode: command.expectedFailureCode } : {}),
        ...(command.expectedRetryCycle !== null ? { expectedRetryCycle: command.expectedRetryCycle } : {}),
        ...(event ? { eventId: event.id, retryCycle: event.retryCycleCount } : {}),
      });
    }
    return processed;
  }
}

export class MigrationIncidentDeliveryVisibilityRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async listStatuses(incidentIds: readonly string[]): Promise<MigrationIncidentDeliveryStatusRecord[]> {
    const ids = [...new Set(incidentIds)];
    if (ids.length === 0) return [];
    if (ids.length > 100) throw new InvalidRecordError("At most 100 incident delivery states can be read.");
    const result = await this.tx.query(
      `SELECT migration_incident_id, event_id, delivery_status, attempt_count,
              failure_count, max_failures, last_failure_code, dead_lettered_at,
              retry_cycle_count, max_retry_cycles, available_at, published_at,
              retry_command_pending
       FROM qkern_migration_incident_delivery_statuses($1::uuid[])`,
      [ids],
    );
    return result.rows.map(migrationIncidentDeliveryStatusFromRow);
  }

  async health(): Promise<MigrationIncidentDeliveryHealthRecord> {
    const result = await this.tx.query(
      `SELECT total_count, pending_count, ready_count, scheduled_count,
              in_flight_count, overdue_pending_count, expired_lease_count,
              recovery_pending_count, published_count, dead_lettered_count,
              recovery_exhausted_count, pending_retry_command_count,
              active_failure_count, active_publish_failed_count,
              active_invalid_ack_count, active_signing_key_unavailable_count,
              active_delivery_timeout_count, active_destination_rejected_count,
              oldest_pending_at, oldest_dead_lettered_at,
              latest_dead_lettered_at, measured_at
       FROM qkern_migration_incident_delivery_health()`,
    );
    if (!result.rows[0] || result.rows.length !== 1) {
      throw new InvalidRecordError("Incident delivery health is unavailable.");
    }
    return migrationIncidentDeliveryHealthFromRow(result.rows[0]);
  }
}

export class MigrationIncidentOutboxRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async claimNext(publisherId: string, leaseDurationMs = 30_000): Promise<MigrationIncidentOutboxRecord | null> {
    const owner = workerReference(publisherId);
    const leaseMs = boundedInteger(leaseDurationMs, 30_000, 1_000, 900_000, "incident outbox leaseDurationMs");
    const result = await this.tx.query(
      `WITH candidate AS (
         SELECT id AS candidate_id
         FROM migration_incident_outbox
         WHERE organization_id = $1 AND status = 'pending' AND available_at <= now()
           AND (lease_expires_at IS NULL OR lease_expires_at <= now())
         ORDER BY available_at ASC, created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       ), updated AS (
         UPDATE migration_incident_outbox AS pending
         SET attempt_count = pending.attempt_count + 1, lease_owner = $2,
             lease_token = gen_random_uuid(),
             lease_expires_at = now() + ($3::integer * interval '1 millisecond'), updated_at = now()
         FROM candidate
         WHERE pending.organization_id = $1 AND pending.id = candidate.candidate_id
         RETURNING pending.*
       )
       SELECT ${MIGRATION_INCIDENT_OUTBOX_COLUMNS}
       FROM updated AS event
       JOIN migration_incidents AS incident
         ON incident.organization_id = event.organization_id AND incident.id = event.migration_incident_id`,
      [this.tx.organizationId, owner, leaseMs],
    );
    return result.rows[0] ? migrationIncidentOutboxFromRow(result.rows[0]) : null;
  }

  async markPublished(
    eventId: string,
    publisherId: string,
    leaseToken: string,
  ): Promise<MigrationIncidentOutboxRecord> {
    const owner = workerReference(publisherId);
    const result = await this.tx.query(
      `WITH updated AS (
         UPDATE migration_incident_outbox
         SET status = 'published', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
             published_at = now(), updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'
           AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
         RETURNING *
       )
       SELECT ${MIGRATION_INCIDENT_OUTBOX_COLUMNS}
       FROM updated AS event
       JOIN migration_incidents AS incident
         ON incident.organization_id = event.organization_id AND incident.id = event.migration_incident_id`,
      [this.tx.organizationId, eventId, owner, leaseToken],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    return migrationIncidentOutboxFromRow(result.rows[0]);
  }

  async recordFailure(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    failureCode: MigrationIncidentDeliveryFailureCode,
    backoffMs = 5_000,
  ): Promise<MigrationIncidentOutboxRecord> {
    const owner = workerReference(publisherId);
    if (!isMigrationIncidentDeliveryFailureCode(failureCode)) {
      throw new InvalidRecordError("Invalid incident outbox failure code.");
    }
    const delay = boundedInteger(backoffMs, 5_000, 0, 86_400_000, "incident outbox backoffMs");
    const result = await this.tx.query(
      `WITH updated AS (
         UPDATE migration_incident_outbox
         SET failure_count = failure_count + 1,
             last_failure_code = $5,
             status = CASE WHEN failure_count + 1 >= max_failures
               THEN 'dead_lettered'::qkern_outbox_status ELSE 'pending'::qkern_outbox_status END,
             dead_lettered_at = CASE WHEN failure_count + 1 >= max_failures THEN now() ELSE NULL END,
             available_at = CASE WHEN failure_count + 1 >= max_failures
               THEN available_at ELSE now() + ($6::integer * interval '1 millisecond') END,
             lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'
           AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
         RETURNING *
       )
       SELECT ${MIGRATION_INCIDENT_OUTBOX_COLUMNS}
       FROM updated AS event
       JOIN migration_incidents AS incident
         ON incident.organization_id = event.organization_id AND incident.id = event.migration_incident_id`,
      [this.tx.organizationId, eventId, owner, leaseToken, failureCode, delay],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    return migrationIncidentOutboxFromRow(result.rows[0]);
  }

  async releaseWithBackoff(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    backoffMs = 5_000,
  ): Promise<MigrationIncidentOutboxRecord> {
    const owner = workerReference(publisherId);
    const delay = boundedInteger(backoffMs, 5_000, 0, 86_400_000, "incident outbox backoffMs");
    const result = await this.tx.query(
      `WITH updated AS (
         UPDATE migration_incident_outbox
         SET available_at = now() + ($5::integer * interval '1 millisecond'),
             lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'
           AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
         RETURNING *
       )
       SELECT ${MIGRATION_INCIDENT_OUTBOX_COLUMNS}
       FROM updated AS event
       JOIN migration_incidents AS incident
         ON incident.organization_id = event.organization_id AND incident.id = event.migration_incident_id`,
      [this.tx.organizationId, eventId, owner, leaseToken, delay],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    return migrationIncidentOutboxFromRow(result.rows[0]);
  }
}

const MIGRATION_OUTBOX_COLUMNS = `
  id, organization_id, migration_job_id, event_type, status, attempt_count,
  failure_count, max_failures, last_failure_code, dead_lettered_at,
  retry_cycle_count, max_retry_cycles,
  available_at, lease_owner, lease_token, lease_expires_at, published_at,
  created_at, updated_at`;

const MIGRATION_OUTBOX_DELIVERY_COMMAND_COLUMNS = `
  id, organization_id, migration_job_id, requested_by, reason_code,
  expected_failure_code, expected_retry_cycle, status, processed_at,
  created_at, updated_at`;

export class MigrationOutboxDeliveryCommandRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async enqueue(
    migrationJobId: string,
    requestedBy: string,
    reasonCode: MigrationOutboxDeliveryRetryReason,
    expectedFailureCode: MigrationOutboxDeliveryFailureCode,
    expectedRetryCycle: number,
  ): Promise<{ command: MigrationOutboxDeliveryCommandRecord; created: boolean }> {
    const actor = workerReference(requestedBy);
    if (!isMigrationOutboxDeliveryRetryReason(reasonCode) ||
        !isMigrationOutboxDeliveryFailureCode(expectedFailureCode) ||
        !isCompatibleMigrationOutboxDeliveryRetry(reasonCode, expectedFailureCode) ||
        !Number.isSafeInteger(expectedRetryCycle) || expectedRetryCycle < 0 || expectedRetryCycle > 10) {
      throw new InvalidRecordError("Invalid migration delivery retry request.");
    }
    const inserted = await this.tx.query(
      `INSERT INTO migration_outbox_delivery_commands
         (organization_id, migration_job_id, requested_by, reason_code,
          expected_failure_code, expected_retry_cycle)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, migration_job_id) WHERE status = 'pending' DO NOTHING
       RETURNING ${MIGRATION_OUTBOX_DELIVERY_COMMAND_COLUMNS}`,
      [this.tx.organizationId, migrationJobId, actor, reasonCode, expectedFailureCode, expectedRetryCycle],
    );
    if (inserted.rows[0]) {
      return { command: migrationOutboxDeliveryCommandFromRow(inserted.rows[0]), created: true };
    }
    const existing = await this.tx.query(
      `SELECT ${MIGRATION_OUTBOX_DELIVERY_COMMAND_COLUMNS}
       FROM migration_outbox_delivery_commands
       WHERE organization_id = $1 AND migration_job_id = $2 AND status = 'pending'`,
      [this.tx.organizationId, migrationJobId],
    );
    if (!existing.rows[0]) throw new MigrationNotReadyError();
    const command = migrationOutboxDeliveryCommandFromRow(existing.rows[0]);
    if (command.reasonCode !== reasonCode || command.expectedFailureCode !== expectedFailureCode ||
        command.expectedRetryCycle !== expectedRetryCycle) {
      throw new MigrationNotReadyError();
    }
    return { command, created: false };
  }

  async processPending(limit = 20): Promise<MigrationOutboxDeliveryRetryProcessingResult[]> {
    const bounded = boundedInteger(limit, 20, 1, 100, "migration delivery command limit");
    const pending = await this.tx.query(
      `SELECT ${MIGRATION_OUTBOX_DELIVERY_COMMAND_COLUMNS}
       FROM migration_outbox_delivery_commands
       WHERE organization_id = $1 AND status = 'pending'
       ORDER BY created_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [this.tx.organizationId, bounded],
    );
    const processed: MigrationOutboxDeliveryRetryProcessingResult[] = [];
    for (const row of pending.rows) {
      const command = migrationOutboxDeliveryCommandFromRow(row);
      const requeued = await this.tx.query(
        `UPDATE migration_outbox
         SET status = 'pending', failure_count = 0, last_failure_code = NULL,
             dead_lettered_at = NULL, retry_cycle_count = retry_cycle_count + 1,
             available_at = now(), lease_owner = NULL, lease_token = NULL,
             lease_expires_at = NULL, updated_at = now()
         WHERE organization_id = $1 AND migration_job_id = $2
           AND status = 'dead_lettered' AND retry_cycle_count < max_retry_cycles
           AND last_failure_code = $3 AND retry_cycle_count = $4
         RETURNING ${MIGRATION_OUTBOX_COLUMNS}`,
        [
          this.tx.organizationId,
          command.migrationJobId,
          command.expectedFailureCode,
          command.expectedRetryCycle,
        ],
      );
      const event = requeued.rows[0] ? migrationOutboxFromRow(requeued.rows[0]) : null;
      const completed = await this.tx.query(
        `UPDATE migration_outbox_delivery_commands
         SET status = $3::qkern_migration_outbox_delivery_command_status,
             processed_at = now(), updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'
         RETURNING ${MIGRATION_OUTBOX_DELIVERY_COMMAND_COLUMNS}`,
        [this.tx.organizationId, command.id, event ? "applied" : "rejected"],
      );
      if (!completed.rows[0]) throw new InvalidRecordError("The migration delivery command changed while locked.");
      processed.push({
        commandId: command.id,
        migrationJobId: command.migrationJobId,
        outcome: event ? "applied" : "rejected",
        failureCode: command.expectedFailureCode,
        expectedRetryCycle: command.expectedRetryCycle,
        ...(event ? { eventId: event.id, retryCycle: event.retryCycleCount } : {}),
      });
    }
    return processed;
  }
}

export class MigrationOutboxDeliveryVisibilityRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async health(): Promise<MigrationOutboxDeliveryHealthRecord> {
    const result = await this.tx.query(
      `SELECT total_count, pending_count, ready_count, scheduled_count,
              in_flight_count, overdue_pending_count, expired_lease_count,
              recovery_pending_count, published_count, dead_lettered_count,
              recovery_exhausted_count, pending_retry_command_count,
              active_failure_count, active_publish_failed_count,
              active_invalid_ack_count, active_signing_key_unavailable_count,
              active_delivery_timeout_count, active_destination_rejected_count,
              oldest_pending_at, oldest_dead_lettered_at,
              latest_dead_lettered_at, measured_at
       FROM qkern_migration_outbox_delivery_health()`,
    );
    if (!result.rows[0] || result.rows.length !== 1) {
      throw new InvalidRecordError("Migration delivery health is unavailable.");
    }
    return migrationOutboxDeliveryHealthFromRow(result.rows[0]);
  }

  async status(migrationJobId: string): Promise<MigrationOutboxDeliveryStatusRecord> {
    const result = await this.tx.query(
      `SELECT migration_job_id, event_id, delivery_status, attempt_count,
              failure_count, max_failures, last_failure_code, dead_lettered_at,
              retry_cycle_count, max_retry_cycles, available_at, published_at,
              retry_command_pending
       FROM qkern_migration_outbox_delivery_status($1::uuid)`,
      [migrationJobId],
    );
    if (!result.rows[0] || result.rows.length !== 1) {
      throw new ResourceNotFoundError("Migration delivery");
    }
    return migrationOutboxDeliveryStatusFromRow(result.rows[0]);
  }
}

export class MigrationOutboxRepository {
  constructor(private readonly tx: TenantTransaction) {}

  async claimNext(publisherId: string, leaseDurationMs = 30_000): Promise<MigrationOutboxRecord | null> {
    const owner = workerReference(publisherId);
    const leaseMs = boundedInteger(leaseDurationMs, 30_000, 1_000, 900_000, "leaseDurationMs");
    const result = await this.tx.query(
      `WITH candidate AS (
         SELECT id AS candidate_id
         FROM migration_outbox
         WHERE organization_id = $1 AND status = 'pending' AND available_at <= now()
           AND (lease_expires_at IS NULL OR lease_expires_at <= now())
         ORDER BY available_at ASC, created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE migration_outbox AS event
       SET attempt_count = event.attempt_count + 1, lease_owner = $2,
           lease_token = gen_random_uuid(),
           lease_expires_at = now() + ($3::integer * interval '1 millisecond'), updated_at = now()
       FROM candidate
       WHERE event.organization_id = $1 AND event.id = candidate.candidate_id
       RETURNING ${MIGRATION_OUTBOX_COLUMNS}`,
      [this.tx.organizationId, owner, leaseMs],
    );
    return result.rows[0] ? migrationOutboxFromRow(result.rows[0]) : null;
  }

  async renewLease(eventId: string, publisherId: string, leaseToken: string, leaseDurationMs = 30_000): Promise<MigrationOutboxRecord> {
    const owner = workerReference(publisherId);
    const leaseMs = boundedInteger(leaseDurationMs, 30_000, 1_000, 900_000, "leaseDurationMs");
    const result = await this.tx.query(
      `UPDATE migration_outbox
       SET lease_expires_at = now() + ($5::integer * interval '1 millisecond'), updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'pending'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${MIGRATION_OUTBOX_COLUMNS}`,
      [this.tx.organizationId, eventId, owner, leaseToken, leaseMs],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    return migrationOutboxFromRow(result.rows[0]);
  }

  async markPublished(eventId: string, publisherId: string, leaseToken: string): Promise<MigrationOutboxRecord> {
    const owner = workerReference(publisherId);
    const result = await this.tx.query(
      `UPDATE migration_outbox
       SET status = 'published', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           published_at = now(), updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'pending'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${MIGRATION_OUTBOX_COLUMNS}`,
      [this.tx.organizationId, eventId, owner, leaseToken],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    return migrationOutboxFromRow(result.rows[0]);
  }

  async recordFailure(
    eventId: string,
    publisherId: string,
    leaseToken: string,
    failureCode: MigrationOutboxDeliveryFailureCode,
    backoffMs = 5_000,
  ): Promise<MigrationOutboxRecord> {
    const owner = workerReference(publisherId);
    if (!isMigrationOutboxDeliveryFailureCode(failureCode)) {
      throw new InvalidRecordError("Invalid migration outbox failure code.");
    }
    const delay = boundedInteger(backoffMs, 5_000, 0, 86_400_000, "migration outbox backoffMs");
    const result = await this.tx.query(
      `UPDATE migration_outbox
       SET failure_count = failure_count + 1,
           last_failure_code = $5,
           status = CASE WHEN failure_count + 1 >= max_failures
             THEN 'dead_lettered'::qkern_outbox_status ELSE 'pending'::qkern_outbox_status END,
           dead_lettered_at = CASE WHEN failure_count + 1 >= max_failures THEN now() ELSE NULL END,
           available_at = CASE WHEN failure_count + 1 >= max_failures
             THEN available_at ELSE now() + ($6::integer * interval '1 millisecond') END,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'pending'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${MIGRATION_OUTBOX_COLUMNS}`,
      [this.tx.organizationId, eventId, owner, leaseToken, failureCode, delay],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    return migrationOutboxFromRow(result.rows[0]);
  }

  async releaseWithBackoff(eventId: string, publisherId: string, leaseToken: string, backoffMs = 5_000): Promise<MigrationOutboxRecord> {
    const owner = workerReference(publisherId);
    const delay = boundedInteger(backoffMs, 5_000, 0, 86_400_000, "backoffMs");
    const result = await this.tx.query(
      `UPDATE migration_outbox
       SET available_at = now() + ($5::integer * interval '1 millisecond'),
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE organization_id = $1 AND id = $2 AND status = 'pending'
         AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${MIGRATION_OUTBOX_COLUMNS}`,
      [this.tx.organizationId, eventId, owner, leaseToken, delay],
    );
    if (!result.rows[0]) throw new MigrationLeaseLostError();
    return migrationOutboxFromRow(result.rows[0]);
  }
}

export class ControlPlaneRepositories {
  readonly organizations: OrganizationRepository;
  readonly projects: ProjectRepository;
  readonly environments: ProjectEnvironmentRepository;
  readonly projectDatabaseProvisioning: ProjectDatabaseProvisioningRepository;
  readonly projectDatabaseBindings: ProjectDatabaseBindingRepository;
  readonly changeSets: ChangeSetRepository;
  readonly approvals: ApprovalRepository;
  readonly automationPolicies: ProjectAutomationPolicyRepository;
  readonly audit: AuditRepository;
  readonly migrationJobs: MigrationJobRepository;
  readonly migrationReviewCommands: MigrationReviewCommandRepository;
  readonly migrationIncidentResolutionCommands: MigrationIncidentResolutionCommandRepository;
  readonly migrationIncidents: MigrationIncidentRepository;
  readonly migrationIncidentDeliveryCommands: MigrationIncidentDeliveryCommandRepository;
  readonly migrationIncidentDeliveryVisibility: MigrationIncidentDeliveryVisibilityRepository;
  readonly migrationIncidentOutbox: MigrationIncidentOutboxRepository;
  readonly migrationOutboxDeliveryCommands: MigrationOutboxDeliveryCommandRepository;
  readonly migrationOutboxDeliveryVisibility: MigrationOutboxDeliveryVisibilityRepository;
  readonly migrationOutbox: MigrationOutboxRepository;

  constructor(readonly transaction: TenantTransaction) {
    this.organizations = new OrganizationRepository(transaction);
    this.projects = new ProjectRepository(transaction);
    this.environments = new ProjectEnvironmentRepository(transaction);
    this.projectDatabaseProvisioning = new ProjectDatabaseProvisioningRepository(transaction);
    this.projectDatabaseBindings = new ProjectDatabaseBindingRepository(transaction);
    this.changeSets = new ChangeSetRepository(transaction);
    this.approvals = new ApprovalRepository(transaction);
    this.automationPolicies = new ProjectAutomationPolicyRepository(transaction);
    this.audit = new AuditRepository(transaction);
    this.migrationJobs = new MigrationJobRepository(transaction);
    this.migrationReviewCommands = new MigrationReviewCommandRepository(transaction);
    this.migrationIncidentResolutionCommands = new MigrationIncidentResolutionCommandRepository(transaction);
    this.migrationIncidents = new MigrationIncidentRepository(transaction);
    this.migrationIncidentDeliveryCommands = new MigrationIncidentDeliveryCommandRepository(transaction);
    this.migrationIncidentDeliveryVisibility = new MigrationIncidentDeliveryVisibilityRepository(transaction);
    this.migrationIncidentOutbox = new MigrationIncidentOutboxRepository(transaction);
    this.migrationOutboxDeliveryCommands = new MigrationOutboxDeliveryCommandRepository(transaction);
    this.migrationOutboxDeliveryVisibility = new MigrationOutboxDeliveryVisibilityRepository(transaction);
    this.migrationOutbox = new MigrationOutboxRepository(transaction);
  }

  assertOrganization(organizationId: string): void {
    assertTenantResourceId(this.transaction.organizationId, organizationId);
  }
}

export class PostgresControlPlane {
  constructor(private readonly pool: SqlPool) {}

  withTenant<T>(context: TenantContext, operation: (repositories: ControlPlaneRepositories) => Promise<T>): Promise<T> {
    return withTenantTransaction(this.pool, context, (transaction) => operation(new ControlPlaneRepositories(transaction)));
  }
}
