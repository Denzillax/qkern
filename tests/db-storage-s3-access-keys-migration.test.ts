import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `0059_project_storage_s3_access_keys.sql` statisch geprueft (2.78).
 *
 * Die Zusicherungen dieses Slices stehen zum guten Teil als **fehlende**
 * Spalten und **fehlende** Rechte in der Migration. Es gibt keine Spalte, in
 * der ein Geheimnis liegen koennte, und die Laufzeitrolle bekommt auf der
 * Schluesseltabelle kein DELETE, weil Widerruf nicht loeschen ist. Etwas
 * Fehlendes faellt bei einer Aenderung nicht von selbst auf; darum steht es
 * hier. Der Fall (2.78) prueft dasselbe an der laufenden Datenbank.
 */
const FILE = path.resolve(
  process.cwd(), "db/migrations/0059_project_storage_s3_access_keys.sql");

async function migration(): Promise<string> {
  return readFile(FILE, "utf8");
}

describe("project storage S3 access keys migration", () => {
  it("has no column a secret value could live in", async () => {
    const sql = await migration();
    const columns = [...sql.matchAll(
      /^\s{2}([a-z_]+)\s+(uuid|text|text\[\]|integer|timestamptz|boolean|qkern_environment)/gm)]
      .map((match) => match[1]);
    expect(columns).toEqual([
      "id", "organization_id", "project_id", "environment", "name",
      "access_key_id", "secret_hash", "expires_at", "revoked_at", "created_by", "created_at",
      "organization_id", "project_id", "environment", "key_id", "bucket_id", "created_at",
    ]);
    // Genau eine Spalte darf nach einem Geheimnis klingen, und sie traegt den
    // Hash. Kaeme je eine zweite hinzu, die den Wert aufnehmen koennte, faellt
    // dieser Fall zusammen mit (2.78).
    for (const forbidden of [
      "secret", "secret_access_key", "raw_secret", "plain_secret", "secret_value",
      "signing_key", "password", "token",
    ]) {
      expect(sql, forbidden).not.toMatch(new RegExp(`^\\s+${forbidden}\\s`, "m"));
    }
    expect(sql).toMatch(/secret_hash text COLLATE "C" NOT NULL UNIQUE/);
    expect(sql).toContain("CHECK (secret_hash ~ '^[A-Za-z0-9_-]{43}$')");
  });

  it("names its own public prefix instead of imitating a provider key", async () => {
    const sql = await migration();
    // Ein Paar, das aussieht wie ein Zugang zum Objektspeicher und keiner ist,
    // waere die Unehrlichkeit, die dieser Slice vermeidet.
    expect(sql).toContain("CHECK (access_key_id ~ '^QKERNS3[A-Z2-7]{16}$')");
    expect(sql).not.toContain("AKIA");
  });

  it("ties a key to one project environment and to real buckets", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE TABLE project_storage_s3_access_keys");
    expect(sql).toContain("CREATE TABLE project_storage_s3_access_key_buckets");
    expect(sql).toMatch(
      /REFERENCES project_environments \(organization_id, project_id, environment\)/);
    // Der Bucket-Satz ist eine Kopplungstabelle mit echtem Fremdschluessel und
    // kein uuid[]: Ein geloeschter Bucket bliebe sonst als Nummer stehen, die
    // auf nichts zeigt.
    expect(sql).toMatch(
      /REFERENCES project_storage_buckets \(organization_id, project_id, environment, id\)/);
    expect(sql).toMatch(
      /REFERENCES project_storage_s3_access_keys \(organization_id, project_id, environment, id\)/);
    expect(sql).not.toMatch(/^\s+bucket_ids\s/m);
  });

  it("allows revocation only once and only in one direction", async () => {
    const sql = await migration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION qkern_reject_project_storage_s3_access_key_mutation()");
    expect(sql).toContain("USING ERRCODE = '55000'");
    expect(sql).toContain(
      "(OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)");
    expect(sql).toContain("CREATE TRIGGER project_storage_s3_access_keys_immutable");
    for (const column of ["name", "access_key_id", "secret_hash", "expires_at", "created_by"]) {
      expect(sql, column).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
    }
  });

  it("grants no DELETE on the keys, because revocation is not deletion", async () => {
    const sql = await migration();
    expect(sql).toContain("GRANT SELECT, INSERT ON project_storage_s3_access_keys TO qkern_runtime");
    expect(sql).toContain("GRANT UPDATE (revoked_at) ON project_storage_s3_access_keys TO qkern_runtime");
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*ON project_storage_s3_access_keys\b/);
    // Auf der Kopplung gibt es DELETE nur, damit das Loeschen eines Buckets
    // ueber den Fremdschluessel durchgreifen kann.
    expect(sql).toContain(
      "GRANT SELECT, INSERT, DELETE ON project_storage_s3_access_key_buckets TO qkern_runtime");
    for (const table of ["project_storage_s3_access_keys", "project_storage_s3_access_key_buckets"]) {
      expect(sql, table).toContain(`REVOKE ALL ON ${table} FROM PUBLIC`);
      expect(sql, table).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
    // Sieben Mandantengrenzen: vier auf der Schluesseltabelle (SELECT, INSERT
    // und UPDATE mit USING und WITH CHECK) und drei auf der Kopplung.
    expect([...sql.matchAll(/qkern_current_organization_id\(\)/g)].length).toBe(7);
  });

  it("writes down why neither access path is built", async () => {
    const sql = await migration();
    // Die Begruendung gehoert in die Migration, weil sie erklaert, warum diese
    // Tabelle nur eine Erklaerung haelt und keinen Zugang.
    expect(sql).toContain("ProjectStorageProvider");
    expect(sql).toContain("QKERN_PROJECT_STORAGE_S3_BUCKET");
    expect(sql).toContain("SigV4");
    expect(sql).toContain("versitygw");
  });
});
