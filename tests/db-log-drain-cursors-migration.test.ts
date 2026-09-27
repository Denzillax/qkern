import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `0056_project_log_drain_cursors.sql` statisch geprueft (2.64).
 *
 * Diese Tabelle haelt eine Position, und ihre Zusicherungen sind zum groessten
 * Teil die, die man ihr nicht ansieht: Sie kann keine gelesene Zeile
 * speichern, weil sie keine Spalte dafuer hat; ihre Position kann nicht
 * zurueckgedreht werden, weil DELETE fehlt und der Schreibweg monoton ist; und
 * sie haengt an **einem** Drain, nicht an einer Umgebung. Etwas Fehlendes
 * faellt bei einer Aenderung nicht von selbst auf; darum steht es hier.
 */
const FILE = path.resolve(process.cwd(), "db/migrations/0056_project_log_drain_cursors.sql");

async function migration(): Promise<string> {
  return readFile(FILE, "utf8");
}

describe("project log drain cursors migration", () => {
  it("holds one position per drain and source and nothing else", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE TABLE project_log_drain_cursors");
    const columns = [...sql.matchAll(
      /^\s{2}([a-z_]+)\s+(uuid|text|timestamptz|qkern_environment)/gm)].map((match) => match[1]);
    expect(columns).toEqual([
      "organization_id", "project_id", "environment", "webhook_id", "source",
      "position", "forwarded_at", "updated_at",
    ]);
    expect(sql).toContain(
      "PRIMARY KEY (organization_id, project_id, environment, webhook_id, source)");
    // Kein Feld, in dem ein Eintrag, ein Ziel oder ein Geheimnis liegen koennte.
    for (const forbidden of ["url", "signing_secret_ref", "payload", "entries", "fields"]) {
      expect(sql, `${forbidden} gehoert nicht in eine Position`)
        .not.toMatch(new RegExp(`^\\s{2}${forbidden}\\s`, "m"));
    }
  });

  it("compares its position by bytes, so GREATEST agrees with the reader", async () => {
    const sql = await migration();
    // Nur die Byte-Ordnung stimmt mit `(zeitpunkt, id)` ueberein. Eine
    // sprachabhaengige Sortierung ignoriert Satzzeichen.
    expect(sql).toMatch(/position text COLLATE "C" NOT NULL/);
    expect(sql).toContain("CHECK (char_length(position) <= 512)");
  });

  it("separates the moment of a forward from the moment of a write", async () => {
    const sql = await migration();
    // `forwarded_at` darf NULL sein: So sieht ein Drain aus, dessen
    // Anfangsstand festgehalten ist und der noch nichts gesendet hat.
    expect(sql).toMatch(/^\s{2}forwarded_at timestamptz,$/m);
    expect(sql).toMatch(/^\s{2}updated_at timestamptz NOT NULL DEFAULT now\(\),$/m);
  });

  it("checks the closed source list with the function from 0054", async () => {
    const sql = await migration();
    // Keine zweite Liste: Eine Quelle, die die Kopplung nicht kennt, darf auch
    // keine Position haben.
    expect(sql).toContain("CHECK (qkern_log_drain_sources_ok(ARRAY[source]))");
    expect(sql).not.toContain("CREATE FUNCTION");
  });

  it("dies with its drain and cannot be deleted on its own", async () => {
    const sql = await migration();
    expect(sql).toMatch(
      /REFERENCES project_log_drains \(organization_id, project_id, environment, webhook_id\)/);
    expect(sql).toContain("ON DELETE CASCADE");
    const grants = [...sql.matchAll(
      /^GRANT ([^O]+) ON project_log_drain_cursors TO (\w+);/gm)];
    expect(grants).toHaveLength(1);
    // UPDATE ja, DELETE nein: Wer die Position loeschen koennte, koennte einen
    // Drain an der Spitze neu beginnen lassen und damit still ueberspringen.
    expect(grants[0][1].trim()).toBe("SELECT, INSERT, UPDATE");
    expect(grants[0][2]).toBe("qkern_runtime");
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*ON project_log_drain_cursors/);
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON project_log_drain_cursors\s+FOR DELETE/);
  });

  it("enables row level security and revokes the public grant", async () => {
    const sql = await migration();
    expect(sql).toContain("ALTER TABLE project_log_drain_cursors ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON project_log_drain_cursors FROM PUBLIC");
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON project_log_drain_cursors/g)]
      .map((match) => match[1]);
    expect(policies).toEqual([
      "project_log_drain_cursors_select",
      "project_log_drain_cursors_insert",
      "project_log_drain_cursors_update",
    ]);
    for (const policy of policies) {
      expect(sql, policy).toContain("organization_id = qkern_current_organization_id()");
    }
  });

  it("runs as one transaction, like the migrations around it", async () => {
    const sql = await migration();
    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
