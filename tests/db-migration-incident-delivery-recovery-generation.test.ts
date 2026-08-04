import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "db/migrations/0018_migration_incident_delivery_recovery_generation.sql",
);

describe("incident delivery recovery generation migration", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("binds upgrade-safe pending commands to one stable retry generation", () => {
    expect(sql).toContain("ADD COLUMN expected_retry_cycle integer");
    expect(sql).toContain("LOCK TABLE migration_incident_outbox IN SHARE ROW EXCLUSIVE MODE");
    expect(sql).toContain("SET expected_retry_cycle = event.retry_cycle_count");
    expect(sql).toContain("command.expected_failure_code = event.last_failure_code");
    expect(sql).toContain("SET status = 'rejected'");
    expect(sql).toContain("expected_retry_cycle IS NULL");
    expect(sql).toContain("DROP CONSTRAINT migration_incident_delivery_commands_expected_failure_code");
    expect(sql).toContain("expected_failure_code IS NOT NULL");
    expect(sql).toContain("expected_retry_cycle IS NOT NULL");
  });

  it("prevents the same failure code from replaying across an ABA generation change", () => {
    expect(sql).toContain("current_retry_cycle integer");
    expect(sql).toContain("event.last_failure_code, event.retry_cycle_count");
    expect(sql).toContain("NEW.expected_retry_cycle IS DISTINCT FROM current_retry_cycle");
    expect(sql).toMatch(/retry_cycle_count < event\.max_retry_cycles\s+FOR UPDATE;/);
    expect(sql).toContain("migration_incident_delivery_commands_expected_retry_cycle");
  });

  it("preserves v0.18 command-first locking, actor binding and narrow grants", () => {
    const commandLock = sql.indexOf(
      "FROM public.migration_incident_delivery_commands AS pending",
    );
    const outboxLock = sql.indexOf(
      "SELECT event.last_failure_code, event.retry_cycle_count",
    );
    expect(commandLock).toBeGreaterThan(-1);
    expect(commandLock).toBeLessThan(outboxLock);
    expect(sql).toContain("NEW.organization_id <> public.qkern_current_organization_id()");
    expect(sql).toContain("NEW.requested_by := bound_actor");
    expect(sql).toContain("GRANT INSERT (expected_retry_cycle)");
    expect(sql).not.toMatch(/GRANT\s+(SELECT|UPDATE|DELETE)[\s\S]{0,120}migration_incident_outbox/i);
    expect(sql).not.toMatch(/error_message|response_body|endpoint_url|secret_value|provider_response/i);
  });
});
