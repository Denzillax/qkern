import { ConfigurationError } from "@/lib/server/db/errors";
import { getWorkerPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import {
  createLocalProjectDatabaseCatalogFromEnv,
  type LocalCatalogEnvironmentOptions,
} from "@/lib/server/migrations/connection-catalog-env";
import { VaultTokenFileProvider } from "@/lib/server/migrations/connection-catalog-vault";
import {
  createVaultProjectDatabaseCatalogFromEnv,
  vaultCatalogRuntimeOptionsFromEnv,
} from "@/lib/server/migrations/connection-catalog-vault-env";
import { PersistedVaultProjectDatabaseConnectionCatalog } from
  "@/lib/server/migrations/connection-catalog-vault-persisted";
import type { ProjectDatabaseConnectionResolver } from "@/lib/server/migrations/postgres-executor";

/**
 * Der eine Weg von der Umgebung zu einem Projektdatenbank-Katalog.
 *
 * Bis `2.68.0` stand dieser Weg nur im Migrations-Prozess, als Folge von
 * `if`-Zweigen in `workers/migration-runtime.mts`. Der Realtime-Prozess hatte
 * ihn nicht und baute seinen Katalog ausschliesslich lokal auf; unter
 * `NODE_ENV=production` wies der lokale Weg ab, und Postgres Changes waren dort
 * damit unerreichbar.
 *
 * Der Zweig liegt jetzt hier, und beide Prozesse rufen dieselbe Fabrik. Das ist
 * der Punkt: Ein Katalog, der an zwei Stellen gebaut wird, sieht an zwei
 * Stellen unterschiedlich aus, und die Rollengrenze der Projektdatenbank haengt
 * an genau diesen Angaben.
 */

export type ProjectDatabaseCatalogRuntime = ProjectDatabaseConnectionResolver & {
  close(): Promise<void>;
};

/** Ein Katalog, dessen Bindungen beim Start feststehen und darum aufzaehlbar sind. */
export type ListableProjectDatabaseCatalog = ProjectDatabaseCatalogRuntime & {
  references(): readonly string[];
};

export type ProjectDatabaseCatalogOptions = {
  /**
   * Nur der Migrations-Prozess darf seine Bindungen aus der Control Plane
   * lesen. Die Tabelle gehoert der Worker-Rolle, und ein anderer Prozess
   * bekaeme sie nur durch ein zusaetzliches Leserecht. Wer sie nicht hat, nennt
   * beim Start die Quelle, die er braucht, statt still ohne Katalog zu laufen.
   */
  allowControlPlaneBindings?: boolean;
  /** Namen der Variablen des lokalen Weges; je Prozess eigene. */
  local?: LocalCatalogEnvironmentOptions;
  /**
   * Wie der Prozess sich nennt, in `pg_stat_activity` und gegenueber dem
   * Vault. Ohne diesen Wert traegt jeder Aufrufer den Namen des
   * Migrations-Prozesses, und wer im Betrieb nach einer haengenden Verbindung
   * sucht, sucht am falschen Prozess.
   */
  clientName?: string;
};

export async function createProjectDatabaseCatalogFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: ProjectDatabaseCatalogOptions = {},
): Promise<ProjectDatabaseCatalogRuntime> {
  if (env.NODE_ENV !== "production") {
    return await createLocalProjectDatabaseCatalogFromEnv(env, undefined, options.local ?? {});
  }
  const tokenProvider = new VaultTokenFileProvider(
    env.QKERN_VAULT_TOKEN_FILE?.trim() ?? "",
    { production: true },
  );
  if (env.QKERN_PROJECT_DATABASE_CATALOG_SOURCE === "static-env") {
    return createVaultProjectDatabaseCatalogFromEnv(env, { tokenProvider, clientName: options.clientName });
  }
  if (!options.allowControlPlaneBindings) {
    throw new ConfigurationError(
      "Production requires QKERN_PROJECT_DATABASE_CATALOG_SOURCE=static-env with a vault-backed "
      + "project database catalog in this process.",
    );
  }
  if (env.QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON !== undefined) {
    throw new ConfigurationError(
      "Static project database bindings cannot be mixed with the control-plane catalog.",
    );
  }
  const organizationId = env.QKERN_WORKER_ORGANIZATION_ID?.trim() ?? "";
  return new PersistedVaultProjectDatabaseConnectionCatalog(
    new PostgresControlPlane(getWorkerPostgresPool(env)),
    organizationId,
    vaultCatalogRuntimeOptionsFromEnv(env, { tokenProvider }),
  );
}

/** Ein Katalog aus der Control Plane kennt seine Bindungen erst zur Laufzeit. */
export function asListableProjectDatabaseCatalog(
  catalog: ProjectDatabaseCatalogRuntime,
): ListableProjectDatabaseCatalog {
  if (typeof (catalog as ListableProjectDatabaseCatalog).references !== "function") {
    throw new ConfigurationError("This project database catalog cannot be listed at startup.");
  }
  return catalog as ListableProjectDatabaseCatalog;
}

/**
 * Greift beim Start einmal bis zur Datenbank durch, je Bindung.
 *
 * Ein vault-gestuetzter Katalog holt seine Zugangsdaten erst beim ersten
 * Zugriff. Ohne diesen Griff wuerde ein Prozess mit unerreichbarem Vault oder
 * leerem Katalog anlaufen und lauschen, und erst der Abonnent merkte es: Der
 * Leser faellt geschlossen, also kaeme kein Fehler zurueck, sondern nichts.
 * Genau dieser stille Rutsch soll nicht stattfinden, deshalb passiert der Griff
 * vor dem Lauschen und ein Fehlschlag laesst den Start fallen.
 */
export async function probeProjectDatabaseCatalog(
  catalog: ListableProjectDatabaseCatalog,
): Promise<readonly string[]> {
  const references = catalog.references();
  if (references.length === 0) {
    throw new ConfigurationError("The project database catalog contains no binding.");
  }
  for (const reference of references) {
    const resolved = await catalog.resolve(reference);
    const client = await resolved.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }
  return references;
}
