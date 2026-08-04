import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "db/project/0002_qkern_migration_fence.sql"), "utf8");

describe("project migration fence provisioning", () => {
  it("creates an owner-protected persistent fence with a monotone epoch", () => {
    expect(sql).toContain("CREATE TABLE qkern_internal.migration_fences");
    expect(sql).toContain("job_id uuid PRIMARY KEY");
    expect(sql).toContain("fence_epoch bigint NOT NULL CHECK (fence_epoch > 0)");
    expect(sql).toContain("ALTER TABLE qkern_internal.migration_fences OWNER TO qkern_ledger_owner");
  });

  it("keeps destructive and job-id mutation privileges away from the migration login", () => {
    expect(sql).toContain("REVOKE ALL ON qkern_internal.migration_fences FROM PUBLIC, qkern_project_migrator");
    expect(sql).toContain("GRANT SELECT, INSERT ON qkern_internal.migration_fences TO qkern_project_migrator");
    expect(sql).toContain("GRANT UPDATE (fence_epoch, lease_token, statement_sha256, fenced_at)");
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|DELETE|TRUNCATE)/i);
    expect(sql).not.toMatch(/GRANT UPDATE \([^)]*job_id/i);
  });
});
