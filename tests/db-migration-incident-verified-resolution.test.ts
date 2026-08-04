import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "db/migrations/0017_migration_incident_verified_resolution.sql",
);

describe("verified migration incident resolution migration", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("commits the resolved enum value before the transactional schema upgrade", () => {
    const enumOffset = sql.indexOf("ALTER TYPE qkern_migration_incident_status ADD VALUE IF NOT EXISTS 'resolved'");
    const beginOffset = sql.indexOf("BEGIN;");
    expect(enumOffset).toBeGreaterThanOrEqual(0);
    expect(beginOffset).toBeGreaterThan(enumOffset);
    expect(sql).toContain("resolution_code qkern_migration_incident_resolution_code");
    expect(sql).toContain("resolution_code = 'target_ledger_match'");
  });

  it("allows resolution only for the worker after the bound job is applied", () => {
    expect(sql).toContain("pg_has_role(session_user, 'qkern_worker', 'MEMBER')");
    expect(sql).toContain("job.id = OLD.migration_job_id");
    expect(sql).toContain("job.status = 'applied'");
    expect(sql).toContain("NOT job.reconciliation_required");
    expect(sql).toContain("migration incident resolution requires worker-verified ledger evidence");
    expect(sql).not.toMatch(/operator_confirmed|manual_resolution|resolved_by_operator/i);
  });

  it("binds reference-only commands to actor, tenant, unresolved state and three cycles", () => {
    const commandTable = sql.match(
      /CREATE TABLE migration_incident_resolution_commands[\s\S]*?\n\);/,
    )?.[0] ?? "";
    expect(sql).toContain("CREATE TABLE migration_incident_resolution_commands");
    expect(sql).toContain("reason_code qkern_migration_incident_resolution_reason_code NOT NULL");
    expect(sql).toContain("current_setting('qkern.actor_ref', true)");
    expect(sql).toContain("NEW.organization_id <> public.qkern_current_organization_id()");
    expect(sql).toContain("incident.status IN ('open', 'acknowledged')");
    expect(sql).toContain("job.status = 'review_required'");
    expect(sql).toContain("prior.status = 'applied'");
    expect(sql).toContain(") < 3");
    expect(sql).toContain("FOR UPDATE OF incident, job");
    expect(sql.indexOf("migration_incident_resolution_commands AS pending"))
      .toBeLessThan(sql.indexOf("FOR UPDATE OF incident, job"));
    expect(commandTable).not.toMatch(/statement|database_instance_ref|credential|secret|diagnostic|free_text/i);
  });

  it("keeps runtime and worker grants narrowly separated", () => {
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("GRANT INSERT (organization_id, migration_incident_id, requested_by, reason_code)");
    expect(sql).toContain("GRANT UPDATE (status, processed_at, updated_at)");
    expect(sql).toContain("GRANT UPDATE (status, resolution_code) ON migration_incidents TO qkern_worker");
    expect(sql).not.toMatch(/GRANT\s+UPDATE[\s\S]{0,100}migration_incidents TO qkern_runtime/i);
  });

  it("remediates delivery retry locking to match the worker's command-first order", () => {
    const functionSql = sql.match(
      /CREATE OR REPLACE FUNCTION qkern_bind_incident_delivery_retry\(\)[\s\S]*?\n\$\$;/,
    )?.[0] ?? "";
    expect(functionSql).toContain("migration_incident_delivery_commands AS pending");
    expect(functionSql).toContain("migration_incident_outbox AS event");
    expect(functionSql.indexOf("migration_incident_delivery_commands AS pending"))
      .toBeLessThan(functionSql.indexOf("migration_incident_outbox AS event"));
    expect(functionSql).toContain("NEW.expected_failure_code IS DISTINCT FROM current_failure_code");
  });
});
