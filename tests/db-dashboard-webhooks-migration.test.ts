import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_EVENT_KINDS } from "@/lib/console/dashboard-webhooks";

/**
 * `0057_project_dashboard_webhooks.sql` statisch geprueft (2.75).
 *
 * Die Zusicherungen dieses Slices stehen zum Teil als **fehlende** Spalten und
 * **fehlende** Rechte in der Migration: Die Laufzeitrolle bekommt auf der
 * Kopplung kein UPDATE, weil die Ereignisarten unveraenderlich sein sollen, und
 * die Tabellen haben keine Spalte, in der ein Ereignis, eine Feldauswahl, ein
 * Filter, ein Ziel oder ein Geheimnis liegen koennte. Etwas Fehlendes faellt bei
 * einer Aenderung nicht von selbst auf; darum steht es hier.
 */
const FILE = path.resolve(
  process.cwd(), "db/migrations/0057_project_dashboard_webhooks.sql");

async function migration(): Promise<string> {
  return readFile(FILE, "utf8");
}

describe("project dashboard webhooks migration", () => {
  it("couples an existing webhook instead of duplicating its definition", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE TABLE project_dashboard_webhooks");
    expect(sql).toMatch(
      /REFERENCES project_webhooks \(organization_id, project_id, environment, id\)/);
    expect(sql).toContain("ON DELETE CASCADE");
    expect(sql).toContain("UNIQUE (organization_id, project_id, environment, webhook_id)");
    // Ziel, Referenz, Zeitbudget und Versuchsgrenze bleiben in 0032.
    for (const column of ["url", "signing_secret_ref", "timeout_ms", "max_attempts", "enabled"]) {
      expect(sql, `${column} gehoert nach 0032, nicht hierher`)
        .not.toMatch(new RegExp(`^\\s+${column}\\s`, "m"));
    }
  });

  it("has no column an event, a field selection or an actor could live in", async () => {
    const sql = await migration();
    const columns = [...sql.matchAll(
      /^\s{2}([a-z_]+)\s+(uuid|text|text\[\]|integer|timestamptz|boolean|qkern_environment)/gm)]
      .map((match) => match[1]);
    expect(columns).toEqual([
      "id", "organization_id", "project_id", "environment", "webhook_id",
      "kinds", "schema_version", "created_at",
      "organization_id", "project_id", "environment", "webhook_id",
      "kind", "position", "notified_at", "updated_at",
    ]);
    // Die Ereignisse selbst bleiben in audit_logs. Eine zweite Wahrheit ueber
    // dieselben Vorgaenge waere die erste, die beim Auseinanderfallen niemand
    // bemerkt.
    for (const forbidden of ["actor_ref", "actor_type", "payload", "entry_hash", "fields", "filter"]) {
      expect(sql, forbidden).not.toMatch(new RegExp(`^\\s+${forbidden}\\s`, "m"));
    }
  });

  it("checks the closed kind list, including its order, in the database", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE FUNCTION qkern_dashboard_event_kinds_ok(kinds text[])");
    expect(sql).toContain("IMMUTABLE");
    expect(sql).toContain("CHECK (qkern_dashboard_event_kinds_ok(kinds))");
    for (const kind of DASHBOARD_EVENT_KINDS) {
      expect(sql, kind).toContain(`'${kind}'`);
    }
    // Die Reihenfolge wird mitgeprueft, nicht nur die Menge.
    expect(sql).toContain("ORDER BY allowed.nth");
    expect(sql).toContain(`cardinality(kinds) BETWEEN 1 AND ${DASHBOARD_EVENT_KINDS.length}`);
    // Und was nicht dasteht, ist ebenso Teil der Zusage: Die Zwischenstaende
    // eines Migrationslaufs sind keine Ereignisart.
    expect(sql).not.toContain("'migration_queued'");
    expect(sql).not.toContain("'table_changed'");
  });

  it("keeps the position monotonic, byte-ordered and tied to its coupling", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE TABLE project_dashboard_webhook_cursors");
    expect(sql).toContain('position text COLLATE "C" NOT NULL');
    // Monoton geschrieben wird in der Anweisung des Repositorys, nicht im
    // Prozess. Die Migration haelt dafuer die Ordnung fest, in der `GREATEST`
    // vergleicht; geprueft werden beide Haelften.
    const repository = await readFile(path.resolve(
      process.cwd(), "lib/server/compute/dashboard-webhook-cursor-postgres-repository.ts"), "utf8");
    expect(repository).toContain("GREATEST(project_dashboard_webhook_cursors.position");
    expect(repository).toContain("DO NOTHING");
    expect(sql).toMatch(
      /REFERENCES project_dashboard_webhooks \(organization_id, project_id, environment, webhook_id\)/);
    expect(sql).toContain("CHECK (qkern_dashboard_event_kinds_ok(ARRAY[kind]))");
  });

  it("grants no UPDATE on the coupling and no DELETE on the position", async () => {
    const sql = await migration();
    expect(sql).toContain("GRANT SELECT, INSERT, DELETE ON project_dashboard_webhooks TO qkern_runtime");
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE ON project_dashboard_webhook_cursors TO qkern_runtime");
    expect(sql).toContain("REVOKE ALL ON project_dashboard_webhooks FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON project_dashboard_webhook_cursors FROM PUBLIC");
    // Beide Tabellen tragen RLS mit derselben Mandantengrenze wie der Rest der
    // Control Plane.
    for (const table of ["project_dashboard_webhooks", "project_dashboard_webhook_cursors"]) {
      expect(sql, table).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect([...sql.matchAll(/qkern_current_organization_id\(\)/g)].length)
      .toBeGreaterThanOrEqual(7);
  });
});
