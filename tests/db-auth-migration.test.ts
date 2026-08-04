import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "db/migrations/0003_auth_and_memberships.sql");

describe("auth and membership persistence migration", () => {
  it("enforces canonical active-user email uniqueness", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("users_email_is_canonical");
    expect(sql).toContain("users_canonical_email_unique");
    expect(sql).toContain("lower(btrim(email))");
    expect(sql).toContain("WHERE deleted_at IS NULL");
  });

  it("stores hashed session verifiers with expiry and revocation constraints", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE auth_sessions");
    expect(sql).toContain("token_hash text NOT NULL UNIQUE");
    expect(sql).not.toMatch(/\n\s*token\s+text\b/);
    expect(sql).toContain("expires_at > created_at");
    expect(sql).toContain("revoked_at IS NULL OR revoked_at >= created_at");
  });

  it("isolates global auth access and exposes membership discovery without table grants", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE ROLE qkern_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("WHERE member.user_id = p_user_id");
    expect(sql).toContain("REVOKE ALL ON FUNCTION qkern_memberships_for_user(uuid) FROM PUBLIC");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION qkern_memberships_for_user(uuid) TO qkern_auth");
    expect(sql).toContain("UPDATE (revoked_at)");
    expect(sql).not.toContain("GRANT SELECT, INSERT, UPDATE ON auth_sessions");
    expect(sql).not.toContain("GRANT SELECT ON organization_members TO qkern_auth");
  });
});
