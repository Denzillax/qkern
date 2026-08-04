import { ConfigurationError } from "@/lib/server/db/errors";
import { createPostgresPool, type PostgresPoolConfig } from "@/lib/server/db/pool";
import type { SqlPool } from "@/lib/server/db/sql";
import {
  isCatalogReference,
  TrustedProjectDatabaseConnectionCatalog,
  type ProjectDatabaseCatalogEntry,
} from "@/lib/server/migrations/connection-catalog";

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const MAX_CATALOG_BYTES = 20_000;
const MAX_ENTRIES = 32;

type LocalCatalogEntry = {
  databaseInstanceRef: string;
  connectionString: string;
  expectedRole: string;
  expectedDatabase: string;
  expectedLedgerOwner: string;
};

export type LocalCatalogPoolFactory = (config: PostgresPoolConfig) => SqlPool;

export type LocalCatalogEnvironmentOptions = {
  allowFlag?: string;
  catalogVariable?: string;
  applicationName?: string;
};

/**
 * Explicit local/E2E adapter. Production rejects raw connection URLs even when
 * the opt-in flag is set; production must inject a vault-backed catalog.
 */
export async function createLocalProjectDatabaseCatalogFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  poolFactory: LocalCatalogPoolFactory = createPostgresPool,
  options: LocalCatalogEnvironmentOptions = {},
): Promise<TrustedProjectDatabaseConnectionCatalog> {
  const allowFlag = options.allowFlag ?? "QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG";
  const catalogVariable = options.catalogVariable ?? "QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON";
  if (env.NODE_ENV === "production") {
    throw new ConfigurationError("Production requires an injected vault-backed project database catalog.");
  }
  if (env[allowFlag] !== "true") {
    throw new ConfigurationError("The local project database catalog is disabled.");
  }
  const encoded = env[catalogVariable]?.trim();
  if (!encoded || Buffer.byteLength(encoded, "utf8") > MAX_CATALOG_BYTES) throw invalidCatalog();

  let raw: unknown;
  try {
    raw = JSON.parse(encoded);
  } catch {
    throw invalidCatalog();
  }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ENTRIES || !raw.every(isLocalEntry)) {
    throw invalidCatalog();
  }

  const pools: SqlPool[] = [];
  try {
    const entries: ProjectDatabaseCatalogEntry[] = raw.map((item) => {
      const pool = poolFactory({
        connectionString: item.connectionString,
        applicationName: options.applicationName ?? "qkern-local-project-migrator",
        max: 2,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
        statementTimeoutMillis: 15_000,
        ssl: env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : false,
      });
      pools.push(pool);
      return {
        databaseInstanceRef: item.databaseInstanceRef,
        pool,
        expectedRole: item.expectedRole,
        expectedDatabase: item.expectedDatabase,
        expectedLedgerOwner: item.expectedLedgerOwner,
      };
    });
    return new TrustedProjectDatabaseConnectionCatalog(entries);
  } catch {
    await Promise.allSettled(pools.map((pool) => pool.end()));
    throw invalidCatalog();
  }
}

function isLocalEntry(value: unknown): value is LocalCatalogEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== [
    "connectionString",
    "databaseInstanceRef",
    "expectedDatabase",
    "expectedLedgerOwner",
    "expectedRole",
  ].sort().join(",")) return false;
  if (!isCatalogReference(record.databaseInstanceRef) ||
      !isIdentifier(record.expectedRole) || !isIdentifier(record.expectedDatabase) ||
      !isIdentifier(record.expectedLedgerOwner) || record.expectedRole === record.expectedLedgerOwner ||
      typeof record.connectionString !== "string" || record.connectionString.length > 2_000) return false;
  try {
    const parsed = new URL(record.connectionString);
    return (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      Boolean(parsed.hostname) && Boolean(parsed.username) && Boolean(parsed.pathname.slice(1));
  } catch {
    return false;
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value) && !value.startsWith("pg_");
}

function invalidCatalog(): ConfigurationError {
  return new ConfigurationError("The local project database catalog configuration is invalid.");
}
