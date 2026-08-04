import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0013_migration_incident_delivery_health.sql");

describe("migration incident delivery health schema", () => {
  it("returns tenant-bound aggregates with a fixed five-minute SLO", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION qkern_migration_incident_delivery_health()");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain("event.organization_id = public.qkern_current_organization_id()");
    expect(sql).toContain("interval '5 minutes'");
    expect(sql).toContain("event.status = 'dead_lettered'");
    expect(sql).toContain("event.retry_cycle_count >= event.max_retry_cycles");
  });

  it("grants runtime only the aggregate function, never the outbox table", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("REVOKE ALL ON FUNCTION qkern_migration_incident_delivery_health()");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION qkern_migration_incident_delivery_health()");
    expect(sql).toContain("TO qkern_runtime");
    expect(sql).not.toMatch(/GRANT\s+SELECT[\s\S]{0,120}migration_incident_outbox[\s\S]{0,80}qkern_runtime/i);
  });

  it("cannot expose identifiers, provider data or raw diagnostics", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const returns = sql.slice(sql.indexOf("RETURNS TABLE"), sql.indexOf(")\nLANGUAGE sql"));
    expect(returns).not.toMatch(/organization_id|incident_id|event_id|actor|provider|endpoint|response|error|credential/i);
    expect(sql).not.toMatch(/last_failure_code|requested_by|reason_code|migration_incident_id/i);
    expect(sql).not.toMatch(/UPDATE\s|INSERT\s|DELETE\s/i);
  });
});
