import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0010_migration_incident_escalations.sql");

describe("migration incident escalation schema", () => {
  it("creates one reference-only incident per exhausted migration job", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE migration_incidents");
    expect(sql).toContain("migration_incidents_one_per_job UNIQUE (organization_id, migration_job_id)");
    expect(sql).toContain("kind = 'migration_outcome_unresolved'");
    expect(sql).toContain("severity = 'critical'");
    expect(sql).toContain("migration_incidents_state_shape");
    expect(sql).not.toContain("encrypted_statement");
    expect(sql).not.toContain("database_instance_ref");
    expect(sql).not.toContain("free_text");
  });

  it("reserves creation for the worker and limits runtime updates to acknowledgement fields", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("GRANT INSERT (");
    expect(sql).toContain(") ON migration_incidents TO qkern_worker");
    expect(sql).toContain("GRANT UPDATE (status, acknowledgement_code)");
    expect(sql).toContain("ON migration_incidents TO qkern_runtime");
    expect(sql).not.toContain("ON migration_incidents TO qkern_runtime;\nGRANT INSERT");
    expect(sql).toContain("NEW.acknowledged_by := current_setting('qkern.actor_ref', true)");
    expect(sql).toContain("NEW.acknowledged_at := now()");
    expect(sql).toContain("migration incident evidence is immutable");
    expect(sql).not.toContain("GRANT UPDATE ON migration_jobs TO qkern_runtime");
  });
});
