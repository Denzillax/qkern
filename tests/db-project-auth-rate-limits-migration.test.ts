import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Die Migration der Grenzen je Zeitfenster (2.56). Gelesen wird der
 * Quelltext; dass sie laeuft, belegt der Fall "(2.56)" gegen die echte
 * Datenbank.
 */
const migrationPath = path.resolve(process.cwd(), "db/migrations/0052_project_auth_rate_limits.sql");

describe("project auth rate limits migration", () => {
  it("puts the limits into the settings table of 0048 instead of opening a second one", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ALTER TABLE project_auth_settings");
    for (const column of [
      "sign_in_max integer NOT NULL DEFAULT 10",
      "sign_in_window_seconds integer NOT NULL DEFAULT 900",
      "mail_max integer NOT NULL DEFAULT 5",
      "mail_window_seconds integer NOT NULL DEFAULT 3600",
      "refresh_max integer NOT NULL DEFAULT 60",
      "refresh_window_seconds integer NOT NULL DEFAULT 3600",
    ]) {
      expect(sql, column).toContain(column);
    }
    // Genau eine neue Tabelle, und das ist der Zaehler. Die Einstellungen
    // bekommen keine zweite Heimat.
    expect([...sql.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]))
      .toEqual(["project_auth_rate_counters"]);
  });

  it("bounds both numbers of every kind in the database", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("project_auth_settings_rate_limits_check");
    for (const kind of ["sign_in", "mail", "refresh"]) {
      expect(sql, kind).toContain(`${kind}_max BETWEEN 1 AND 10000`);
      expect(sql, kind).toContain(`${kind}_window_seconds BETWEEN 60 AND 86400`);
    }
    // CHECK erlaubt keine Unterabfrage; eine hier waere ein Fehler beim
    // Anwenden, nicht beim Lesen.
    expect(sql).not.toMatch(/CHECK\s*\([^;]*SELECT/i);
  });

  it("keys the counter by scope, kind, hashed subject and window start", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(
      "PRIMARY KEY (organization_id, project_id, environment, kind, subject_hash, window_start)",
    );
    // Der Schluessel steht nur als Hash darin: 43 Zeichen base64url, also
    // nichts, worin eine Adresse oder eine IP Platz haette.
    expect(sql).toContain("subject_hash ~ '^[A-Za-z0-9_-]{43}$'");
    expect(sql).toContain("kind IN ('sign_in', 'mail', 'refresh')");
    // Kein Feld, das eine Adresse aufnehmen koennte.
    for (const forbidden of ["ip_address", "client_ip", "email"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
    // Die Zeile faellt mit ihrer Umgebung, wie jede andere project_auth_*-Zeile.
    expect(sql).toContain("REFERENCES project_environments (organization_id, project_id, environment)");
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("grants DELETE only on the counter and keeps the settings grants explicit", async () => {
    const sql = await readFile(migrationPath, "utf8");
    // Der Zaehler fuehrt keine Geschichte; abgelaufene Fenster muessen weg.
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON project_auth_rate_counters TO qkern_auth");
    // Die Einstellungen bekommen davon nichts ab.
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*project_auth_settings/);
    expect(sql).toContain("REVOKE UPDATE ON project_auth_settings FROM qkern_auth");
    expect(sql).toContain("mfa_required, redirect_allow_list, updated_at");
    expect(sql).toContain("refresh_max, refresh_window_seconds");
    expect(sql).toContain("REVOKE ALL ON project_auth_rate_counters FROM PUBLIC");
    expect(sql).toContain("BEGIN;");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
