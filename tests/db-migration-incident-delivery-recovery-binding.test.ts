import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "db/migrations/0016_migration_incident_delivery_recovery_binding.sql",
);

describe("incident delivery recovery binding migration", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("binds pending commands to a fixed observed failure code", () => {
    expect(sql).toContain("ADD COLUMN expected_failure_code text");
    expect(sql).toContain("LOCK TABLE migration_incident_outbox IN SHARE ROW EXCLUSIVE MODE");
    expect(sql).toContain("command.status = 'pending'");
    expect(sql).toContain("event.status = 'dead_lettered'");
    expect(sql).toContain("migration_incident_delivery_commands_expected_failure_code");
    expect(sql).toContain("AND NOT COALESCE((");
    expect(sql).toMatch(/retry_cycle_count < event\.max_retry_cycles\s+FOR UPDATE;/);
    expect(sql).toContain("NEW.expected_failure_code IS DISTINCT FROM current_failure_code");
  });

  it("permits only fixed compatible reason and failure pairs", () => {
    expect(sql).toContain(
      "current_failure_code = 'SIGNING_KEY_UNAVAILABLE' AND NEW.reason_code = 'credentials_rotated'",
    );
    expect(sql).toContain("current_failure_code = 'DESTINATION_REJECTED'");
    expect(sql).toContain("'PUBLISH_FAILED', 'INVALID_ACK', 'DELIVERY_TIMEOUT'");
    expect(sql).toContain("'destination_recovered', 'provider_incident_resolved'");
    expect(sql).toContain("SET status = 'rejected'");
    expect(sql).toContain("expected_failure_code = NULL");
  });

  it("keeps actor binding, RLS table isolation and narrow insert privileges", () => {
    expect(sql).toContain("current_setting('qkern.actor_ref', true)");
    expect(sql).toContain("NEW.organization_id <> public.qkern_current_organization_id()");
    expect(sql).toContain("NEW.requested_by := bound_actor");
    expect(sql).toContain("GRANT INSERT (expected_failure_code)");
    expect(sql).not.toMatch(/GRANT\s+(SELECT|UPDATE|DELETE)[\s\S]{0,120}migration_incident_outbox/i);
    expect(sql).not.toMatch(/error_message|response_body|endpoint_url|secret_value|provider_response/i);
  });
});
