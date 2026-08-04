import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256 } from "@/lib/server/provisioning/contract";
import { createHash } from "node:crypto";

const migration = path.resolve(process.cwd(), "db/migrations/0020_project_database_provisioning.sql");

describe("project database provisioning migration", () => {
  it("uses a distinct least-privilege role and removes web retargeting rights", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("CREATE ROLE qkern_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT");
    expect(sql).toContain("REVOKE UPDATE ON projects FROM qkern_runtime");
    expect(sql).toContain("REVOKE UPDATE, DELETE ON project_environments FROM qkern_runtime");
    expect(sql).not.toContain("GRANT ALL");
    expect(sql).not.toContain("GRANT SELECT ON users");
  });

  it("persists fenced jobs and immutable secret-free bindings with bounded recovery", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts = 5)");
    expect(sql).toContain("max_retry_cycles integer NOT NULL DEFAULT 3 CHECK (max_retry_cycles = 3)");
    expect(sql).toContain("lease_token uuid");
    expect(sql).toContain("UNIQUE (organization_id, project_id, environment)");
    expect(sql).toContain("UNIQUE (organization_id, database_instance_ref)");
    expect(sql).toContain(`bootstrap_contract_sha256 = '${PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256}'`);
    const bindingTable = sql.slice(
      sql.indexOf("CREATE TABLE project_database_bindings"),
      sql.indexOf("ALTER TABLE project_database_provisioning_jobs"),
    );
    expect(bindingTable).not.toMatch(/password|credential|connection_string|database_url/i);
  });

  it("pins the exact ordered project bootstrap contract", async () => {
    const files = await Promise.all([
      readFile(path.resolve(process.cwd(), "db/project/0001_qkern_migration_ledger.sql")),
      readFile(path.resolve(process.cwd(), "db/project/0002_qkern_migration_fence.sql")),
    ]);
    const digest = createHash("sha256").update(files[0]).update(Buffer.from([0])).update(files[1]).digest("hex");
    expect(digest).toBe(PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256);
  });
});
