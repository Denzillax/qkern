import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Project Auth migration", () => {
  it("keeps app identities separate, scoped and verifier-only", async () => {
    const sql = await readFile(path.resolve(process.cwd(), "db/migrations/0024_project_auth.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE project_auth_users");
    expect(sql).toContain("CREATE TABLE project_auth_sessions");
    expect(sql).toContain("CREATE TABLE project_auth_mfa_factors");
    expect(sql).toContain("CREATE TABLE project_auth_oidc_identities");
    expect(sql).toContain("refresh_token_hash text NOT NULL UNIQUE");
    expect(sql).toContain("project auth scope is immutable");
    expect(sql).toContain("GRANT UPDATE (revoked_at, replaced_by_session_id, compromised_at)");
    expect(sql).not.toMatch(/refresh_token\s+text|magic_token\s+text|raw_token|plain_token/i);
    expect(sql).not.toMatch(/REFERENCES users\(/);
  });
});
