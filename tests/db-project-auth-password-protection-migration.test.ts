import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Die Migration des Passwortschutzes (2.53). Gelesen wird der Quelltext; dass
 * sie laeuft, belegt der Fall "(2.60)" gegen die echte Datenbank.
 */
const migrationPath = path.resolve(
  process.cwd(), "db/migrations/0053_project_auth_password_protection.sql",
);

describe("project auth password protection migration", () => {
  it("puts the three values into the settings table of 0048 instead of opening a fourth one", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ALTER TABLE project_auth_settings");
    for (const column of [
      "leaked_password_check boolean NOT NULL DEFAULT false",
      "password_min_length integer NOT NULL DEFAULT 12",
      "leaked_password_notice text NOT NULL DEFAULT 'named'",
    ]) {
      expect(sql, column).toContain(column);
    }
    // Keine neue Tabelle. Die Einstellungen bekommen keine zweite Heimat, und
    // die Leckliste bekommt gar keine: Sie steht in einer Datei, nicht in der
    // Datenbank.
    expect([...sql.matchAll(/CREATE TABLE (\w+)/g)]).toEqual([]);
  });

  it("carries no place where a password, a digest or a list could ever be stored", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const forbidden of [
      "password_hash", "leaked_password_list", "leaked_password_digests",
      "digest", "sha1", "sha256", "bytea",
    ]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("bounds the minimum length and the wording in the database", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("project_auth_settings_password_protection_check");
    // Die untere Grenze ist 12, weil der Dienst jedes kuerzere Passwort seit
    // jeher abweist; die obere 128, weil bei 256 die einzige erlaubte Laenge
    // genau 256 waere.
    expect(sql).toContain("password_min_length BETWEEN 12 AND 128");
    expect(sql).toContain("leaked_password_notice IN ('named', 'generic')");
    // CHECK erlaubt keine Unterabfrage; eine hier waere ein Fehler beim
    // Anwenden, nicht beim Lesen.
    expect(sql).not.toMatch(/CHECK\s*\([^;]*SELECT/i);
  });

  it("keeps the settings grants explicit and adds no DELETE", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("REVOKE UPDATE ON project_auth_settings FROM qkern_auth");
    // Die bisherigen Spalten bleiben in der Liste; sonst haette diese
    // Migration dem Dienst die Grenzen aus 2.56 weggenommen.
    expect(sql).toContain("mfa_required, redirect_allow_list, updated_at");
    expect(sql).toContain("refresh_max, refresh_window_seconds");
    expect(sql).toContain("leaked_password_check, password_min_length, leaked_password_notice");
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*project_auth_settings/);
    expect(sql).toContain("BEGIN;");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("takes the next free number after 0052", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql.length).toBeGreaterThan(0);
    const listing = await readFile(
      path.resolve(process.cwd(), "db/migrations/0052_project_auth_rate_limits.sql"), "utf8",
    );
    expect(listing.length).toBeGreaterThan(0);
  });
});
