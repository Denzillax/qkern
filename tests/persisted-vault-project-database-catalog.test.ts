import { describe, expect, it, vi } from "vitest";
import type { ProjectDatabaseBindingRecord } from "@/lib/server/db/models";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PersistedVaultProjectDatabaseConnectionCatalog } from "@/lib/server/migrations/connection-catalog-vault-persisted";
import { PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256 } from "@/lib/server/provisioning/contract";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const binding: ProjectDatabaseBindingRecord = {
  id: "f9a5c34f-5886-4a67-af2d-991cc5036ff3",
  organizationId: ORGANIZATION_ID,
  projectId: "9730b448-7fd0-4c4f-9553-33220752bdf6",
  environment: "production",
  provisioningJobId: "940cb242-32d6-41fd-b244-67d4913f7b91",
  databaseInstanceRef: "managed:database-1",
  vaultStaticRole: "project-database-1",
  host: "db.customer.example",
  port: 5432,
  expectedRole: "qkern_project_migrator",
  expectedDatabase: "project_database",
  expectedLedgerOwner: "qkern_ledger_owner",
  serverCertificateSha256: "ab".repeat(32),
  bootstrapContractSha256: PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256,
  createdAt: "2026-07-20T08:00:00.000Z",
};

function fixture(stored: ProjectDatabaseBindingRecord = binding) {
  const getByReference = vi.fn(async () => stored);
  const withTenant = vi.fn(async (_context, operation: (repositories: unknown) => Promise<unknown>) =>
    operation({ projectDatabaseBindings: { getByReference } }));
  const database = { withTenant } as unknown as Pick<PostgresControlPlane, "withTenant">;
  const catalog = new PersistedVaultProjectDatabaseConnectionCatalog(database, ORGANIZATION_ID, {
    vaultDatabaseUrl: new URL("https://vault.service.internal/v1/database"),
    tokenProvider: { getToken: vi.fn(async () => "hvs.test-token") },
    production: true,
    fetchFn: vi.fn<typeof fetch>(),
    poolFactory: vi.fn(),
  });
  return { catalog, withTenant, getByReference };
}

describe("persisted Vault project database catalog", () => {
  it("singleflights tenant-scoped binding lookup and exposes no stored endpoint details", async () => {
    const { catalog, withTenant, getByReference } = fixture();
    const [first, second] = await Promise.all([
      catalog.resolve(binding.databaseInstanceRef),
      catalog.resolve(binding.databaseInstanceRef),
    ]);
    expect(first).toBe(second);
    expect(first).toMatchObject({
      expectedRole: binding.expectedRole,
      expectedDatabase: binding.expectedDatabase,
      expectedLedgerOwner: binding.expectedLedgerOwner,
    });
    expect(withTenant).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID, actorRef: "migration-catalog", readOnly: true,
    }, expect.any(Function));
    expect(getByReference).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toMatch(/host|password|token|vaultStaticRole/i);
    await catalog.close();
  });

  it("rejects bootstrap drift and unknown or URL-shaped references with one redacted error", async () => {
    const drift = fixture({ ...binding, bootstrapContractSha256: "cd".repeat(32) }).catalog;
    await expect(drift.resolve(binding.databaseInstanceRef)).rejects.toMatchObject({
      code: "PROJECT_DATABASE_REFERENCE_NOT_ALLOWED",
    });
    await drift.close();

    const { catalog, getByReference } = fixture();
    await expect(catalog.resolve("postgresql://admin:secret@attacker.invalid/db")).rejects.toMatchObject({
      code: "PROJECT_DATABASE_REFERENCE_NOT_ALLOWED",
    });
    expect(getByReference).not.toHaveBeenCalled();
    await catalog.close();
  });

  it("fails closed and idempotently after shutdown", async () => {
    const { catalog } = fixture();
    await catalog.resolve(binding.databaseInstanceRef);
    const closing = catalog.close();
    expect(catalog.close()).toBe(closing);
    await closing;
    await expect(catalog.resolve(binding.databaseInstanceRef)).rejects.toMatchObject({
      code: "PROJECT_DATABASE_CATALOG_CLOSED",
    });
  });
});
