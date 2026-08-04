import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "db/project/0001_qkern_migration_ledger.sql"), "utf8");

describe("project migration ledger provisioning contract", () => {
  it("separates the ledger owner from the least-privilege migration login", () => {
    expect(sql).toContain("qkern_ledger_owner");
    expect(sql).toContain("qkern_project_migrator");
    expect(sql).toContain("must not inherit the ledger owner role");
    expect(sql).toContain("REVOKE CREATE ON SCHEMA qkern_internal FROM qkern_project_migrator");
  });

  it("keys idempotency by Change Set and grants only SELECT plus INSERT", () => {
    expect(sql).toContain("change_set_id uuid PRIMARY KEY");
    expect(sql).toContain("statement_sha256 text NOT NULL");
    expect(sql).toContain("REVOKE ALL ON qkern_internal.migration_ledger FROM PUBLIC, qkern_project_migrator");
    expect(sql).toContain("GRANT SELECT, INSERT ON qkern_internal.migration_ledger TO qkern_project_migrator");
    expect(sql).not.toContain("CREATE SCHEMA IF NOT EXISTS");
    expect(sql).not.toContain("CREATE TABLE IF NOT EXISTS");
  });
});
