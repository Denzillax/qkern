import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `0050_project_database_webhook_cursors.sql` statisch geprueft (2.53).
 *
 * Diese Tabelle haelt eine Zahl, und ihre beiden Zusicherungen sind genau die,
 * die man ihr nicht ansieht: Sie kann keinen Zeilenwert speichern, weil sie
 * keine Spalte dafuer hat, und ihre Position kann nicht zurueckgedreht werden,
 * weil DELETE fehlt. Etwas Fehlendes faellt bei einer Aenderung nicht von
 * selbst auf; darum steht es hier.
 */
const FILE = path.resolve(
  process.cwd(), "db/migrations/0050_project_database_webhook_cursors.sql");

async function migration(): Promise<string> {
  return readFile(FILE, "utf8");
}

describe("project database webhook cursors migration", () => {
  it("holds one position per environment and nothing else", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE TABLE project_database_webhook_cursors");
    const columns = [...sql.matchAll(
      /^\s{2}([a-z_]+)\s+(uuid|bigint|timestamptz|qkern_environment)/gm)].map((match) => match[1]);
    expect(columns).toEqual([
      "organization_id", "project_id", "environment", "position", "updated_at",
    ]);
    expect(sql).toContain("PRIMARY KEY (organization_id, project_id, environment)");
    // 0 heisst "noch nichts gelesen"; der Feed beginnt bei 1.
    expect(sql).toContain("CHECK (position >= 0)");
  });

  it("dies with its environment and cannot be deleted on its own", async () => {
    const sql = await migration();
    expect(sql).toMatch(
      /REFERENCES project_environments \(organization_id, project_id, environment\)/);
    expect(sql).toContain("ON DELETE CASCADE");
    const grants = [...sql.matchAll(
      /^GRANT ([^O]+) ON project_database_webhook_cursors TO (\w+);/gm)];
    expect(grants).toHaveLength(1);
    // UPDATE ja, DELETE nein: Wer die Position loeschen koennte, koennte einen
    // Neustart den ganzen Feed wiederholen lassen.
    expect(grants[0][1].trim()).toBe("SELECT, INSERT, UPDATE");
    expect(grants[0][2]).toBe("qkern_runtime");
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*ON project_database_webhook_cursors/);
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON project_database_webhook_cursors\s+FOR DELETE/);
  });

  it("enables row level security and revokes the public grant", async () => {
    const sql = await migration();
    expect(sql).toContain(
      "ALTER TABLE project_database_webhook_cursors ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON project_database_webhook_cursors FROM PUBLIC");
    const policies = [...sql.matchAll(
      /CREATE POLICY (\w+) ON project_database_webhook_cursors/g)].map((match) => match[1]);
    expect(policies).toEqual([
      "project_database_webhook_cursors_select",
      "project_database_webhook_cursors_insert",
      "project_database_webhook_cursors_update",
    ]);
    for (const policy of policies) {
      expect(sql, policy).toContain("organization_id = qkern_current_organization_id()");
    }
  });
});
