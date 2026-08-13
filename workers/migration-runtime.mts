import { closePostgresPool, getWorkerPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { createLocalProjectDatabaseCatalogFromEnv } from "@/lib/server/migrations/connection-catalog-env";
import { VaultTokenFileProvider } from "@/lib/server/migrations/connection-catalog-vault";
import { createVaultProjectDatabaseCatalogFromEnv } from "@/lib/server/migrations/connection-catalog-vault-env";
import { vaultCatalogRuntimeOptionsFromEnv } from "@/lib/server/migrations/connection-catalog-vault-env";
import { PersistedVaultProjectDatabaseConnectionCatalog } from "@/lib/server/migrations/connection-catalog-vault-persisted";
import type { ProjectDatabaseConnectionResolver } from "@/lib/server/migrations/postgres-executor";
import { createMigrationWorkerRuntimeFromEnv } from "@/lib/server/migrations/runtime-composition";
import { createLoopbackRuntimeProbeFromEnv } from "@/lib/server/operations/runtime-probe";

const controller = new AbortController();
const requestStop = () => controller.abort();
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

let catalog: (ProjectDatabaseConnectionResolver & { close(): Promise<void> }) | undefined;
const probe = createLoopbackRuntimeProbeFromEnv(process.env);
try {
  if (process.env.NODE_ENV === "production") {
    const tokenProvider = new VaultTokenFileProvider(process.env.QKERN_VAULT_TOKEN_FILE?.trim() ?? "", {
      production: true,
    });
    if (process.env.QKERN_PROJECT_DATABASE_CATALOG_SOURCE === "static-env") {
      catalog = createVaultProjectDatabaseCatalogFromEnv(process.env, { tokenProvider });
    } else {
      if (process.env.QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON !== undefined) {
        throw new Error("Static project database bindings cannot be mixed with the control-plane catalog.");
      }
      const organizationId = process.env.QKERN_WORKER_ORGANIZATION_ID?.trim() ?? "";
      catalog = new PersistedVaultProjectDatabaseConnectionCatalog(
        new PostgresControlPlane(getWorkerPostgresPool(process.env)),
        organizationId,
        vaultCatalogRuntimeOptionsFromEnv(process.env, { tokenProvider }),
      );
    }
  } else {
    catalog = await createLocalProjectDatabaseCatalogFromEnv(process.env);
  }
  const runtime = createMigrationWorkerRuntimeFromEnv(process.env, {
    catalog,
    // Der Runtime-Logger meldet Runden, der Worker-Logger einzelne Auftraege.
    // Bis Release 1.51 setzte dieser Prozess nur den ersten und verwarf damit
    // jedes auftragsbezogene Ereignis — auch die Namen der verletzten
    // Grenzbedingungen. Beide Ereignisse sind redigiert: Ids und feste Codes,
    // keine Meldungen der Datenbank.
    workerLogger: { log: (event) => console.info(JSON.stringify(event)) },
    runtimeLogger: { log: (event) => console.info(JSON.stringify(event)) },
    probe: probe?.observer,
  });
  await probe?.start();
  await runtime.run({ signal: controller.signal });
} catch {
  console.error("QKERN migration runtime failed its secure startup or runtime boundary.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", requestStop);
  process.removeListener("SIGTERM", requestStop);
  await Promise.allSettled([probe?.stop(), catalog?.close(), closePostgresPool()]);
}
