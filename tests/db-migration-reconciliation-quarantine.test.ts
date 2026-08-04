import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "db/migrations/0008_migration_reconciliation_quarantine.sql",
);

describe("migration reconciliation quarantine schema", () => {
  it("adds a bounded reconciliation-only state machine and terminal review quarantine", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'review_required'");
    expect(sql).toContain("reconciliation_required boolean NOT NULL DEFAULT false");
    expect(sql).toContain("reconciliation_attempt_count integer NOT NULL DEFAULT 0");
    expect(sql).toContain("max_reconciliation_attempts integer NOT NULL DEFAULT 3");
    expect(sql).toContain("migration_jobs_reconciliation_attempt_bounds");
    expect(sql).toContain("migration_jobs_reconciliation_state_shape");
    expect(sql).toContain("status = 'review_required'");
  });

  it("keeps reconciliation mutations inside the worker boundary", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("ON migration_jobs FROM qkern_runtime");
    expect(sql).toContain("ON migration_jobs TO qkern_worker");
    expect(sql).not.toContain("GRANT UPDATE (\n  reconciliation_required, reconciliation_attempt_count\n) ON migration_jobs TO qkern_runtime");
  });
});
