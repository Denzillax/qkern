import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import { isCatalogReference } from "@/lib/server/migrations/connection-catalog";
import {
  VaultProjectDatabaseConnectionCatalog,
  VaultProjectDatabaseCatalogError,
  type VaultProjectDatabaseCatalogOptions,
} from "@/lib/server/migrations/connection-catalog-vault";
import type {
  ProjectDatabaseConnectionResolver,
  ResolvedProjectDatabaseConnection,
} from "@/lib/server/migrations/postgres-executor";
import { PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256 } from "@/lib/server/provisioning/contract";

/**
 * Resolves immutable, secret-free bindings from the control plane and delegates
 * credentials exclusively to Vault. References, never connection strings, cross
 * the migration queue boundary.
 */
export class PersistedVaultProjectDatabaseConnectionCatalog
implements ProjectDatabaseConnectionResolver {
  private readonly catalogs = new Map<string, VaultProjectDatabaseConnectionCatalog>();
  private readonly loading = new Map<string, Promise<VaultProjectDatabaseConnectionCatalog>>();
  private state: "open" | "closing" | "closed" = "open";
  private closePromise?: Promise<void>;

  constructor(
    private readonly database: Pick<PostgresControlPlane, "withTenant">,
    private readonly organizationId: string,
    private readonly vaultOptions: Omit<VaultProjectDatabaseCatalogOptions, "bindings">,
  ) {}

  async resolve(databaseInstanceRef: string): Promise<ResolvedProjectDatabaseConnection> {
    if (this.state !== "open") throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
    if (!isCatalogReference(databaseInstanceRef)) {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_REFERENCE_NOT_ALLOWED");
    }
    const catalog = this.catalogs.get(databaseInstanceRef) ?? await this.load(databaseInstanceRef);
    if (this.state !== "open") throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
    return catalog.resolve(databaseInstanceRef);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.state = "closing";
    this.closePromise = this.closeAll();
    return this.closePromise;
  }

  private load(databaseInstanceRef: string): Promise<VaultProjectDatabaseConnectionCatalog> {
    const active = this.loading.get(databaseInstanceRef);
    if (active) return active;
    const pending = this.loadBinding(databaseInstanceRef).finally(() => {
      if (this.loading.get(databaseInstanceRef) === pending) this.loading.delete(databaseInstanceRef);
    });
    this.loading.set(databaseInstanceRef, pending);
    return pending;
  }

  private async loadBinding(databaseInstanceRef: string): Promise<VaultProjectDatabaseConnectionCatalog> {
    try {
      const binding = await this.database.withTenant({
        organizationId: this.organizationId,
        actorRef: "migration-catalog",
        readOnly: true,
      }, (repositories) => repositories.projectDatabaseBindings.getByReference(databaseInstanceRef));
      if (binding.bootstrapContractSha256 !== PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256) {
        throw new Error("Unverified bootstrap contract");
      }
      const catalog = new VaultProjectDatabaseConnectionCatalog({
        ...this.vaultOptions,
        bindings: [{
          databaseInstanceRef: binding.databaseInstanceRef,
          vaultStaticRole: binding.vaultStaticRole,
          host: binding.host,
          port: binding.port,
          expectedRole: binding.expectedRole,
          expectedDatabase: binding.expectedDatabase,
          expectedLedgerOwner: binding.expectedLedgerOwner,
          serverCertificateSha256: binding.serverCertificateSha256,
        }],
      });
      if (this.state !== "open") {
        await catalog.close().catch(() => undefined);
        throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
      }
      this.catalogs.set(databaseInstanceRef, catalog);
      return catalog;
    } catch (error) {
      if (error instanceof VaultProjectDatabaseCatalogError &&
          error.code === "PROJECT_DATABASE_CATALOG_CLOSED") throw error;
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_REFERENCE_NOT_ALLOWED");
    }
  }

  private async closeAll(): Promise<void> {
    await Promise.allSettled(this.loading.values());
    const results = await Promise.allSettled([...this.catalogs.values()].map((catalog) => catalog.close()));
    this.catalogs.clear();
    this.state = "closed";
    if (results.some((result) => result.status === "rejected")) {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSE_FAILED");
    }
  }
}
