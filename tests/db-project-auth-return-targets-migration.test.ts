import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Die Migration der erlaubten Ruecksprungziele (2.54). Gelesen wird der
 * Quelltext; dass sie laeuft, belegt der Fall "(2.54)" gegen die echte
 * Datenbank.
 */
const migrationPath = path.resolve(process.cwd(), "db/migrations/0051_project_auth_return_targets.sql");

describe("project auth return targets migration", () => {
  it("adds the list to the settings table of 0048 instead of opening a second one", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ALTER TABLE project_auth_settings");
    expect(sql).toContain("ADD COLUMN redirect_allow_list text[] NOT NULL DEFAULT '{}'");
    // Keine zweite Tabelle mit denselben Scope-Spalten.
    expect(sql).not.toContain("CREATE TABLE");
  });

  it("checks in the database what the database can check, without a subquery", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("project_auth_settings_redirect_allow_list_check");
    expect(sql).toContain("array_length(redirect_allow_list, 1) <= 20");
    expect(sql).toContain("array_position(redirect_allow_list, NULL::text) IS NULL");
    expect(sql).toContain("strpos(array_to_string(redirect_allow_list, ','), '*') = 0");
    // CHECK erlaubt keine Unterabfrage; eine hier waere ein Fehler beim
    // Anwenden, nicht beim Lesen.
    expect(sql).not.toMatch(/CHECK\s*\([^;]*SELECT/i);
  });

  it("keeps the column grants explicit and adds no DELETE", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("REVOKE UPDATE ON project_auth_settings FROM qkern_auth");
    expect(sql).toContain("GRANT UPDATE (mfa_required, redirect_allow_list, updated_at)");
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*project_auth_settings/);
    expect(sql).toContain("BEGIN;");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
