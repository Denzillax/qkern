import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0011_migration_incident_outbox.sql");

describe("migration incident notification outbox schema", () => {
  it("stores one reference-only event per incident and backfills v0.9 records", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE migration_incident_outbox");
    expect(sql).toContain("event_type = 'migration.incident.opened'");
    expect(sql).toContain("migration_incident_outbox_one_event");
    expect(sql).toContain("REFERENCES migration_incidents (organization_id, id)");
    expect(sql).toContain("SELECT organization_id, id, 'migration.incident.opened'");
    expect(sql).not.toContain("encrypted_statement");
    expect(sql).not.toContain("database_instance_ref");
    expect(sql).not.toContain("acknowledged_by");
  });

  it("keeps the web runtime out and reserves fenced delivery for the worker boundary", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("REVOKE ALL ON migration_incident_outbox FROM PUBLIC, qkern_runtime, qkern_worker");
    expect(sql).toContain("GRANT INSERT (organization_id, migration_incident_id, event_type)");
    expect(sql).toContain("ON migration_incident_outbox TO qkern_worker");
    expect(sql).toContain("GRANT UPDATE (");
    expect(sql).not.toMatch(/GRANT (SELECT|INSERT|UPDATE)[\s\S]{0,250}migration_incident_outbox TO qkern_runtime/);
    expect(sql).toContain("ALTER TABLE migration_incident_outbox FORCE ROW LEVEL SECURITY");
  });
});
