import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOG_DRAIN_SOURCES } from "@/lib/console/log-drains";

/**
 * `0054_project_log_drains.sql` statisch geprueft (2.54).
 *
 * Die Zusicherungen dieses Slices stehen zum Teil als **fehlende** Spalten und
 * **fehlende** Rechte in der Migration: Die Laufzeitrolle bekommt kein UPDATE,
 * weil die Quellen unveraenderlich sein sollen, und die Tabelle hat keine
 * Spalte, in der eine Feldauswahl, ein Filter, ein Ziel oder ein Geheimnis
 * liegen koennte. Etwas Fehlendes faellt bei einer Aenderung nicht von selbst
 * auf; darum steht es hier.
 */
const FILE = path.resolve(process.cwd(), "db/migrations/0054_project_log_drains.sql");

async function migration(): Promise<string> {
  return readFile(FILE, "utf8");
}

describe("project log drains migration", () => {
  it("couples an existing webhook instead of duplicating its definition", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE TABLE project_log_drains");
    expect(sql).toMatch(/REFERENCES project_webhooks \(organization_id, project_id, environment, id\)/);
    expect(sql).toContain("ON DELETE CASCADE");
    expect(sql).toContain("UNIQUE (organization_id, project_id, environment, webhook_id)");
    // Ziel, Referenz, Zeitbudget und Versuchsgrenze bleiben in 0032.
    for (const column of ["url", "signing_secret_ref", "timeout_ms", "max_attempts", "enabled"]) {
      expect(sql, `${column} gehoert nach 0032, nicht hierher`)
        .not.toMatch(new RegExp(`^\\s+${column}\\s`, "m"));
    }
  });

  it("has no column a field selection, a filter or a secret could live in", async () => {
    const sql = await migration();
    const columns = [...sql.matchAll(
      /^\s{2}([a-z_]+)\s+(uuid|text|text\[\]|integer|timestamptz|boolean|qkern_environment)/gm)]
      .map((match) => match[1]);
    expect(columns).toEqual([
      "id", "organization_id", "project_id", "environment", "webhook_id",
      "sources", "schema_version", "created_at",
    ]);
  });

  it("checks the closed source list, including its order, in the database", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE FUNCTION qkern_log_drain_sources_ok(sources text[])");
    expect(sql).toContain("IMMUTABLE");
    expect(sql).toContain("CHECK (qkern_log_drain_sources_ok(sources))");
    for (const source of LOG_DRAIN_SOURCES) {
      expect(sql, source).toContain(`'${source}'`);
    }
    // Die Reihenfolge wird mitgeprueft, nicht nur die Menge.
    expect(sql).toContain("ORDER BY allowed.nth");
    expect(sql).toContain("cardinality(sources) BETWEEN 1 AND 5");
    // Und was nicht dasteht, ist ebenso Teil der Zusage.
    expect(sql).not.toContain("'cron_occurrences'");
    expect(sql).not.toContain("'queue_messages'");
  });

  it("grants no UPDATE, so the sources stay immutable", async () => {
    const sql = await migration();
    const grants = [...sql.matchAll(/^GRANT ([^O]+) ON project_log_drains TO (\w+);/gm)];
    expect(grants).toHaveLength(1);
    expect(grants[0][1].trim()).toBe("SELECT, INSERT, DELETE");
    expect(grants[0][2]).toBe("qkern_runtime");
    expect(sql).not.toMatch(/GRANT UPDATE/);
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON project_log_drains\s+FOR UPDATE/);
  });

  it("enables row level security and revokes the public grants", async () => {
    const sql = await migration();
    expect(sql).toContain("ALTER TABLE project_log_drains ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON project_log_drains FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON FUNCTION qkern_log_drain_sources_ok(text[]) FROM PUBLIC");
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON project_log_drains/g)]
      .map((match) => match[1]);
    expect(policies).toEqual([
      "project_log_drains_select",
      "project_log_drains_insert",
      "project_log_drains_delete",
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
