import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MigrationIncidentDeliveryCommandRepository,
  MigrationIncidentRepository,
} from "@/lib/server/db/repositories";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import type { SqlPool, SqlPoolClient } from "@/lib/server/db/sql";
import { withTenantTransaction } from "@/lib/server/db/transaction";

const adminUrl = process.env.QKERN_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const workerUrl = process.env.QKERN_TEST_WORKER_DATABASE_URL;
const explicitlyAllowed = process.env.QKERN_TEST_ALLOW_DATABASE_CREATE_DROP === "true";
const enabled = Boolean(adminUrl && runtimeUrl && workerUrl && explicitlyAllowed);

type IncidentFixture = {
  userId: string;
  organizationId: string;
  projectId: string;
  changeSetId: string;
  approvalId: string;
  jobId: string;
  incidentId: string;
  eventId: string;
};

function databaseUrl(connectionString: string, databaseName: string): string {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function databaseIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error("Unsafe certification database identifier.");
  return `"${value}"`;
}

function migrationSql(fileName: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), "db/migrations", fileName), "utf8");
}

async function applyMigration(pool: SqlPool, fileName: string): Promise<void> {
  const sql = migrationSql(fileName);
  const beginOffset = sql.search(/^BEGIN;$/m);
  if (beginOffset < 0) {
    await pool.query(sql);
    return;
  }

  const preamble = sql.slice(0, beginOffset);
  const executablePreamble = preamble.replace(/^\s*--.*$/gm, "").trim();
  if (executablePreamble) await pool.query(preamble);
  await pool.query(sql.slice(beginOffset));
}

async function applyMigrationsThrough(pool: SqlPool, lastFileName: string): Promise<void> {
  const files = fs.readdirSync(path.resolve(process.cwd(), "db/migrations"))
    .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
    .sort();
  for (const fileName of files) {
    if (fileName > lastFileName) break;
    await applyMigration(pool, fileName);
  }
}

async function seedIncident(
  pool: SqlPool,
  label: string,
  failureCode: "PUBLISH_FAILED" | "INVALID_ACK" | "SIGNING_KEY_UNAVAILABLE" |
    "DELIVERY_TIMEOUT" | "DESTINATION_REJECTED" = "PUBLISH_FAILED",
  retryCycle = 0,
): Promise<IncidentFixture> {
  const fixture: IncidentFixture = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    projectId: randomUUID(),
    changeSetId: randomUUID(),
    approvalId: randomUUID(),
    jobId: randomUUID(),
    incidentId: randomUUID(),
    eventId: randomUUID(),
  };
  const environmentId = randomUUID();
  const slug = `${label}-${fixture.organizationId}`.slice(0, 100);
  const databaseRef = `managed:certification-${fixture.projectId}`;

  await pool.query(
    `INSERT INTO users (id, email, password_hash, status)
     VALUES ($1, $2, '$argon2id$certification-only', 'active')`,
    [fixture.userId, `${label}-${fixture.userId}@qkern.test`],
  );
  await pool.query(
    `INSERT INTO organizations (id, name, slug, created_by)
     VALUES ($1, $2, $3, $4)`,
    [fixture.organizationId, `Certification ${label}`, slug, fixture.userId],
  );
  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role, is_personal_workspace)
     VALUES ($1, $2, 'owner', true)`,
    [fixture.organizationId, fixture.userId],
  );
  await pool.query(
    `INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
     VALUES ($1, $2, $3, 'project', 'test', 'ready', $4)`,
    [fixture.projectId, fixture.organizationId, `Project ${label}`, fixture.userId],
  );
  await pool.query(
    `INSERT INTO project_environments
       (id, organization_id, project_id, environment, database_instance_ref)
     VALUES ($1, $2, $3, 'development', $4)`,
    [environmentId, fixture.organizationId, fixture.projectId, databaseRef],
  );
  await pool.query(
    `INSERT INTO change_sets
       (id, organization_id, project_id, environment, title, statement_sha256,
        encrypted_statement, risk, status, created_by)
     VALUES ($1, $2, $3, 'development', $4, $5, $6, 'high', 'approved', $7)`,
    [
      fixture.changeSetId,
      fixture.organizationId,
      fixture.projectId,
      `Change ${label}`,
      "a".repeat(64),
      new Uint8Array([1, 2, 3, 4]),
      fixture.userId,
    ],
  );
  await pool.query(
    `INSERT INTO approval_requests
       (id, organization_id, project_id, change_set_id, environment, action_hash, status, expires_at)
     VALUES ($1, $2, $3, $4, 'development', $5, 'approved', now() + interval '1 hour')`,
    [fixture.approvalId, fixture.organizationId, fixture.projectId, fixture.changeSetId, "b".repeat(64)],
  );
  await pool.query(
    `INSERT INTO migration_jobs
       (id, organization_id, project_id, environment, database_instance_ref, change_set_id,
        approval_request_id, status, attempt_count, max_attempts, finished_at,
        reconciliation_required, reconciliation_attempt_count, max_reconciliation_attempts,
        review_cycle_count, max_review_cycles)
     VALUES ($1, $2, $3, 'development', $4, $5, $6, 'review_required', 3, 5, now(),
             true, 3, 3, 3, 3)`,
    [
      fixture.jobId,
      fixture.organizationId,
      fixture.projectId,
      databaseRef,
      fixture.changeSetId,
      fixture.approvalId,
    ],
  );
  await pool.query(
    `INSERT INTO migration_incidents
       (id, organization_id, migration_job_id, project_id, environment, change_set_id,
        detected_review_cycle, detected_reconciliation_attempt)
     VALUES ($1, $2, $3, $4, 'development', $5, 3, 3)`,
    [
      fixture.incidentId,
      fixture.organizationId,
      fixture.jobId,
      fixture.projectId,
      fixture.changeSetId,
    ],
  );
  await pool.query(
    `INSERT INTO migration_incident_outbox
       (id, organization_id, migration_incident_id, event_type, status, attempt_count,
        failure_count, max_failures, last_failure_code, dead_lettered_at,
        retry_cycle_count, max_retry_cycles)
     VALUES ($1, $2, $3, 'migration.incident.opened', 'dead_lettered', 8,
             8, 8, $4, now(), $5, 3)`,
    [fixture.eventId, fixture.organizationId, fixture.incidentId, failureCode, retryCycle],
  );
  return fixture;
}

async function insertPreGenerationCommand(
  pool: SqlPool,
  fixture: IncidentFixture,
  failureCode: "PUBLISH_FAILED" | "INVALID_ACK",
): Promise<string> {
  return withTenantTransaction(
    pool,
    { organizationId: fixture.organizationId, actorRef: "operator:upgrade-certification" },
    async (transaction) => {
      const result = await transaction.query<{ id: string }>(
        `INSERT INTO migration_incident_delivery_commands
           (organization_id, migration_incident_id, requested_by, reason_code, expected_failure_code)
         VALUES ($1, $2, 'untrusted-input', 'destination_recovered', $3)
         RETURNING id`,
        [fixture.organizationId, fixture.incidentId, failureCode],
      );
      if (!result.rows[0]) throw new Error("Failed to seed the pre-generation command.");
      return result.rows[0].id;
    },
  );
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe.runIf(enabled)("PostgreSQL 17 incident recovery and resolution certification", () => {
  const databaseName = `qkern_v020_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  let admin: SqlPool;
  let owner: SqlPool;
  let runtime: SqlPool;
  let worker: SqlPool;
  let upgradeCurrent: IncidentFixture;
  let upgradeStale: IncidentFixture;
  let upgradeCurrentCommandId: string;
  let upgradeStaleCommandId: string;

  beforeAll(async () => {
    admin = createPostgresPool({ connectionString: adminUrl!, max: 2, statementTimeoutMillis: 120_000 });
    await admin.query(`CREATE DATABASE ${databaseIdentifier(databaseName)}`);
    owner = createPostgresPool({
      connectionString: databaseUrl(adminUrl!, databaseName),
      max: 4,
      statementTimeoutMillis: 120_000,
    });
    await applyMigrationsThrough(owner, "0017_migration_incident_verified_resolution.sql");

    upgradeCurrent = await seedIncident(owner, "upgrade-current", "PUBLISH_FAILED", 1);
    upgradeCurrentCommandId = await insertPreGenerationCommand(owner, upgradeCurrent, "PUBLISH_FAILED");

    upgradeStale = await seedIncident(owner, "upgrade-stale", "INVALID_ACK", 1);
    upgradeStaleCommandId = await insertPreGenerationCommand(owner, upgradeStale, "INVALID_ACK");
    await owner.query(
      `UPDATE migration_incident_outbox
       SET last_failure_code = 'PUBLISH_FAILED'
       WHERE id = $1`,
      [upgradeStale.eventId],
    );

    await applyMigration(owner, "0018_migration_incident_delivery_recovery_generation.sql");
    runtime = verifyDatabaseBoundary(createPostgresPool({
      connectionString: databaseUrl(runtimeUrl!, databaseName),
      max: 4,
      statementTimeoutMillis: 10_000,
    }), "runtime");
    worker = verifyDatabaseBoundary(createPostgresPool({
      connectionString: databaseUrl(workerUrl!, databaseName),
      max: 4,
      statementTimeoutMillis: 10_000,
    }), "worker");
  }, 120_000);

  afterAll(async () => {
    await Promise.all([runtime?.end(), worker?.end(), owner?.end()]);
    if (admin) {
      await admin.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${databaseIdentifier(databaseName)}`);
      await admin.end();
    }
  }, 30_000);

  it("upgrades only current pending commands and rejects stale snapshots", async () => {
    const current = await owner.query<{
      status: string;
      expected_failure_code: string | null;
      expected_retry_cycle: number | null;
      requested_by: string;
    }>(
      `SELECT status, expected_failure_code, expected_retry_cycle, requested_by
       FROM migration_incident_delivery_commands WHERE id = $1`,
      [upgradeCurrentCommandId],
    );
    expect(current.rows).toEqual([{
      status: "pending",
      expected_failure_code: "PUBLISH_FAILED",
      expected_retry_cycle: 1,
      requested_by: "operator:upgrade-certification",
    }]);

    const stale = await owner.query<{
      status: string;
      expected_retry_cycle: number | null;
      processed_at: Date | null;
    }>(
      `SELECT status, expected_retry_cycle, processed_at
       FROM migration_incident_delivery_commands WHERE id = $1`,
      [upgradeStaleCommandId],
    );
    expect(stale.rows[0]?.status).toBe("rejected");
    expect(stale.rows[0]?.expected_retry_cycle).toBeNull();
    expect(stale.rows[0]?.processed_at).toBeInstanceOf(Date);
  });

  it("closes PostgreSQL CHECK-NULL bypasses for every new pending command", async () => {
    const fixture = await seedIncident(owner, "null-constraint");
    await owner.query(
      "ALTER TABLE migration_incident_delivery_commands DISABLE TRIGGER migration_incident_delivery_commands_bind_actor",
    );
    try {
      await expect(owner.query(
        `INSERT INTO migration_incident_delivery_commands
           (organization_id, migration_incident_id, requested_by, reason_code,
            expected_failure_code, expected_retry_cycle)
         VALUES ($1, $2, 'constraint-test', 'destination_recovered', NULL, NULL)`,
        [fixture.organizationId, fixture.incidentId],
      )).rejects.toMatchObject({ code: "23514" });
      await expect(owner.query(
        `INSERT INTO migration_incident_delivery_commands
           (organization_id, migration_incident_id, requested_by, reason_code,
            expected_failure_code, expected_retry_cycle)
         VALUES ($1, $2, 'constraint-test', 'destination_recovered', 'PUBLISH_FAILED', NULL)`,
        [fixture.organizationId, fixture.incidentId],
      )).rejects.toMatchObject({ code: "23514" });
    } finally {
      await owner.query(
        "ALTER TABLE migration_incident_delivery_commands ENABLE TRIGGER migration_incident_delivery_commands_bind_actor",
      );
    }
  });

  it("rejects an old command when the same failure code returns in a later generation", async () => {
    const fixture = await seedIncident(owner, "aba-replay");
    const command = await withTenantTransaction(
      runtime,
      { organizationId: fixture.organizationId, actorRef: "operator:aba" },
      async (transaction) => new MigrationIncidentDeliveryCommandRepository(transaction).enqueue(
        fixture.incidentId,
        "operator:aba",
        "destination_recovered",
        "PUBLISH_FAILED",
        0,
      ),
    );
    expect(command.created).toBe(true);

    await owner.query(
      `UPDATE migration_incident_outbox SET retry_cycle_count = 1 WHERE id = $1`,
      [fixture.eventId],
    );
    const processed = await withTenantTransaction(
      worker,
      { organizationId: fixture.organizationId, actorRef: "worker:aba" },
      async (transaction) => new MigrationIncidentDeliveryCommandRepository(transaction).processPending(),
    );
    expect(processed).toEqual([expect.objectContaining({
      commandId: command.command.id,
      outcome: "rejected",
      failureCode: "PUBLISH_FAILED",
      expectedRetryCycle: 0,
    })]);

    const event = await owner.query<{ status: string; retry_cycle_count: number }>(
      "SELECT status, retry_cycle_count FROM migration_incident_outbox WHERE id = $1",
      [fixture.eventId],
    );
    expect(event.rows).toEqual([{ status: "dead_lettered", retry_cycle_count: 1 }]);
  });

  it("applies a command only to its exact failure and generation snapshot", async () => {
    const fixture = await seedIncident(owner, "exact-recovery", "SIGNING_KEY_UNAVAILABLE");
    const requested = await withTenantTransaction(
      runtime,
      { organizationId: fixture.organizationId, actorRef: "operator:credentials" },
      async (transaction) => new MigrationIncidentDeliveryCommandRepository(transaction).enqueue(
        fixture.incidentId,
        "operator:credentials",
        "credentials_rotated",
        "SIGNING_KEY_UNAVAILABLE",
        0,
      ),
    );
    const processed = await withTenantTransaction(
      worker,
      { organizationId: fixture.organizationId, actorRef: "worker:publisher" },
      async (transaction) => new MigrationIncidentDeliveryCommandRepository(transaction).processPending(),
    );
    expect(processed).toEqual([expect.objectContaining({
      commandId: requested.command.id,
      outcome: "applied",
      expectedRetryCycle: 0,
      retryCycle: 1,
    })]);

    const event = await owner.query<{
      status: string;
      failure_count: number;
      last_failure_code: string | null;
      retry_cycle_count: number;
    }>(
      `SELECT status, failure_count, last_failure_code, retry_cycle_count
       FROM migration_incident_outbox WHERE id = $1`,
      [fixture.eventId],
    );
    expect(event.rows).toEqual([{
      status: "pending",
      failure_count: 0,
      last_failure_code: null,
      retry_cycle_count: 1,
    }]);
  });

  it("keeps duplicate runtime inserts behind the worker's command-first lock", async () => {
    const fixture = await seedIncident(owner, "lock-order");
    const requested = await withTenantTransaction(
      runtime,
      { organizationId: fixture.organizationId, actorRef: "operator:first" },
      async (transaction) => new MigrationIncidentDeliveryCommandRepository(transaction).enqueue(
        fixture.incidentId,
        "operator:first",
        "destination_recovered",
        "PUBLISH_FAILED",
        0,
      ),
    );

    let workerClient: SqlPoolClient | undefined;
    let transactionOpen = false;
    let duplicateSettled = false;
    let blockedBeforeRelease = false;
    try {
      workerClient = await worker.connect();
      await workerClient.query("BEGIN");
      transactionOpen = true;
      await workerClient.query(
        "SELECT set_config('qkern.organization_id', $1, true), set_config('qkern.actor_ref', $2, true)",
        [fixture.organizationId, "worker:lock-order"],
      );
      await workerClient.query(
        `SELECT id FROM migration_incident_delivery_commands
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'
         FOR UPDATE`,
        [fixture.organizationId, requested.command.id],
      );

      const duplicate = withTenantTransaction(
        runtime,
        {
          organizationId: fixture.organizationId,
          actorRef: "operator:duplicate",
          statementTimeoutMs: 5_000,
        },
        async (transaction) => {
          const inserted = await transaction.query(
            `INSERT INTO migration_incident_delivery_commands
               (organization_id, migration_incident_id, requested_by, reason_code,
                expected_failure_code, expected_retry_cycle)
             VALUES ($1, $2, 'forged', 'destination_recovered', 'PUBLISH_FAILED', 0)
             RETURNING id`,
            [fixture.organizationId, fixture.incidentId],
          );
          return inserted.rowCount ?? 0;
        },
      ).then((rowCount) => {
        duplicateSettled = true;
        return rowCount;
      });

      await pause(150);
      blockedBeforeRelease = !duplicateSettled;
      await workerClient.query(
        `UPDATE migration_incident_outbox
         SET status = 'pending', failure_count = 0, last_failure_code = NULL,
             dead_lettered_at = NULL, retry_cycle_count = 1, available_at = now()
         WHERE organization_id = $1 AND id = $2`,
        [fixture.organizationId, fixture.eventId],
      );
      await workerClient.query(
        `UPDATE migration_incident_delivery_commands
         SET status = 'applied', processed_at = now()
         WHERE organization_id = $1 AND id = $2`,
        [fixture.organizationId, requested.command.id],
      );
      await workerClient.query("COMMIT");
      transactionOpen = false;

      expect(await duplicate).toBe(0);
    } finally {
      if (workerClient && transactionOpen) await workerClient.query("ROLLBACK");
      workerClient?.release();
    }
    expect(blockedBeforeRelease).toBe(true);
  }, 15_000);

  it("allows incident resolution only after worker-verified applied state", async () => {
    const fixture = await seedIncident(owner, "verified-resolution");
    await expect(withTenantTransaction(
      worker,
      { organizationId: fixture.organizationId, actorRef: "worker:resolution" },
      async (transaction) => new MigrationIncidentRepository(transaction).resolveAppliedJob(fixture.jobId),
    )).rejects.toBeTruthy();

    const resolved = await withTenantTransaction(
      worker,
      { organizationId: fixture.organizationId, actorRef: "worker:resolution" },
      async (transaction) => {
        await transaction.query(
          `UPDATE migration_jobs
           SET status = 'applied', reconciliation_required = false,
               reconciliation_attempt_count = 0
           WHERE organization_id = $1 AND id = $2`,
          [fixture.organizationId, fixture.jobId],
        );
        await transaction.query(
          `UPDATE change_sets SET status = 'applied'
           WHERE organization_id = $1 AND id = $2`,
          [fixture.organizationId, fixture.changeSetId],
        );
        return new MigrationIncidentRepository(transaction).resolveAppliedJob(fixture.jobId);
      },
    );
    expect(resolved).toEqual(expect.objectContaining({
      id: fixture.incidentId,
      status: "resolved",
      resolutionCode: "target_ledger_match",
      resolvedBy: "worker:resolution",
    }));
  });
});
