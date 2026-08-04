import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("db/migrations/0025_project_storage.sql", "utf8");

describe("Project Storage migration", () => {
  it("creates tenant-scoped buckets, verifier-only uploads and quarantined object metadata", () => {
    expect(migration).toContain("CREATE TABLE project_storage_buckets");
    expect(migration).toContain("CREATE TABLE project_storage_uploads");
    expect(migration).toContain("CREATE TABLE project_storage_objects");
    expect(migration).toContain("completion_token_hash text NOT NULL UNIQUE");
    expect(migration).not.toMatch(/completion_token\s+text/i);
    expect(migration).toContain("status IN ('quarantined', 'clean', 'infected')");
    expect(migration).toContain("used_bytes + reserved_bytes <= quota_bytes");
  });

  it("enforces RLS, immutable identities and least-privilege runtime grants", () => {
    for (const table of ["project_storage_buckets", "project_storage_uploads", "project_storage_objects"]) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`CREATE POLICY ${table}_select ON ${table}`);
    }
    expect(migration.match(/qkern_current_organization_id\(\)/g)?.length).toBeGreaterThanOrEqual(9);
    expect(migration).toContain("project storage upload verifier and identity are immutable");
    expect(migration).toContain("project storage object identity is immutable");
    expect(migration).toContain("GRANT UPDATE (status, completed_at, object_id) ON project_storage_uploads TO qkern_runtime");
    expect(migration).toContain("GRANT UPDATE (status, deleted_at) ON project_storage_objects TO qkern_runtime");
    expect(migration).not.toContain("GRANT ALL");
  });
});
