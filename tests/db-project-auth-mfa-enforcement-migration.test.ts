import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Die Migration des erzwingbaren zweiten Faktors (2.52). Gelesen wird der
 * Quelltext; dass sie laeuft, belegt der Fall "(2.52)" gegen die echte
 * Datenbank.
 */
const migrationPath = path.resolve(process.cwd(), "db/migrations/0048_project_auth_mfa_enforcement.sql");

describe("project auth mfa enforcement migration", () => {
  it("stores the switch per project environment and cascades with it", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE project_auth_settings");
    expect(sql).toContain("mfa_required boolean NOT NULL DEFAULT false");
    expect(sql).toContain("PRIMARY KEY (organization_id, project_id, environment)");
    expect(sql).toContain("REFERENCES project_environments (organization_id, project_id, environment)");
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("opens the new one-time purpose for the enrolment grant", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ALTER TABLE project_auth_one_time_tokens");
    expect(sql).toContain("'mfa_challenge', 'mfa_enrollment'");
  });

  it("grants the auth role what it needs and nothing more", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("REVOKE ALL ON project_auth_settings FROM PUBLIC");
    expect(sql).toContain("GRANT SELECT, INSERT ON project_auth_settings TO qkern_auth");
    expect(sql).toContain("GRANT UPDATE (mfa_required, updated_at) ON project_auth_settings TO qkern_auth");
    // Kein DELETE: Eine Zeile verschwindet nur mit ihrer Umgebung.
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*project_auth_settings/);
    expect(sql).toContain("project_auth_settings_scope_immutable");
    expect(sql).toContain("BEGIN;");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
