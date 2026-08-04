import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "db/migrations/0014_migration_incident_delivery_visibility.sql",
);

describe("incident delivery visibility migration", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("exposes only tenant-scoped, bounded SECURITY DEFINER projections", () => {
    expect(sql).toContain("qkern_migration_incident_delivery_statuses(p_incident_ids uuid[])");
    expect(sql).toContain("qkern_migration_incident_delivery_health()");
    expect(sql.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(sql.match(/SET search_path = pg_catalog, public/g)).toHaveLength(2);
    expect(sql).toContain("event.organization_id = public.qkern_current_organization_id()");
    expect(sql).toContain("pg_catalog.cardinality(p_incident_ids) BETWEEN 1 AND 100");
  });

  it("keeps direct outbox access revoked from the web runtime", () => {
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION qkern_migration_incident_delivery_statuses(uuid[]) TO qkern_runtime",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION qkern_migration_incident_delivery_health() TO qkern_runtime",
    );
    expect(sql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,120}migration_incident_outbox\s+TO\s+qkern_runtime/i);
  });

  it("returns fixed operational state without lease tokens, actors or provider diagnostics", () => {
    const statusSignature = sql.match(
      /qkern_migration_incident_delivery_statuses\(p_incident_ids uuid\[\]\)\s+RETURNS TABLE \(([\s\S]*?)\)\s+LANGUAGE sql/,
    )?.[1] ?? "";
    const healthSignature = sql.match(
      /qkern_migration_incident_delivery_health\(\)\s+RETURNS TABLE \(([\s\S]*?)\)\s+LANGUAGE sql/,
    )?.[1] ?? "";
    expect(statusSignature).toContain("last_failure_code text");
    expect(statusSignature).not.toMatch(/lease_owner|lease_token|owner|token|requested_by|response|error_message/i);
    expect(healthSignature).toContain("dead_lettered_count bigint");
    expect(healthSignature).toContain("overdue_pending_count bigint");
    expect(healthSignature).not.toMatch(/lease_owner|lease_token|owner|token|requested_by|response|error_message/i);
  });
});
