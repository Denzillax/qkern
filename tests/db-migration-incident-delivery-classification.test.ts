import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "db/migrations/0015_migration_incident_delivery_failure_classification.sql",
);

describe("incident delivery failure classification migration", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("expands the existing constraint with only fixed redacted failure codes", () => {
    expect(sql).toContain("DROP CONSTRAINT migration_incident_outbox_failure_code");
    for (const code of [
      "PUBLISH_FAILED",
      "INVALID_ACK",
      "SIGNING_KEY_UNAVAILABLE",
      "DELIVERY_TIMEOUT",
      "DESTINATION_REJECTED",
    ]) {
      expect(sql).toContain(`'${code}'`);
    }
    expect(sql).not.toMatch(/error_message|response_body|endpoint_url|secret_value|provider_response/i);
  });

  it("projects mutually exclusive active failure counts without treating recovered events as unhealthy", () => {
    const signature = sql.match(
      /qkern_migration_incident_delivery_health\(\)\s+RETURNS TABLE \(([\s\S]*?)\)\s+LANGUAGE sql/,
    )?.[1] ?? "";
    expect(signature).toContain("active_failure_count bigint");
    expect(signature).toContain("active_signing_key_unavailable_count bigint");
    expect(signature).toContain("active_delivery_timeout_count bigint");
    expect(signature).toContain("active_destination_rejected_count bigint");
    expect(sql).toContain("event.status <> 'published' AND event.failure_count > 0");
    expect(sql).toContain("event.organization_id = public.qkern_current_organization_id()");
  });

  it("preserves the narrow tenant projection and direct table-access boundary", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION qkern_migration_incident_delivery_health() TO qkern_runtime",
    );
    expect(sql).not.toMatch(
      /GRANT\s+(SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,120}migration_incident_outbox\s+TO\s+qkern_runtime/i,
    );
  });
});
