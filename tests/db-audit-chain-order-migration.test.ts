import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0047 (2.36): Der Trigger der Audit-Kette setzt created_at unter dem Lock,
 * damit die Kettenreihenfolge gleich der Ordnung (created_at, id) ist.
 */
describe("Audit chain order migration", () => {
  it("replaces the chain trigger function with a monotonic created_at and keeps its security mode", async () => {
    const sql = await readFile(path.resolve(process.cwd(), "db/migrations/0047_audit_chain_order.sql"), "utf8");
    const code = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
    expect(code).toContain("CREATE OR REPLACE FUNCTION qkern_prepare_audit_log()");
    expect(code).toContain("greatest(clock_timestamp()");
    expect(code).toContain("interval '1 microsecond'");
    expect(code).toContain("ORDER BY created_at DESC, id DESC");
    expect(code).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(code).not.toMatch(/\bDROP\b/i);
    // created_at ist Teil des Hashes: die Zuweisung muss vor der Berechnung stehen.
    expect(code.indexOf("NEW.created_at :=")).toBeGreaterThan(-1);
    expect(code.indexOf("NEW.created_at :=")).toBeLessThan(code.indexOf("NEW.entry_hash ="));
    expect(code).toContain("'created_at', NEW.created_at");
  });
});
