import { describe, expect, it, vi } from "vitest";
import type { SqlPool } from "@/lib/server/db/sql";
import { createLocalProjectDatabaseCatalogFromEnv } from "@/lib/server/migrations/connection-catalog-env";

function pool(): SqlPool {
  return {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as SqlPool;
}

const catalogJson = JSON.stringify([{
  databaseInstanceRef: "managed:database-1",
  connectionString: "postgresql://qkern_project_migrator:local-secret@localhost/project_database",
  expectedRole: "qkern_project_migrator",
  expectedDatabase: "project_database",
  expectedLedgerOwner: "qkern_ledger_owner",
}]);

describe("local project database catalog adapter", () => {
  it("is opt-in and always refuses raw catalog URLs in production", async () => {
    await expect(createLocalProjectDatabaseCatalogFromEnv({
      NODE_ENV: "development",
      QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON: catalogJson,
    }, () => pool())).rejects.toThrow("disabled");
    await expect(createLocalProjectDatabaseCatalogFromEnv({
      NODE_ENV: "production",
      QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG: "true",
      QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON: catalogJson,
    }, () => pool())).rejects.toThrow("vault-backed");
  });

  it("creates an exact local allowlist without exposing the URL in resolved metadata", async () => {
    const factory = vi.fn(() => pool());
    const catalog = await createLocalProjectDatabaseCatalogFromEnv({
      NODE_ENV: "development",
      DATABASE_SSL: "disable",
      QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG: "true",
      QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON: catalogJson,
    }, factory);

    expect(catalog.resolve("managed:database-1")).toMatchObject({
      expectedRole: "qkern_project_migrator",
      expectedDatabase: "project_database",
      expectedLedgerOwner: "qkern_ledger_owner",
    });
    expect(JSON.stringify(catalog.resolve("managed:database-1"))).not.toContain("local-secret");
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ max: 2, statementTimeoutMillis: 15_000 }));
    await catalog.close();
  });

  it("returns one fixed sanitized error for malformed or credential-poisoned input", async () => {
    const poisoned = "postgresql://admin:super-secret@attacker.invalid/database";
    let error: unknown;
    try {
      await createLocalProjectDatabaseCatalogFromEnv({
        NODE_ENV: "development",
        QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG: "true",
        QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON: JSON.stringify([{
          databaseInstanceRef: "postgresql://admin:super-secret@attacker.invalid/database",
          connectionString: poisoned,
          expectedRole: "qkern_project_migrator",
          expectedDatabase: "project_database",
          expectedLedgerOwner: "qkern_ledger_owner",
        }]),
      }, () => pool());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toContain("super-secret");
    expect((error as Error).message).toBe("The local project database catalog configuration is invalid.");
  });
});
