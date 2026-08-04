import { describe, expect, it, vi } from "vitest";
import type { SqlPool } from "@/lib/server/db/sql";
import {
  isCatalogReference,
  ProjectDatabaseCatalogError,
  TrustedProjectDatabaseConnectionCatalog,
  type ProjectDatabaseCatalogEntry,
} from "@/lib/server/migrations/connection-catalog";

function pool(end: () => Promise<void> = async () => undefined): SqlPool {
  return {
    connect: async () => { throw new Error("not used"); },
    query: async () => ({ rows: [], rowCount: 0 }),
    end,
  };
}

function entry(overrides: Partial<ProjectDatabaseCatalogEntry> = {}): ProjectDatabaseCatalogEntry {
  return {
    databaseInstanceRef: "managed:database-1",
    pool: pool(),
    expectedRole: "qkern_project_migrator",
    expectedDatabase: "project_database",
    expectedLedgerOwner: "qkern_ledger_owner",
    ...overrides,
  };
}

describe("trusted project database connection catalog", () => {
  it("resolves only an exact provisioner-owned allowlist binding", () => {
    const configured = entry();
    const catalog = new TrustedProjectDatabaseConnectionCatalog([configured]);

    expect(catalog.resolve("managed:database-1")).toEqual({
      pool: configured.pool,
      expectedRole: "qkern_project_migrator",
      expectedDatabase: "project_database",
      expectedLedgerOwner: "qkern_ledger_owner",
    });
    expect(Object.isFrozen(catalog.resolve("managed:database-1"))).toBe(true);
  });

  it("is disabled by default and fails closed for unknown references", () => {
    const catalog = new TrustedProjectDatabaseConnectionCatalog();
    expect(() => catalog.resolve("managed:not-allowlisted")).toThrowError(expect.objectContaining({
      code: "PROJECT_DATABASE_REFERENCE_NOT_ALLOWED",
    }));
  });

  it("uses the same sanitized error for malformed, URL and unknown references", () => {
    const catalog = new TrustedProjectDatabaseConnectionCatalog([entry()]);
    const inputs = [
      "managed:missing",
      "postgres://admin:extremely-secret@customer.internal/project",
      "managed:database-1@attacker",
      "pending:database-1",
      "MANAGED:database-1",
    ];

    for (const input of inputs) {
      try {
        catalog.resolve(input);
        throw new Error("expected resolution failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectDatabaseCatalogError);
        expect(error).toMatchObject({ code: "PROJECT_DATABASE_REFERENCE_NOT_ALLOWED" });
        expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
        expect(String(error)).not.toContain(input);
        expect(String(error)).not.toContain("extremely-secret");
      }
    }
  });

  it("strictly validates references and PostgreSQL identifiers", () => {
    expect(isCatalogReference("managed:database-1")).toBe(true);
    for (const invalid of ["managed:", "managed:_database", "managed:database.", "managed:database/1", `managed:${"a".repeat(129)}`]) {
      expect(isCatalogReference(invalid)).toBe(false);
      expect(() => new TrustedProjectDatabaseConnectionCatalog([entry({ databaseInstanceRef: invalid })]))
        .toThrowError(expect.objectContaining({ code: "INVALID_CATALOG_ENTRY" }));
    }

    for (const overrides of [
      { expectedRole: "ProjectOwner" },
      { expectedRole: "pg_write_all_data" },
      { expectedDatabase: "project-database" },
      { expectedDatabase: `d${"b".repeat(63)}` },
      { expectedLedgerOwner: "pg_database_owner" },
      { expectedLedgerOwner: "qkern_project_migrator" },
    ]) {
      expect(() => new TrustedProjectDatabaseConnectionCatalog([entry(overrides)]))
        .toThrowError(expect.objectContaining({ code: "INVALID_CATALOG_ENTRY" }));
    }
  });

  it("rejects duplicate references and reuse of one pool across aliases", () => {
    const sharedPool = pool();
    for (const entries of [
      [entry({ pool: sharedPool }), entry({ pool: pool() })],
      [entry({ pool: sharedPool }), entry({ databaseInstanceRef: "managed:database-2", pool: sharedPool })],
    ]) {
      expect(() => new TrustedProjectDatabaseConnectionCatalog(entries))
        .toThrowError(expect.objectContaining({ code: "DUPLICATE_CATALOG_BINDING" }));
    }
  });

  it("copies boundary metadata instead of retaining a mutable entry object", () => {
    const configured = entry() as { expectedRole: string } & ProjectDatabaseCatalogEntry;
    const catalog = new TrustedProjectDatabaseConnectionCatalog([configured]);
    configured.expectedRole = "attacker_role";
    expect(catalog.resolve("managed:database-1").expectedRole).toBe("qkern_project_migrator");
  });

  it("closes every owned pool exactly once and rejects resolution once closing starts", async () => {
    const firstEnd = vi.fn(async () => undefined);
    const secondEnd = vi.fn(async () => undefined);
    const catalog = new TrustedProjectDatabaseConnectionCatalog([
      entry({ pool: pool(firstEnd) }),
      entry({ databaseInstanceRef: "managed:database-2", pool: pool(secondEnd) }),
    ]);

    const closing = catalog.close();
    expect(() => catalog.resolve("managed:database-1")).toThrowError(expect.objectContaining({
      code: "PROJECT_DATABASE_CATALOG_CLOSED",
    }));
    expect(catalog.close()).toBe(closing);
    await closing;
    expect(firstEnd).toHaveBeenCalledTimes(1);
    expect(secondEnd).toHaveBeenCalledTimes(1);
  });

  it("attempts all pool closes and sanitizes driver failures", async () => {
    const secondEnd = vi.fn(async () => undefined);
    const catalog = new TrustedProjectDatabaseConnectionCatalog([
      entry({ pool: pool(() => { throw new Error("postgres://admin:secret@host/db"); }) }),
      entry({ databaseInstanceRef: "managed:database-2", pool: pool(secondEnd) }),
    ]);

    const error = await catalog.close().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProjectDatabaseCatalogError);
    expect(error).toMatchObject({ code: "PROJECT_DATABASE_CATALOG_CLOSE_FAILED" });
    expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
    expect(String(error)).not.toContain("secret");
    expect(secondEnd).toHaveBeenCalledTimes(1);
  });
});
