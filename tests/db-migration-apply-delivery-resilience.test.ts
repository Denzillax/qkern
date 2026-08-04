import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InvalidRecordError } from "@/lib/server/db/errors";
import {
  MigrationOutboxDeliveryCommandRepository,
  MigrationOutboxDeliveryVisibilityRepository,
  MigrationOutboxRepository,
} from "@/lib/server/db/repositories";
import type { SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import type { TenantTransaction } from "@/lib/server/db/transaction";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0019_migration_apply_delivery_resilience.sql");
const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const JOB_ID = "940cb242-32d6-41fd-b244-67d4913f7b91";
const EVENT_ID = "412cb46b-6313-4a74-8480-9d9e9e240e36";
const COMMAND_ID = "542fa056-4d26-4853-87f4-1b6c86b2e7f4";
const LEASE_TOKEN = "a742d2d4-d8fc-4353-918d-b5b1f3a3959d";
const NOW = "2026-07-20T12:00:00.000Z";

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

function commandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMAND_ID, organization_id: ORGANIZATION_ID, migration_job_id: JOB_ID,
    requested_by: "owner@example.com", reason_code: "destination_recovered",
    expected_failure_code: "DELIVERY_TIMEOUT", expected_retry_cycle: 1,
    status: "pending", processed_at: null, created_at: NOW, updated_at: NOW,
    ...overrides,
  };
}

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID, organization_id: ORGANIZATION_ID, migration_job_id: JOB_ID,
    event_type: "migration.apply.requested", status: "pending", attempt_count: 8,
    failure_count: 0, max_failures: 8, last_failure_code: null, dead_lettered_at: null,
    retry_cycle_count: 2, max_retry_cycles: 3, available_at: NOW,
    lease_owner: null, lease_token: null, lease_expires_at: null, published_at: null,
    created_at: NOW, updated_at: NOW, ...overrides,
  };
}

describe("migration apply delivery resilience", () => {
  it("adds bounded dead letters and exact-generation actor-bound recovery", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("failure_count integer NOT NULL DEFAULT 0");
    expect(sql).toContain("max_failures integer NOT NULL DEFAULT 8");
    expect(sql).toContain("retry_cycle_count integer NOT NULL DEFAULT 0");
    expect(sql).toContain("max_retry_cycles integer NOT NULL DEFAULT 3");
    expect(sql).toContain("CREATE TABLE migration_outbox_delivery_commands");
    expect(sql).toContain("NEW.expected_failure_code IS DISTINCT FROM current_failure_code");
    expect(sql).toContain("NEW.expected_retry_cycle IS DISTINCT FROM current_retry_cycle");
    expect(sql).toContain("NEW.requested_by := bound_actor");
    expect(sql).toMatch(/retry_cycle_count < event\.max_retry_cycles\s+FOR UPDATE;/);
    expect(sql).not.toMatch(/error_message|failure_message|response_body|endpoint_url|database_instance_ref|encrypted_statement|secret_value/i);
  });

  it("removes runtime outbox reads and exposes only narrow status, health and command grants", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("REVOKE SELECT ON migration_outbox FROM qkern_runtime");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION qkern_migration_outbox_delivery_health() TO qkern_runtime");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION qkern_migration_outbox_delivery_status(uuid) TO qkern_runtime");
    expect(sql).toContain("GRANT INSERT (\n  organization_id, migration_job_id, requested_by, reason_code,\n  expected_failure_code, expected_retry_cycle\n) ON migration_outbox_delivery_commands TO qkern_runtime");
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[\s\S]{0,100}migration_outbox TO qkern_runtime/i);
    expect(sql).not.toMatch(/GRANT UPDATE \([^)]*(attempt_count|max_failures|max_retry_cycles|published_at)/i);
  });

  it("enqueues only a compatible fixed failure snapshot", async () => {
    const transaction = new QueueTransaction([[commandRow()]]);
    const repository = new MigrationOutboxDeliveryCommandRepository(transaction);
    await expect(repository.enqueue(
      JOB_ID, "owner@example.com", "destination_recovered", "DELIVERY_TIMEOUT", 1,
    )).resolves.toMatchObject({ created: true, command: { id: COMMAND_ID, expectedRetryCycle: 1 } });
    expect(transaction.calls[0].text).toContain("ON CONFLICT (organization_id, migration_job_id) WHERE status = 'pending'");
    expect(transaction.calls[0].values).toEqual([
      ORGANIZATION_ID, JOB_ID, "owner@example.com", "destination_recovered", "DELIVERY_TIMEOUT", 1,
    ]);

    await expect(repository.enqueue(
      JOB_ID, "owner@example.com", "credentials_rotated", "DELIVERY_TIMEOUT", 1,
    )).rejects.toBeInstanceOf(InvalidRecordError);
  });

  it("reopens only the exact dead-letter generation and completes the command atomically", async () => {
    const transaction = new QueueTransaction([
      [commandRow()],
      [outboxRow()],
      [commandRow({ status: "applied", processed_at: NOW })],
    ]);
    const results = await new MigrationOutboxDeliveryCommandRepository(transaction).processPending(5);
    expect(results).toEqual([{
      commandId: COMMAND_ID, migrationJobId: JOB_ID, eventId: EVENT_ID, outcome: "applied",
      failureCode: "DELIVERY_TIMEOUT", expectedRetryCycle: 1, retryCycle: 2,
    }]);
    expect(transaction.calls[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(transaction.calls[1].text).toContain("last_failure_code = $3 AND retry_cycle_count = $4");
    expect(transaction.calls[1].text).toContain("failure_count = 0, last_failure_code = NULL");
    expect(transaction.calls[2].text).toContain("status = $3::qkern_migration_outbox_delivery_command_status");
  });

  it("persists a fenced fixed failure and never accepts arbitrary diagnostics", async () => {
    const transaction = new QueueTransaction([[outboxRow({
      status: "dead_lettered", failure_count: 8, last_failure_code: "DELIVERY_TIMEOUT",
      dead_lettered_at: NOW,
    })]]);
    const repository = new MigrationOutboxRepository(transaction);
    await expect(repository.recordFailure(
      EVENT_ID, "publisher-1", LEASE_TOKEN, "DELIVERY_TIMEOUT", 5_000,
    )).resolves.toMatchObject({ status: "dead_lettered", failureCount: 8 });
    expect(transaction.calls[0].text).toContain("lease_owner = $3 AND lease_token = $4 AND lease_expires_at > now()");
    expect(transaction.calls[0].text).toContain("failure_count + 1 >= max_failures");
    await expect(repository.recordFailure(
      EVENT_ID, "publisher-1", LEASE_TOKEN, "SECRET_PROVIDER_ERROR" as "DELIVERY_TIMEOUT", 5_000,
    )).rejects.toBeInstanceOf(InvalidRecordError);
  });

  it("uses only narrow database functions for redacted status and aggregate health", async () => {
    const status = {
      migration_job_id: JOB_ID, event_id: EVENT_ID, delivery_status: "pending", attempt_count: 1,
      failure_count: 0, max_failures: 8, last_failure_code: null, dead_lettered_at: null,
      retry_cycle_count: 0, max_retry_cycles: 3, available_at: NOW, published_at: null,
      retry_command_pending: false,
    };
    const health = {
      total_count: "1", pending_count: "1", ready_count: "1", scheduled_count: "0",
      in_flight_count: "0", overdue_pending_count: "0", expired_lease_count: "0",
      recovery_pending_count: "0", published_count: "0", dead_lettered_count: "0",
      recovery_exhausted_count: "0", pending_retry_command_count: "0", active_failure_count: "0",
      active_publish_failed_count: "0", active_invalid_ack_count: "0",
      active_signing_key_unavailable_count: "0", active_delivery_timeout_count: "0",
      active_destination_rejected_count: "0", oldest_pending_at: NOW,
      oldest_dead_lettered_at: null, latest_dead_lettered_at: null, measured_at: NOW,
    };
    const transaction = new QueueTransaction([[status], [health]]);
    const repository = new MigrationOutboxDeliveryVisibilityRepository(transaction);
    await expect(repository.status(JOB_ID)).resolves.toMatchObject({ migrationJobId: JOB_ID, status: "pending" });
    await expect(repository.health()).resolves.toMatchObject({ totalCount: 1, readyCount: 1 });
    expect(transaction.calls[0].text).toContain("qkern_migration_outbox_delivery_status($1::uuid)");
    expect(transaction.calls[1].text).toContain("qkern_migration_outbox_delivery_health()");
    expect(transaction.calls.map((call) => call.text).join(" ")).not.toMatch(/lease_owner|lease_token|requested_by|provider|response_body/i);
  });
});
