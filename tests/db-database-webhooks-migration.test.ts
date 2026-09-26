import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `0048_project_database_webhooks.sql` statisch geprueft (2.50).
 *
 * Die Zusicherungen dieses Slices stehen zum Teil als **fehlende** Rechte in
 * der Migration: Die Laufzeitrolle bekommt kein UPDATE, weil Tabelle und
 * Ereignisse unveraenderlich sein sollen, und die Tabelle hat keine Spalte, in
 * der ein Zeilenwert oder ein Geheimnis liegen koennte. Etwas Fehlendes faellt
 * bei einer Aenderung nicht von selbst auf; darum steht es hier.
 */
const FILE = path.resolve(process.cwd(), "db/migrations/0048_project_database_webhooks.sql");

async function migration(): Promise<string> {
  return readFile(FILE, "utf8");
}

describe("project database webhooks migration", () => {
  it("couples an existing webhook instead of duplicating its definition", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE TABLE project_database_webhooks");
    expect(sql).toMatch(/REFERENCES project_webhooks \(organization_id, project_id, environment, id\)/);
    expect(sql).toContain("ON DELETE CASCADE");
    // Hoechstens eine Kopplung je Webhook, sonst koennte die Liste nicht
    // sagen, welche eine Zustellung ausgeloest hat.
    expect(sql).toContain("UNIQUE (organization_id, project_id, environment, webhook_id)");
    // Ziel, Referenz, Zeitbudget und Versuchsgrenze bleiben in 0032.
    for (const column of ["url", "signing_secret_ref", "timeout_ms", "max_attempts", "enabled"]) {
      expect(sql, `${column} gehoert nach 0032, nicht hierher`)
        .not.toMatch(new RegExp(`^\\s+${column}\\s`, "m"));
    }
  });

  it("has no column a row value or a secret could live in", async () => {
    const sql = await migration();
    const columns = [...sql.matchAll(
      /^\s{2}([a-z_]+)\s+(uuid|text|text\[\]|timestamptz|boolean|qkern_environment)/gm)]
      .map((match) => match[1]);
    expect(columns).toEqual([
      "id", "organization_id", "project_id", "environment", "webhook_id",
      "schema_name", "table_name", "events", "created_at",
    ]);
  });

  it("keeps the schema fixed and the table name inside the identifier grammar", async () => {
    const sql = await migration();
    expect(sql).toContain("CHECK (schema_name = 'public')");
    // Dieselbe Grammatik wie `lib/server/data-plane/identifiers`.
    expect(sql).toContain("CHECK (table_name ~ '^[A-Za-z_][A-Za-z0-9_]{0,62}$')");
  });

  it("writes the closed event list out, including its order", async () => {
    const sql = await migration();
    for (const allowed of ["ARRAY['insert']", "ARRAY['update']", "ARRAY['delete']",
      "ARRAY['insert', 'update']", "ARRAY['insert', 'delete']", "ARRAY['update', 'delete']",
      "ARRAY['insert', 'update', 'delete']"]) {
      expect(sql, allowed).toContain(allowed);
    }
    // Was nicht dasteht, ist ebenso Teil der Zusage.
    expect(sql).not.toContain("'truncate'");
    expect(sql).not.toContain("ARRAY['delete', 'insert']");
  });

  it("grants no UPDATE, so table and events stay immutable", async () => {
    const sql = await migration();
    const grants = [...sql.matchAll(/^GRANT ([^O]+) ON project_database_webhooks TO (\w+);/gm)];
    expect(grants).toHaveLength(1);
    expect(grants[0][1].trim()).toBe("SELECT, INSERT, DELETE");
    expect(grants[0][2]).toBe("qkern_runtime");
    expect(sql).not.toMatch(/GRANT UPDATE/);
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON project_database_webhooks\s+FOR UPDATE/);
  });

  it("enables row level security and revokes the public grant", async () => {
    const sql = await migration();
    expect(sql).toContain("ALTER TABLE project_database_webhooks ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON project_database_webhooks FROM PUBLIC");
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON project_database_webhooks/g)]
      .map((match) => match[1]);
    expect(policies).toEqual([
      "project_database_webhooks_select",
      "project_database_webhooks_insert",
      "project_database_webhooks_delete",
    ]);
    for (const policy of policies) {
      expect(sql, policy).toContain("organization_id = qkern_current_organization_id()");
    }
  });
});
