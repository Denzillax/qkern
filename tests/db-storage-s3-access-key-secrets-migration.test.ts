import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `0065_project_storage_s3_access_key_secrets.sql` statisch geprueft (2.96).
 *
 * 0059 hatte keine Spalte fuer ein Geheimnis, und der Vertrag dazu steht
 * weiter. 0065 fuegt genau eine Spalte hinzu, und sie traegt ein Chiffrat in
 * einer festen Form, nie den Wert. Der Waechter kennt sie, die Funktion fuer
 * den Endpunkt gibt nur gueltige Zeilen her, und nur die Laufzeitrolle darf
 * sie rufen. Der Fall (2.96) prueft dasselbe an der laufenden Datenbank.
 */
const FILE = path.resolve(
  process.cwd(), "db/migrations/0065_project_storage_s3_access_key_secrets.sql");

async function migration(): Promise<string> {
  return readFile(FILE, "utf8");
}

describe("project storage S3 access key secrets migration", () => {
  it("adds exactly one nullable ciphertext column in a fixed form and no plaintext column", async () => {
    const sql = await migration();
    const added = [...sql.matchAll(/ADD COLUMN ([a-z_]+)/g)].map((match) => match[1]);
    expect(added).toEqual(["secret_ciphertext"]);
    expect(sql).toMatch(/ADD COLUMN secret_ciphertext text COLLATE "C"\s*\n\s*CHECK \(secret_ciphertext IS NULL OR/);
    expect(sql).toContain(String.raw`secret_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{22}$'`);
    expect(sql).not.toMatch(/ADD COLUMN secret_ciphertext text[^,]*NOT NULL/);
    for (const forbidden of ["secret_access_key", "raw_secret", "plain_secret", "secret_value", "signing_key", "password"]) {
      expect(sql, forbidden).not.toMatch(new RegExp(`ADD COLUMN ${forbidden}\\b`));
    }
  });

  it("teaches the immutability guard the new column", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE OR REPLACE FUNCTION qkern_reject_project_storage_s3_access_key_mutation()");
    expect(sql).toContain("NEW.secret_ciphertext IS DISTINCT FROM OLD.secret_ciphertext");
    // Alle Bedingungen aus 0059 bleiben stehen.
    for (const column of ["name", "access_key_id", "secret_hash", "expires_at", "created_by", "created_at"]) {
      expect(sql, column).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
    }
    expect(sql).toContain("(OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)");
    expect(sql).toContain("USING ERRCODE = '55000'");
  });

  it("hands a pair to the endpoint only while it is valid, and only to the runtime role", async () => {
    const sql = await migration();
    expect(sql).toContain("CREATE OR REPLACE FUNCTION qkern_authenticate_project_storage_s3_access_key(p_access_key_id text)");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain("AND access_key.revoked_at IS NULL");
    expect(sql).toContain("AND access_key.expires_at > now()");
    expect(sql).toContain("AND access_key.secret_ciphertext IS NOT NULL");
    expect(sql).toContain("AND p_access_key_id ~ '^QKERNS3[A-Z2-7]{16}$'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION qkern_authenticate_project_storage_s3_access_key(text) FROM PUBLIC;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION qkern_authenticate_project_storage_s3_access_key(text) TO qkern_runtime;");
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION qkern_authenticate_project_storage_s3_access_key\(text\) TO (qkern_auth|PUBLIC|qkern_worker)/);
    // Die Rechte auf der Tabelle aendert 0065 nicht: kein neues UPDATE, kein DELETE.
    expect(sql).not.toMatch(/GRANT (UPDATE|DELETE)/);
  });
});
