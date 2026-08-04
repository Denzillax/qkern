import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0002_repository_hardening.sql");

describe("control-plane database hardening migration", () => {
  it("enforces owner-safe RLS and tenant-scoped foreign keys", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ALTER TABLE projects FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("approval_requests_change_set_scope_fk");
    expect(sql).toContain("FOREIGN KEY (organization_id, project_id, change_set_id)");
    expect(sql).toContain("WITH CHECK (organization_id = qkern_current_organization_id())");
  });

  it("keeps audit rows append-only for the runtime role", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TRIGGER audit_logs_prepare_insert");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("CREATE TRIGGER audit_logs_append_only");
    expect(sql).toContain("GRANT SELECT, INSERT ON audit_logs TO qkern_runtime");
    expect(sql).not.toContain("GRANT SELECT, INSERT, UPDATE ON audit_logs TO qkern_runtime");
  });
});
