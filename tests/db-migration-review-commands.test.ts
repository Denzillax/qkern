import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0009_migration_review_commands.sql");

describe("migration review command schema", () => {
  it("adds bounded review cycles and a reference-only command queue", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("review_cycle_count integer NOT NULL DEFAULT 0");
    expect(sql).toContain("max_review_cycles integer NOT NULL DEFAULT 3");
    expect(sql).toContain("migration_jobs_review_cycle_bounds");
    expect(sql).toContain("CREATE TABLE migration_review_commands");
    expect(sql).toContain("migration_review_commands_one_pending_job");
    expect(sql).toContain("FOREIGN KEY (organization_id, migration_job_id)");
    expect(sql).not.toContain("encrypted_statement");
    expect(sql).not.toContain("database_instance_ref");
  });

  it("lets the runtime insert commands but reserves job and command transitions for the worker", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("GRANT INSERT (organization_id, migration_job_id, requested_by, reason_code)");
    expect(sql).toContain("ON migration_review_commands TO qkern_runtime");
    expect(sql).toContain("GRANT UPDATE (status, processed_at, updated_at)");
    expect(sql).toContain("ON migration_review_commands TO qkern_worker");
    expect(sql).toContain("REVOKE UPDATE (review_cycle_count, max_review_cycles) ON migration_jobs FROM qkern_runtime");
    expect(sql).toContain("GRANT UPDATE (review_cycle_count) ON migration_jobs TO qkern_worker");
    expect(sql).not.toContain("GRANT UPDATE (review_cycle_count) ON migration_jobs TO qkern_runtime");
  });
});
