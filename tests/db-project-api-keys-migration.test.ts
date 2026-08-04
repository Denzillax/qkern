import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0023_project_api_keys.sql");

describe("project API key migration", () => {
  it("stores only tenant-scoped verifiers with one-way revocation and a narrow auth function", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE project_api_keys");
    expect(sql).toContain("token_hash text NOT NULL UNIQUE");
    expect(sql).toContain("ALTER TABLE project_api_keys ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("project API keys are immutable except for one-way revocation");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION qkern_authenticate_project_api_key");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION qkern_authenticate_project_api_key(text) TO qkern_auth");
    expect(sql).toContain("GRANT UPDATE (revoked_at) ON project_api_keys TO qkern_runtime");
    expect(sql).not.toMatch(/raw_token|plain_token|secret text/i);
  });
});
