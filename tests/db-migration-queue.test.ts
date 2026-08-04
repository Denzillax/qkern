import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0005_migration_apply_queue.sql");

describe("migration apply queue schema", () => {
  it("binds one durable job and one outbox request to a tenant-scoped Change Set", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE migration_jobs");
    expect(sql).toContain("migration_jobs_one_per_change_set");
    expect(sql).toContain("FOREIGN KEY (organization_id, project_id, environment, change_set_id)");
    expect(sql).toContain("database_instance_ref text NOT NULL");
    expect(sql).toContain("project_environments_database_ref_immutable");
    expect(sql).toContain("approval_requests_decision_required");
    expect(sql).toContain("approval status requires a matching decision");
    expect(sql).toContain("REVOKE INSERT ON approval_requests FROM qkern_runtime");
    expect(sql).toContain("GRANT INSERT (organization_id, project_id, change_set_id, environment, action_hash, expires_at)");
    expect(sql).toContain("CREATE TABLE migration_outbox");
    expect(sql).toContain("migration_outbox_one_request_per_job");
    expect(sql).toContain("FOREIGN KEY (organization_id, migration_job_id)");
    expect(sql).not.toMatch(/\b(payload|encrypted_statement|database_url|password|credential)\s+(?:text|bytea|jsonb)/i);
  });

  it("enforces leased queue states and owner-safe tenant isolation", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TYPE qkern_migration_job_status AS ENUM ('queued', 'running', 'applied', 'failed')");
    expect(sql).toContain("migration_jobs_state_shape");
    expect(sql).toContain("attempt_count <= max_attempts");
    expect(sql).toContain("ALTER TABLE migration_jobs FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE migration_outbox FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("WITH CHECK (organization_id = qkern_current_organization_id())");
  });

  it("grants only the columns required to enqueue and advance queue state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("GRANT INSERT (organization_id, project_id, environment, database_instance_ref, change_set_id, max_attempts, available_at)");
    expect(sql).toContain("GRANT UPDATE (\n  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,");
    expect(sql).not.toContain("GRANT INSERT, UPDATE ON migration_jobs");
    expect(sql).not.toContain("GRANT ALL ON migration_jobs");
  });
});
