import { describe, expect, it } from "vitest";
import { MigrationLeaseLostError, MigrationNotReadyError } from "@/lib/server/db/errors";
import {
  MigrationIncidentDeliveryCommandRepository,
  MigrationIncidentDeliveryVisibilityRepository,
  MigrationIncidentOutboxRepository,
  MigrationIncidentRepository,
  MigrationIncidentResolutionCommandRepository,
  MigrationJobRepository,
  MigrationOutboxRepository,
  MigrationReviewCommandRepository,
} from "@/lib/server/db/repositories";
import type { SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import type { TenantTransaction } from "@/lib/server/db/transaction";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const PROJECT_ID = "9730b448-7fd0-4c4f-9553-33220752bdf6";
const CHANGE_SET_ID = "9a973ec8-a409-4706-ad1d-ef6360ea430d";
const APPROVAL_ID = "51d01a8e-99da-4d95-8e17-f107267f72cf";
const JOB_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const EVENT_ID = "412cb46b-6313-4a74-8480-9d9e9e240e36";
const REVIEW_COMMAND_ID = "f9b450be-f81c-41ef-9646-c11e8ed850d9";
const INCIDENT_ID = "46e84eba-2e7a-42e6-a010-0fbf0c3de6ce";
const INCIDENT_EVENT_ID = "d594a341-2637-42ca-804a-ab98537734b6";
const DELIVERY_COMMAND_ID = "cb4ebc91-8dab-4ae5-acb7-2412c6cabedd";
const RESOLUTION_COMMAND_ID = "87a5a4fc-6dd7-4aa8-9955-e3e8bc7d34b5";
const LEASE_TOKEN = "a742d2d4-d8fc-4353-918d-b5b1f3a3959d";
const CREATED_AT = "2026-07-17T12:00:00.000Z";

class QueueTransaction implements TenantTransaction {
  readonly organizationId = ORGANIZATION_ID;
  readonly calls: Array<{ text: string; values?: readonly SqlValue[] }> = [];
  constructor(private readonly responses: Array<Record<string, unknown>[]>) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const rows = this.responses.shift() ?? [];
    return { rows: rows as Row[], rowCount: rows.length };
  }
}

function jobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: JOB_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    environment: "production",
    database_instance_ref: "managed:database-1",
    change_set_id: CHANGE_SET_ID,
    approval_request_id: APPROVAL_ID,
    claim_sequence: "0",
    status: "queued",
    attempt_count: 0,
    max_attempts: 5,
    reconciliation_required: false,
    reconciliation_attempt_count: 0,
    max_reconciliation_attempts: 3,
    review_cycle_count: 0,
    max_review_cycles: 3,
    available_at: CREATED_AT,
    lease_owner: null,
    lease_token: null,
    lease_expires_at: null,
    last_error_code: null,
    last_error_message: null,
    started_at: null,
    finished_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function outboxRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EVENT_ID,
    organization_id: ORGANIZATION_ID,
    migration_job_id: JOB_ID,
    event_type: "migration.apply.requested",
    status: "pending",
    attempt_count: 1,
    failure_count: 0,
    max_failures: 8,
    last_failure_code: null,
    dead_lettered_at: null,
    retry_cycle_count: 0,
    max_retry_cycles: 3,
    available_at: CREATED_AT,
    lease_owner: "publisher-1",
    lease_token: LEASE_TOKEN,
    lease_expires_at: "2099-01-01T00:00:00.000Z",
    published_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function reviewCommandRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REVIEW_COMMAND_ID,
    organization_id: ORGANIZATION_ID,
    migration_job_id: JOB_ID,
    requested_by: "owner@qkern.test",
    reason_code: "manual_recheck",
    status: "pending",
    processed_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function incidentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INCIDENT_ID,
    organization_id: ORGANIZATION_ID,
    migration_job_id: JOB_ID,
    project_id: PROJECT_ID,
    environment: "production",
    change_set_id: CHANGE_SET_ID,
    kind: "migration_outcome_unresolved",
    severity: "critical",
    status: "open",
    detected_review_cycle: 3,
    detected_reconciliation_attempt: 3,
    acknowledged_by: null,
    acknowledgement_code: null,
    acknowledged_at: null,
    resolved_by: null,
    resolution_code: null,
    resolved_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function incidentResolutionCommandRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RESOLUTION_COMMAND_ID,
    organization_id: ORGANIZATION_ID,
    migration_incident_id: INCIDENT_ID,
    requested_by: "owner@qkern.test",
    reason_code: "target_ledger_recheck",
    status: "pending",
    processed_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function incidentOutboxRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INCIDENT_EVENT_ID,
    organization_id: ORGANIZATION_ID,
    migration_incident_id: INCIDENT_ID,
    event_type: "migration.incident.opened",
    status: "pending",
    attempt_count: 1,
    failure_count: 0,
    max_failures: 8,
    last_failure_code: null,
    dead_lettered_at: null,
    retry_cycle_count: 0,
    max_retry_cycles: 3,
    available_at: CREATED_AT,
    lease_owner: "incident-publisher-1",
    lease_token: LEASE_TOKEN,
    lease_expires_at: "2099-01-01T00:00:00.000Z",
    published_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    migration_job_id: JOB_ID,
    project_id: PROJECT_ID,
    environment: "production",
    change_set_id: CHANGE_SET_ID,
    incident_kind: "migration_outcome_unresolved",
    incident_severity: "critical",
    incident_created_at: CREATED_AT,
    ...overrides,
  };
}

function incidentDeliveryCommandRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DELIVERY_COMMAND_ID,
    organization_id: ORGANIZATION_ID,
    migration_incident_id: INCIDENT_ID,
    requested_by: "owner@qkern.test",
    reason_code: "destination_recovered",
    expected_failure_code: "PUBLISH_FAILED",
    expected_retry_cycle: 0,
    status: "pending",
    processed_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function incidentDeliveryStatusRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    migration_incident_id: INCIDENT_ID,
    event_id: INCIDENT_EVENT_ID,
    delivery_status: "dead_lettered",
    attempt_count: 8,
    failure_count: 8,
    max_failures: 8,
    last_failure_code: "PUBLISH_FAILED",
    dead_lettered_at: CREATED_AT,
    retry_cycle_count: 1,
    max_retry_cycles: 3,
    available_at: CREATED_AT,
    published_at: null,
    retry_command_pending: true,
    ...overrides,
  };
}

function incidentDeliveryHealthRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    total_count: "3",
    pending_count: "1",
    ready_count: "1",
    scheduled_count: "0",
    in_flight_count: "0",
    overdue_pending_count: "1",
    expired_lease_count: "0",
    recovery_pending_count: "0",
    published_count: "1",
    dead_lettered_count: "1",
    recovery_exhausted_count: "0",
    pending_retry_command_count: "1",
    active_failure_count: "1",
    active_publish_failed_count: "1",
    active_invalid_ack_count: "0",
    active_signing_key_unavailable_count: "0",
    active_delivery_timeout_count: "0",
    active_destination_rejected_count: "0",
    oldest_pending_at: CREATED_AT,
    oldest_dead_lettered_at: CREATED_AT,
    latest_dead_lettered_at: CREATED_AT,
    measured_at: CREATED_AT,
    ...overrides,
  };
}

describe("migration apply queue repositories", () => {
  it("idempotently enqueues only an approved tenant Change Set and emits a reference-only outbox row", async () => {
    const transaction = new QueueTransaction([[], [], [jobRow()], []]);
    const result = await new MigrationJobRepository(transaction).enqueueApproved(
      CHANGE_SET_ID,
      APPROVAL_ID,
      { maxAttempts: 7 },
    );

    expect(result.created).toBe(true);
    expect(result.job.changeSetId).toBe(CHANGE_SET_ID);
    expect(transaction.calls[0].text).toContain("pg_advisory_xact_lock");
    expect(transaction.calls[2].text).toContain("status = 'approved'");
    expect(transaction.calls[2].text).not.toContain("encrypted_statement");
    expect(transaction.calls[3].text).toContain("ON CONFLICT (organization_id, migration_job_id, event_type) DO NOTHING");
    expect(transaction.calls[3].values).toEqual([ORGANIZATION_ID, JOB_ID]);
  });

  it("returns the stable existing job without inserting a duplicate", async () => {
    const transaction = new QueueTransaction([[], [jobRow({ status: "applied", finished_at: CREATED_AT })], []]);
    const result = await new MigrationJobRepository(transaction).enqueueApproved(CHANGE_SET_ID, APPROVAL_ID);

    expect(result).toMatchObject({ created: false, job: { id: JOB_ID, status: "applied" } });
    expect(transaction.calls).toHaveLength(3);
    expect(transaction.calls.some((call) => call.text.startsWith("INSERT INTO migration_jobs"))).toBe(false);
  });

  it("claims with SKIP LOCKED and advances the fenced attempt lease", async () => {
    const running = jobRow({
      status: "running",
      attempt_count: 1,
      lease_owner: "worker-1",
      lease_token: LEASE_TOKEN,
      lease_expires_at: "2099-01-01T00:00:00.000Z",
      started_at: CREATED_AT,
    });
    const transaction = new QueueTransaction([[running]]);
    const job = await new MigrationJobRepository(transaction).claimNext("worker-1", 45_000);

    expect(job).toMatchObject({ id: JOB_ID, status: "running", attemptCount: 1, leaseToken: LEASE_TOKEN, reclaimed: false });
    expect(transaction.calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(transaction.calls[0].text).toContain("least(job.attempt_count + 1, job.max_attempts)");
    expect(transaction.calls[0].text).toContain("job.reconciliation_attempt_count + 1");
    expect(transaction.calls[0].text).toContain("claim_sequence = job.claim_sequence + 1");
    expect(transaction.calls[0].values).toEqual([ORGANIZATION_ID, "worker-1", 45_000]);
  });

  it("reclaims an expired final lease for target-ledger reconciliation instead of falsely failing it", async () => {
    const running = jobRow({
      status: "running", attempt_count: 5, max_attempts: 5,
      claim_sequence: "42",
      lease_owner: "lost-worker", lease_token: LEASE_TOKEN,
      lease_expires_at: "2000-01-01T00:00:00.000Z", started_at: CREATED_AT,
      reclaimed: true,
    });
    const transaction = new QueueTransaction([[running]]);
    const reclaimed = await new MigrationJobRepository(transaction).claimNext("reconciler", 45_000);
    expect(reclaimed).toMatchObject({
      status: "running", attemptCount: 5, maxAttempts: 5, claimSequence: "42", reclaimed: true,
    });
    expect(transaction.calls[0].text).not.toContain("LEASE_ATTEMPTS_EXHAUSTED");
  });

  it("quarantines an expired reconciliation at its persisted attempt bound", async () => {
    const reviewed = jobRow({
      status: "review_required", attempt_count: 1,
      reconciliation_required: true, reconciliation_attempt_count: 3, max_reconciliation_attempts: 3,
      last_error_code: "RECONCILIATION_ATTEMPTS_EXHAUSTED", finished_at: CREATED_AT,
    });
    const transaction = new QueueTransaction([[reviewed]]);
    const result = await new MigrationJobRepository(transaction).quarantineExpiredReconciliations();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ status: "review_required", reconciliationAttemptCount: 3 });
    expect(transaction.calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(transaction.calls[0].text).toContain("reconciliation_attempt_count >= max_reconciliation_attempts");
    expect(transaction.calls[0].values).toEqual([ORGANIZATION_ID, 50]);
  });

  it("atomically marks the job and its approved Change Set applied", async () => {
    const transaction = new QueueTransaction([
      [jobRow({ status: "applied", attempt_count: 1, finished_at: CREATED_AT })],
      [{ id: CHANGE_SET_ID }],
    ]);
    const job = await new MigrationJobRepository(transaction).markApplied(JOB_ID, "worker-1", LEASE_TOKEN);

    expect(job.status).toBe("applied");
    expect(transaction.calls[0].text).toContain("lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()");
    expect(transaction.calls[0].text).toContain("reconciliation_required = false");
    expect(transaction.calls[1].text).toContain("SET status = 'applied'");
    expect(transaction.calls[1].values).toEqual([ORGANIZATION_ID, CHANGE_SET_ID]);
  });

  it("requeues temporary failures with redacted diagnostics until attempts are exhausted", async () => {
    const locked = jobRow({
      status: "running", attempt_count: 1, max_attempts: 3,
      lease_owner: "worker-1", lease_token: LEASE_TOKEN,
      lease_expires_at: "2099-01-01T00:00:00.000Z", started_at: CREATED_AT,
    });
    const queued = jobRow({
      status: "queued", attempt_count: 1, max_attempts: 3,
      last_error_code: "DB_UNAVAILABLE", last_error_message: "postgres://[REDACTED]@host/db",
    });
    const transaction = new QueueTransaction([[locked], [queued]]);
    const job = await new MigrationJobRepository(transaction).markFailed({
      jobId: JOB_ID,
      workerId: "worker-1",
      leaseToken: LEASE_TOKEN,
      errorCode: "db unavailable",
      errorMessage: "postgres://admin:super-secret@host/db",
      backoffMs: 10_000,
    });

    expect(job.status).toBe("queued");
    expect(transaction.calls).toHaveLength(2);
    expect(transaction.calls[1].values?.[6]).toBe("DB_UNAVAILABLE");
    expect(transaction.calls[1].values?.[7]).toBe("postgres://[REDACTED]@host/db");
  });

  it("fails both the exhausted job and Change Set", async () => {
    const locked = jobRow({
      status: "running", attempt_count: 3, max_attempts: 3,
      lease_owner: "worker-1", lease_token: LEASE_TOKEN,
      lease_expires_at: "2099-01-01T00:00:00.000Z", started_at: CREATED_AT,
    });
    const failed = jobRow({ status: "failed", attempt_count: 3, max_attempts: 3, finished_at: CREATED_AT });
    const transaction = new QueueTransaction([[locked], [failed], []]);
    const job = await new MigrationJobRepository(transaction).markFailed({
      jobId: JOB_ID, workerId: "worker-1", leaseToken: LEASE_TOKEN,
      errorCode: "MIGRATION_ERROR", errorMessage: "syntax error",
    });

    expect(job.status).toBe("failed");
    expect(transaction.calls[2].text).toContain("SET status = 'failed'");
    expect(transaction.calls[2].values).toEqual([ORGANIZATION_ID, CHANGE_SET_ID]);
  });

  it("moves an uncertain execution into the independent reconciliation queue", async () => {
    const locked = jobRow({
      status: "running", attempt_count: 1,
      lease_owner: "worker-1", lease_token: LEASE_TOKEN,
      lease_expires_at: "2099-01-01T00:00:00.000Z", started_at: CREATED_AT,
    });
    const deferred = jobRow({
      status: "queued", attempt_count: 1, reconciliation_required: true,
      last_error_code: "MIGRATION_EXECUTION_OUTCOME_UNKNOWN",
      last_error_message: "Migration outcome requires target-ledger reconciliation.",
    });
    const transaction = new QueueTransaction([[locked], [deferred]]);
    const result = await new MigrationJobRepository(transaction).deferForReconciliation({
      jobId: JOB_ID, workerId: "worker-1", leaseToken: LEASE_TOKEN,
      errorCode: "migration execution outcome unknown",
      errorMessage: "Migration outcome requires target-ledger reconciliation.",
      backoffMs: 1_000,
    });

    expect(result).toMatchObject({ status: "queued", reconciliationRequired: true, reconciliationAttemptCount: 0 });
    expect(transaction.calls[1].text).toContain("reconciliation_required = true");
    expect(transaction.calls[1].text).not.toContain("UPDATE change_sets");
    expect(transaction.calls[1].values?.[6]).toBe("MIGRATION_EXECUTION_OUTCOME_UNKNOWN");
  });

  it("quarantines an exhausted reconciliation without failing the approved Change Set", async () => {
    const locked = jobRow({
      status: "running", attempt_count: 1, reconciliation_required: true,
      reconciliation_attempt_count: 3, max_reconciliation_attempts: 3,
      lease_owner: "worker-1", lease_token: LEASE_TOKEN,
      lease_expires_at: "2099-01-01T00:00:00.000Z", started_at: CREATED_AT,
    });
    const quarantined = jobRow({
      status: "review_required", attempt_count: 1, reconciliation_required: true,
      reconciliation_attempt_count: 3, max_reconciliation_attempts: 3, finished_at: CREATED_AT,
    });
    const transaction = new QueueTransaction([[locked], [quarantined]]);
    const result = await new MigrationJobRepository(transaction).deferForReconciliation({
      jobId: JOB_ID, workerId: "worker-1", leaseToken: LEASE_TOKEN,
      errorCode: "MIGRATION_NOT_APPLIED", errorMessage: "Target ledger is empty.",
    });

    expect(result.status).toBe("review_required");
    expect(transaction.calls[1].values?.[4]).toBe("review_required");
    expect(transaction.calls).toHaveLength(2);
  });

  it("refuses to route a reconciliation-only claim through the generic failure transition", async () => {
    const locked = jobRow({
      status: "running", attempt_count: 1, reconciliation_required: true,
      reconciliation_attempt_count: 1,
      lease_owner: "worker-1", lease_token: LEASE_TOKEN,
      lease_expires_at: "2099-01-01T00:00:00.000Z", started_at: CREATED_AT,
    });
    const transaction = new QueueTransaction([[locked]]);

    await expect(new MigrationJobRepository(transaction).markFailed({
      jobId: JOB_ID, workerId: "worker-1", leaseToken: LEASE_TOKEN,
      errorCode: "MIGRATION_ERROR", errorMessage: "must not fail",
    })).rejects.toBeInstanceOf(MigrationNotReadyError);
    expect(transaction.calls).toHaveLength(1);
  });

  it("enqueues one reference-only operator reconciliation command idempotently", async () => {
    const transaction = new QueueTransaction([[reviewCommandRow()]]);
    const result = await new MigrationReviewCommandRepository(transaction).enqueue(
      JOB_ID,
      "owner@qkern.test",
      "manual_recheck",
    );

    expect(result).toMatchObject({ created: true, command: { id: REVIEW_COMMAND_ID, status: "pending" } });
    expect(transaction.calls[0].text).toContain("job.status = 'review_required'");
    expect(transaction.calls[0].text).toContain("job.review_cycle_count < job.max_review_cycles");
    expect(transaction.calls[0].text).toContain("ON CONFLICT (organization_id, migration_job_id) WHERE status = 'pending'");
    expect(transaction.calls[0].text).not.toContain("encrypted_statement");
    expect(transaction.calls[0].values).toEqual([ORGANIZATION_ID, JOB_ID, "owner@qkern.test", "manual_recheck"]);

    const duplicate = new QueueTransaction([[], [reviewCommandRow()]]);
    await expect(new MigrationReviewCommandRepository(duplicate).enqueue(
      JOB_ID,
      "owner@qkern.test",
      "manual_recheck",
    )).resolves.toMatchObject({ created: false, command: { id: REVIEW_COMMAND_ID } });
  });

  it("lets the worker atomically consume a command into a reconciliation-only job", async () => {
    const queued = jobRow({
      status: "queued", attempt_count: 1,
      reconciliation_required: true, reconciliation_attempt_count: 0,
      review_cycle_count: 1, finished_at: null,
      last_error_code: "OPERATOR_RECONCILIATION_REQUESTED",
    });
    const appliedCommand = reviewCommandRow({ status: "applied", processed_at: CREATED_AT });
    const transaction = new QueueTransaction([[reviewCommandRow()], [queued], [appliedCommand]]);
    const result = await new MigrationReviewCommandRepository(transaction).processPending();

    expect(result).toMatchObject([{
      command: { id: REVIEW_COMMAND_ID, status: "applied" },
      job: { id: JOB_ID, status: "queued", reconciliationRequired: true, reviewCycleCount: 1 },
    }]);
    expect(transaction.calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(transaction.calls[1].text).toContain("review_cycle_count = review_cycle_count + 1");
    expect(transaction.calls[1].text).toContain("reconciliation_attempt_count = 0");
    expect(transaction.calls[2].values).toEqual([ORGANIZATION_ID, REVIEW_COMMAND_ID, "applied"]);
  });

  it("rejects a consumed command when the job is no longer reviewable", async () => {
    const rejected = reviewCommandRow({ status: "rejected", processed_at: CREATED_AT });
    const transaction = new QueueTransaction([[reviewCommandRow()], [], [rejected]]);
    const result = await new MigrationReviewCommandRepository(transaction).processPending();

    expect(result).toEqual([{ command: expect.objectContaining({ status: "rejected" }), job: null }]);
    expect(transaction.calls[2].values?.[2]).toBe("rejected");
  });

  it("enqueues an exact reference-only incident resolution verification idempotently", async () => {
    const transaction = new QueueTransaction([[incidentResolutionCommandRow()]]);
    const result = await new MigrationIncidentResolutionCommandRepository(transaction).enqueue(
      INCIDENT_ID,
      "owner@qkern.test",
      "target_ledger_recheck",
    );

    expect(result).toMatchObject({
      created: true,
      command: { id: RESOLUTION_COMMAND_ID, reasonCode: "target_ledger_recheck", status: "pending" },
    });
    expect(transaction.calls[0].text).toContain("INSERT INTO migration_incident_resolution_commands");
    expect(transaction.calls[0].text).toContain("ON CONFLICT (organization_id, migration_incident_id)");
    expect(transaction.calls[0].text).not.toMatch(/migration_jobs|statement|database_instance_ref/i);
    expect(transaction.calls[0].values).toEqual([
      ORGANIZATION_ID, INCIDENT_ID, "owner@qkern.test", "target_ledger_recheck",
    ]);

    const duplicate = new QueueTransaction([[], [incidentResolutionCommandRow()]]);
    await expect(new MigrationIncidentResolutionCommandRepository(duplicate).enqueue(
      INCIDENT_ID,
      "owner@qkern.test",
      "target_ledger_recheck",
    )).resolves.toMatchObject({ created: false, command: { id: RESOLUTION_COMMAND_ID } });
  });

  it("worker-consumes resolution commands only into reconciliation-only jobs", async () => {
    const queued = jobRow({
      status: "queued", attempt_count: 1, reconciliation_required: true,
      reconciliation_attempt_count: 0, review_cycle_count: 3, finished_at: null,
      last_error_code: "INCIDENT_RESOLUTION_VERIFICATION_REQUESTED",
    });
    const appliedCommand = incidentResolutionCommandRow({ status: "applied", processed_at: CREATED_AT });
    const transaction = new QueueTransaction([[incidentResolutionCommandRow()], [queued], [appliedCommand]]);
    const result = await new MigrationIncidentResolutionCommandRepository(transaction).processPending();

    expect(result).toMatchObject([{
      command: { id: RESOLUTION_COMMAND_ID, status: "applied" },
      job: { id: JOB_ID, status: "queued", reconciliationRequired: true, reviewCycleCount: 3 },
    }]);
    expect(transaction.calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(transaction.calls[1].text).toContain("reconciliation_required = true");
    expect(transaction.calls[1].text).toContain("reconciliation_attempt_count = 0");
    expect(transaction.calls[1].text).toContain("prior.status = 'applied'");
    expect(transaction.calls[1].text).toContain(") < 3");
    expect(transaction.calls[1].text).not.toContain("review_cycle_count = review_cycle_count + 1");
    expect(transaction.calls[2].values).toEqual([ORGANIZATION_ID, RESOLUTION_COMMAND_ID, "applied"]);

    const rejectedCommand = incidentResolutionCommandRow({ status: "rejected", processed_at: CREATED_AT });
    const rejected = new QueueTransaction([[incidentResolutionCommandRow()], [], [rejectedCommand]]);
    await expect(new MigrationIncidentResolutionCommandRepository(rejected).processPending())
      .resolves.toEqual([{ command: expect.objectContaining({ status: "rejected" }), job: null }]);
  });

  it("derives one reference-only incident from exhausted review jobs", async () => {
    const transaction = new QueueTransaction([[incidentRow()]]);
    const result = await new MigrationIncidentRepository(transaction).escalateExhausted(10);

    expect(result).toEqual([expect.objectContaining({
      id: INCIDENT_ID, migrationJobId: JOB_ID, status: "open",
      detectedReviewCycle: 3, detectedReconciliationAttempt: 3,
    })]);
    expect(transaction.calls[0].text).toContain("status = 'review_required'");
    expect(transaction.calls[0].text).toContain("review_cycle_count >= max_review_cycles");
    expect(transaction.calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(transaction.calls[0].text).toContain("ON CONFLICT (organization_id, migration_job_id) DO NOTHING");
    expect(transaction.calls[0].text).not.toContain("encrypted_statement");
    expect(transaction.calls[0].text).not.toContain("database_instance_ref");
    expect(transaction.calls[0].values).toEqual([ORGANIZATION_ID, 10]);
    expect(transaction.calls[1].text).toContain("INSERT INTO migration_incident_outbox");
    expect(transaction.calls[1].text).toContain("'migration.incident.opened'");
    expect(transaction.calls[1].text).not.toContain("encrypted_statement");
    expect(transaction.calls[1].values).toEqual([ORGANIZATION_ID, [INCIDENT_ID]]);
  });

  it("lists bounded tenant incidents by project and state", async () => {
    const transaction = new QueueTransaction([[incidentRow()]]);
    const result = await new MigrationIncidentRepository(transaction).list({
      projectId: PROJECT_ID, status: "open", limit: 25,
    });

    expect(result).toHaveLength(1);
    expect(transaction.calls[0].text).toContain("$2::uuid IS NULL OR project_id = $2");
    expect(transaction.calls[0].text).toContain("$3::qkern_migration_incident_status IS NULL OR status = $3");
    expect(transaction.calls[0].values).toEqual([ORGANIZATION_ID, PROJECT_ID, "open", 25]);
  });

  it("acknowledges an incident exactly once with a fixed code", async () => {
    const acknowledged = incidentRow({
      status: "acknowledged",
      acknowledged_by: "owner@qkern.test",
      acknowledgement_code: "investigation_started",
      acknowledged_at: CREATED_AT,
    });
    const transaction = new QueueTransaction([[acknowledged]]);
    await expect(new MigrationIncidentRepository(transaction).acknowledge(
      INCIDENT_ID, "owner@qkern.test", "investigation_started",
    )).resolves.toMatchObject({ created: true, incident: { status: "acknowledged" } });
    expect(transaction.calls[0].text).toContain("status = 'open'");
    expect(transaction.calls[0].values).toEqual([ORGANIZATION_ID, INCIDENT_ID, "investigation_started"]);
    expect(transaction.calls[0].text).not.toContain("acknowledged_by =");
    expect(transaction.calls[0].text).not.toContain("acknowledged_at =");

    const duplicate = new QueueTransaction([[], [acknowledged]]);
    await expect(new MigrationIncidentRepository(duplicate).acknowledge(
      INCIDENT_ID, "owner@qkern.test", "runbook_in_progress",
    )).resolves.toMatchObject({ created: false, incident: { acknowledgementCode: "investigation_started" } });
  });

  it("resolves only through the fixed worker-owned target-ledger code", async () => {
    const resolved = incidentRow({
      status: "resolved",
      resolved_by: "worker-1",
      resolution_code: "target_ledger_match",
      resolved_at: CREATED_AT,
    });
    const transaction = new QueueTransaction([[resolved]]);
    await expect(new MigrationIncidentRepository(transaction).resolveAppliedJob(JOB_ID))
      .resolves.toMatchObject({ status: "resolved", resolutionCode: "target_ledger_match" });
    expect(transaction.calls[0].text).toContain("status = 'resolved'");
    expect(transaction.calls[0].text).toContain("resolution_code = 'target_ledger_match'");
    expect(transaction.calls[0].text).not.toContain("resolved_by =");
    expect(transaction.calls[0].text).not.toContain("resolved_at =");
    expect(transaction.calls[0].values).toEqual([ORGANIZATION_ID, JOB_ID]);
  });

  it("fails closed on inconsistent or unknown incident resolution evidence", async () => {
    const incomplete = new QueueTransaction([[incidentRow({ status: "resolved" })]]);
    await expect(new MigrationIncidentRepository(incomplete).list()).rejects.toThrow("inconsistent");

    const unknown = new QueueTransaction([[incidentRow({
      status: "resolved", resolved_by: "worker-1", resolution_code: "operator_confirmed",
      resolved_at: CREATED_AT,
    })]]);
    await expect(new MigrationIncidentRepository(unknown).list()).rejects.toThrow("invalid incident resolution code");
  });

  it("claims a hydrated incident notification with a fenced lease", async () => {
    const transaction = new QueueTransaction([[incidentOutboxRow()]]);
    const event = await new MigrationIncidentOutboxRepository(transaction)
      .claimNext("incident-publisher-1", 45_000);

    expect(event).toMatchObject({
      id: INCIDENT_EVENT_ID, migrationIncidentId: INCIDENT_ID, migrationJobId: JOB_ID,
      projectId: PROJECT_ID, changeSetId: CHANGE_SET_ID, incidentKind: "migration_outcome_unresolved",
      incidentSeverity: "critical", leaseOwner: "incident-publisher-1", attemptCount: 1,
    });
    expect(transaction.calls[0].text).toContain("FROM migration_incident_outbox");
    expect(transaction.calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(transaction.calls[0].text).toContain("JOIN migration_incidents AS incident");
    expect(transaction.calls[0].text).not.toContain("encrypted_statement");
    expect(transaction.calls[0].text).not.toContain("database_instance_ref");
    expect(transaction.calls[0].values).toEqual([ORGANIZATION_ID, "incident-publisher-1", 45_000]);
  });

  it("publishes or releases incident notifications only through the active lease", async () => {
    const published = incidentOutboxRow({
      status: "published", lease_owner: null, lease_token: null, lease_expires_at: null,
      published_at: CREATED_AT,
    });
    const released = incidentOutboxRow({ lease_owner: null, lease_token: null, lease_expires_at: null });
    const transaction = new QueueTransaction([[published], [released]]);
    const repository = new MigrationIncidentOutboxRepository(transaction);

    await expect(repository.markPublished(
      INCIDENT_EVENT_ID, "incident-publisher-1", LEASE_TOKEN,
    )).resolves.toMatchObject({ status: "published" });
    await expect(repository.releaseWithBackoff(
      INCIDENT_EVENT_ID, "incident-publisher-1", LEASE_TOKEN, 5_000,
    )).resolves.toMatchObject({ status: "pending", leaseOwner: null });

    expect(transaction.calls[0].text).toContain("lease_expires_at > now()");
    expect(transaction.calls[0].values).toEqual([
      ORGANIZATION_ID, INCIDENT_EVENT_ID, "incident-publisher-1", LEASE_TOKEN,
    ]);
    expect(transaction.calls[1].text).toContain("$5::integer * interval '1 millisecond'");
    expect(transaction.calls[1].values).toEqual([
      ORGANIZATION_ID, INCIDENT_EVENT_ID, "incident-publisher-1", LEASE_TOKEN, 5_000,
    ]);
  });

  it("records only fixed failures and atomically enters the terminal dead-letter state", async () => {
    const retry = incidentOutboxRow({
      attempt_count: 2, failure_count: 1, last_failure_code: "PUBLISH_FAILED",
      lease_owner: null, lease_token: null, lease_expires_at: null,
    });
    const deadLetter = incidentOutboxRow({
      status: "dead_lettered", attempt_count: 8, failure_count: 8,
      last_failure_code: "INVALID_ACK", dead_lettered_at: CREATED_AT,
      lease_owner: null, lease_token: null, lease_expires_at: null,
    });
    const timeout = incidentOutboxRow({
      failure_count: 1, last_failure_code: "DELIVERY_TIMEOUT",
      lease_owner: null, lease_token: null, lease_expires_at: null,
    });
    const transaction = new QueueTransaction([[retry], [deadLetter], [timeout]]);
    const repository = new MigrationIncidentOutboxRepository(transaction);

    await expect(repository.recordFailure(
      INCIDENT_EVENT_ID, "incident-publisher-1", LEASE_TOKEN, "PUBLISH_FAILED", 5_000,
    )).resolves.toMatchObject({ status: "pending", failureCount: 1, lastFailureCode: "PUBLISH_FAILED" });
    await expect(repository.recordFailure(
      INCIDENT_EVENT_ID, "incident-publisher-1", LEASE_TOKEN, "INVALID_ACK", 60_000,
    )).resolves.toMatchObject({
      status: "dead_lettered", failureCount: 8, deadLetteredAt: CREATED_AT,
    });
    await expect(repository.recordFailure(
      INCIDENT_EVENT_ID, "incident-publisher-1", LEASE_TOKEN, "DELIVERY_TIMEOUT", 5_000,
    )).resolves.toMatchObject({ lastFailureCode: "DELIVERY_TIMEOUT" });

    expect(transaction.calls[0].text).toContain("failure_count = failure_count + 1");
    expect(transaction.calls[0].text).toContain("'dead_lettered'::qkern_outbox_status");
    expect(transaction.calls[0].text).toContain("lease_expires_at > now()");
    expect(transaction.calls[0].values).toEqual([
      ORGANIZATION_ID, INCIDENT_EVENT_ID, "incident-publisher-1", LEASE_TOKEN, "PUBLISH_FAILED", 5_000,
    ]);
    expect(transaction.calls[0].text).not.toMatch(/error_message|response_body|database_instance_ref/i);
    expect(transaction.calls[2].values?.[4]).toBe("DELIVERY_TIMEOUT");
  });

  it("enqueues one fixed delivery-retry command without direct outbox mutation", async () => {
    const transaction = new QueueTransaction([[incidentDeliveryCommandRow()]]);
    const result = await new MigrationIncidentDeliveryCommandRepository(transaction).enqueue(
      INCIDENT_ID, "owner@qkern.test", "destination_recovered", "PUBLISH_FAILED", 0,
    );

    expect(result).toMatchObject({ created: true, command: { id: DELIVERY_COMMAND_ID, status: "pending" } });
    expect(transaction.calls[0].text).toContain("INSERT INTO migration_incident_delivery_commands");
    expect(transaction.calls[0].text).not.toContain("UPDATE migration_incident_outbox");
    expect(transaction.calls[0].values).toEqual([
      ORGANIZATION_ID, INCIDENT_ID, "owner@qkern.test", "destination_recovered", "PUBLISH_FAILED", 0,
    ]);
  });

  it("treats only the same pending recovery snapshot as idempotent", async () => {
    const same = new MigrationIncidentDeliveryCommandRepository(new QueueTransaction([
      [],
      [incidentDeliveryCommandRow()],
    ]));
    await expect(same.enqueue(
      INCIDENT_ID, "owner@qkern.test", "destination_recovered", "PUBLISH_FAILED", 0,
    )).resolves.toMatchObject({
      created: false,
      command: { expectedFailureCode: "PUBLISH_FAILED", expectedRetryCycle: 0 },
    });

    const changed = new MigrationIncidentDeliveryCommandRepository(new QueueTransaction([
      [],
      [incidentDeliveryCommandRow()],
    ]));
    await expect(changed.enqueue(
      INCIDENT_ID, "owner@qkern.test", "destination_recovered", "DELIVERY_TIMEOUT", 0,
    )).rejects.toBeInstanceOf(MigrationNotReadyError);

    const abaReplay = new MigrationIncidentDeliveryCommandRepository(new QueueTransaction([
      [],
      [incidentDeliveryCommandRow()],
    ]));
    await expect(abaReplay.enqueue(
      INCIDENT_ID, "owner@qkern.test", "destination_recovered", "PUBLISH_FAILED", 1,
    )).rejects.toBeInstanceOf(MigrationNotReadyError);

    const incompatibleTx = new QueueTransaction([]);
    await expect(new MigrationIncidentDeliveryCommandRepository(incompatibleTx).enqueue(
      INCIDENT_ID, "owner@qkern.test", "credentials_rotated", "DELIVERY_TIMEOUT", 0,
    )).rejects.toThrow("Invalid incident delivery retry reason code");
    expect(incompatibleTx.calls).toHaveLength(0);
  });

  it("worker-consumes delivery commands into bounded requeue or rejection", async () => {
    const appliedCommand = incidentDeliveryCommandRow({ status: "applied", processed_at: CREATED_AT });
    const requeued = incidentOutboxRow({
      attempt_count: 8, retry_cycle_count: 1,
      lease_owner: null, lease_token: null, lease_expires_at: null,
    });
    const appliedTx = new QueueTransaction([[incidentDeliveryCommandRow()], [requeued], [appliedCommand]]);
    const applied = await new MigrationIncidentDeliveryCommandRepository(appliedTx).processPending();

    expect(applied).toEqual([{
      commandId: DELIVERY_COMMAND_ID,
      incidentId: INCIDENT_ID,
      eventId: INCIDENT_EVENT_ID,
      outcome: "applied",
      failureCode: "PUBLISH_FAILED",
      expectedRetryCycle: 0,
      retryCycle: 1,
    }]);
    expect(appliedTx.calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(appliedTx.calls[1].text).toContain("failure_count = 0");
    expect(appliedTx.calls[1].text).toContain("retry_cycle_count = retry_cycle_count + 1");
    expect(appliedTx.calls[1].text).toContain("status = 'dead_lettered'");
    expect(appliedTx.calls[1].text).toContain("last_failure_code = $3");
    expect(appliedTx.calls[1].text).toContain("retry_cycle_count = $4");
    expect(appliedTx.calls[1].values).toEqual([ORGANIZATION_ID, INCIDENT_ID, "PUBLISH_FAILED", 0]);
    expect(appliedTx.calls[2].values).toEqual([ORGANIZATION_ID, DELIVERY_COMMAND_ID, "applied"]);

    const rejectedCommand = incidentDeliveryCommandRow({ status: "rejected", processed_at: CREATED_AT });
    const rejectedTx = new QueueTransaction([[incidentDeliveryCommandRow()], [], [rejectedCommand]]);
    await expect(new MigrationIncidentDeliveryCommandRepository(rejectedTx).processPending())
      .resolves.toEqual([{
        commandId: DELIVERY_COMMAND_ID,
        incidentId: INCIDENT_ID,
        outcome: "rejected",
        failureCode: "PUBLISH_FAILED",
        expectedRetryCycle: 0,
      }]);
    expect(rejectedTx.calls[2].values?.[2]).toBe("rejected");
  });

  it("reads only the bounded delivery projection and aggregate health functions", async () => {
    const transaction = new QueueTransaction([[incidentDeliveryStatusRow()], [incidentDeliveryHealthRow()]]);
    const repository = new MigrationIncidentDeliveryVisibilityRepository(transaction);

    await expect(repository.listStatuses([INCIDENT_ID, INCIDENT_ID])).resolves.toEqual([
      expect.objectContaining({
        migrationIncidentId: INCIDENT_ID,
        eventId: INCIDENT_EVENT_ID,
        status: "dead_lettered",
        failureCount: 8,
        retryCommandPending: true,
      }),
    ]);
    await expect(repository.health()).resolves.toEqual(expect.objectContaining({
      totalCount: 3,
      pendingCount: 1,
      overduePendingCount: 1,
      publishedCount: 1,
      deadLetteredCount: 1,
      pendingRetryCommandCount: 1,
      activeFailureCount: 1,
      activePublishFailedCount: 1,
    }));

    expect(transaction.calls[0].text).toContain("qkern_migration_incident_delivery_statuses($1::uuid[])");
    expect(transaction.calls[0].values).toEqual([[INCIDENT_ID]]);
    expect(transaction.calls[0].text).not.toMatch(/lease_owner|lease_token|requested_by|response_body/i);
    expect(transaction.calls[1].text).toContain("qkern_migration_incident_delivery_health()");
  });

  it("rejects unknown delivery failure classifications from the database projection", async () => {
    const transaction = new QueueTransaction([[
      incidentDeliveryStatusRow({ last_failure_code: "SECRET_PROVIDER_DIAGNOSTIC" }),
    ]]);
    await expect(new MigrationIncidentDeliveryVisibilityRepository(transaction).listStatuses([INCIDENT_ID]))
      .rejects.toThrow("invalid incident delivery failure code");
  });

  it("rejects stale or foreign lease completions", async () => {
    const transaction = new QueueTransaction([[]]);
    await expect(new MigrationJobRepository(transaction).renewLease(JOB_ID, "worker-2", LEASE_TOKEN))
      .rejects.toBeInstanceOf(MigrationLeaseLostError);
  });

  it("claims outbox events with the same lease fencing and no payload", async () => {
    const transaction = new QueueTransaction([[outboxRow()]]);
    const event = await new MigrationOutboxRepository(transaction).claimNext("publisher-1");

    expect(event).toMatchObject({ id: EVENT_ID, migrationJobId: JOB_ID, status: "pending" });
    expect(transaction.calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(transaction.calls[0].text).not.toContain("payload");
  });
});
