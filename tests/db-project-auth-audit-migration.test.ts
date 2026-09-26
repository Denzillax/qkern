import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0046 (2.35): Die Auth-Rolle darf die Audit-Kette lesen und anhaengen, aber
 * nur eigene Aktionen, und nie etwas aendern oder loeschen.
 */
describe("Project Auth audit migration", () => {
  it("grants only SELECT and INSERT on audit_logs and restricts inserts to project_auth actions", async () => {
    const sql = await readFile(path.resolve(process.cwd(), "db/migrations/0046_project_auth_audit.sql"), "utf8");
    const code = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
    expect(code).toContain("GRANT SELECT, INSERT ON audit_logs TO qkern_auth;");
    expect(code).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b[^;]*ON audit_logs/i);
    expect(code).not.toMatch(/ALTER POLICY|DROP POLICY|BYPASSRLS|DISABLE ROW LEVEL SECURITY/i);
    expect(code).toContain(
      "CREATE POLICY audit_logs_project_auth_insert ON audit_logs AS RESTRICTIVE\n" +
      "  FOR INSERT TO qkern_auth WITH CHECK (starts_with(action, 'project_auth.'));",
    );
    expect(code).not.toMatch(/CREATE POLICY[^;]*FOR SELECT/i);
  });
});
