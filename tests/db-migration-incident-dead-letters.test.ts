import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0012_migration_incident_dead_letters.sql");

describe("migration incident dead-letter schema", () => {
  it("adds a terminal delivery state with bounded failure and recovery counters", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql.indexOf("ALTER TYPE qkern_outbox_status ADD VALUE IF NOT EXISTS 'dead_lettered'")).toBeLessThan(
      sql.indexOf("BEGIN;"),
    );
    expect(sql).toContain("failure_count integer NOT NULL DEFAULT 0");
    expect(sql).toContain("max_failures integer NOT NULL DEFAULT 8");
    expect(sql).toContain("failure_count = max_failures");
    expect(sql).toContain("retry_cycle_count integer NOT NULL DEFAULT 0");
    expect(sql).toContain("max_retry_cycles integer NOT NULL DEFAULT 3");
    expect(sql).toContain("WHERE status = 'dead_lettered'");
    expect(sql).not.toMatch(/last_(error|failure)_(message|detail)|response_body|database_instance_ref|statement/i);
  });

  it("keeps retry requests reference-only, actor-bound and worker-consumed", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE migration_incident_delivery_commands");
    expect(sql).toContain("migration_incident_delivery_commands_one_pending");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("current_setting('qkern.actor_ref', true)");
    expect(sql).toContain("NEW.requested_by := bound_actor");
    expect(sql).toContain("event.retry_cycle_count < event.max_retry_cycles");
    expect(sql).toContain("GRANT INSERT (organization_id, migration_incident_id, requested_by, reason_code)");
    expect(sql).toContain("ON migration_incident_delivery_commands TO qkern_runtime");
    expect(sql).toContain("GRANT UPDATE (status, processed_at, updated_at)");
    expect(sql).toContain("ON migration_incident_delivery_commands TO qkern_worker");
    expect(sql).not.toMatch(/GRANT (SELECT|INSERT|UPDATE)[\s\S]{0,180}migration_incident_outbox TO qkern_runtime/);
  });

  it("cannot mutate jobs, incidents or claim identity through a retry command", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(/UPDATE\s+migration_jobs/i);
    expect(sql).not.toMatch(/UPDATE\s+migration_incidents/i);
    expect(sql).not.toMatch(/GRANT UPDATE \([^)]*(attempt_count|max_failures|max_retry_cycles|published_at)/i);
    expect(sql).toContain("reason_code IN ('destination_recovered', 'credentials_rotated', 'provider_incident_resolved')");
  });
});
