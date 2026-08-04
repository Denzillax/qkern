import { ConfigurationError } from "@/lib/server/db/errors";
import type { PostgresPoolConfig } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import {
  VaultProjectDatabaseConnectionCatalog,
  type VaultProjectDatabaseBinding,
  type VaultProjectDatabaseCatalogOptions,
  type VaultTokenProvider,
} from "@/lib/server/migrations/connection-catalog-vault";

const MAX_CATALOG_BYTES = 32_000;

export type VaultCatalogDependencies = {
  tokenProvider: VaultTokenProvider;
  fetchFn?: typeof fetch;
  poolFactory?: (config: PostgresPoolConfig) => SqlPool;
  now?: () => number;
};

export type VaultCatalogRuntimeOptions = Omit<VaultProjectDatabaseCatalogOptions, "bindings">;

/** Parses the shared Vault transport boundary without accepting catalog bindings from the environment. */
export function vaultCatalogRuntimeOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: VaultCatalogDependencies,
): VaultCatalogRuntimeOptions {
  try {
    if (!dependencies?.tokenProvider) throw new Error("Missing token provider");
    if (env.QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG === "true" ||
        env.QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON !== undefined ||
        env.QKERN_VAULT_TOKEN !== undefined || env.VAULT_TOKEN !== undefined) {
      throw new Error("Mixed catalog authority");
    }
    return {
      vaultDatabaseUrl: new URL(env.QKERN_VAULT_DATABASE_URL?.trim() ?? ""),
      tokenProvider: dependencies.tokenProvider,
      namespace: env.QKERN_VAULT_NAMESPACE,
      timeoutMs: integerFromEnv(env, "QKERN_VAULT_TIMEOUT_MS", 5_000, 100, 60_000),
      refreshSkewMs: integerFromEnv(env, "QKERN_VAULT_REFRESH_SKEW_MS", 30_000, 100, 3_600_000),
      production: env.NODE_ENV === "production",
      fetchFn: dependencies.fetchFn,
      poolFactory: dependencies.poolFactory,
      now: dependencies.now,
    };
  } catch {
    throw new ConfigurationError("The Vault project database catalog configuration is invalid.");
  }
}

/** Parses only secret-free deployment bindings. Vault tokens must be injected through the provider. */
export function createVaultProjectDatabaseCatalogFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: VaultCatalogDependencies,
): VaultProjectDatabaseConnectionCatalog {
  try {
    const runtime = vaultCatalogRuntimeOptionsFromEnv(env, dependencies);
    const encoded = env.QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON?.trim();
    if (!encoded || Buffer.byteLength(encoded, "utf8") > MAX_CATALOG_BYTES) throw new Error("Invalid catalog");
    const bindings: unknown = JSON.parse(encoded);
    if (!Array.isArray(bindings)) throw new Error("Invalid catalog");
    return new VaultProjectDatabaseConnectionCatalog({
      ...runtime,
      bindings: bindings as VaultProjectDatabaseBinding[],
    });
  } catch {
    throw new ConfigurationError("The Vault project database catalog configuration is invalid.");
  }
}

function integerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid integer");
  return value;
}
