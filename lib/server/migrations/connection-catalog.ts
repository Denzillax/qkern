import type { SqlPool } from "@/lib/server/db/sql";
import type {
  ProjectDatabaseConnectionResolver,
  ResolvedProjectDatabaseConnection,
} from "@/lib/server/migrations/postgres-executor";

const OPAQUE_REFERENCE = /^managed:[a-z0-9](?:[a-z0-9_-]{0,118}[a-z0-9])?$/;
const POSTGRES_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export type ProjectDatabaseCatalogEntry = Readonly<{
  /** Provisioner-issued identifier. URLs, credentials and request-derived values are forbidden. */
  databaseInstanceRef: string;
  /** This catalog owns the pool and closes it when the catalog is closed. */
  pool: SqlPool;
  expectedRole: string;
  expectedDatabase: string;
  expectedLedgerOwner: string;
}>;

export type ProjectDatabaseCatalogErrorCode =
  | "INVALID_CATALOG_ENTRY"
  | "DUPLICATE_CATALOG_BINDING"
  | "PROJECT_DATABASE_REFERENCE_NOT_ALLOWED"
  | "PROJECT_DATABASE_CATALOG_CLOSED"
  | "PROJECT_DATABASE_CATALOG_CLOSE_FAILED";

/** Sanitized by construction: messages and properties never contain catalog input. */
export class ProjectDatabaseCatalogError extends Error {
  readonly code: ProjectDatabaseCatalogErrorCode;

  constructor(code: ProjectDatabaseCatalogErrorCode) {
    super(messageFor(code));
    this.name = "ProjectDatabaseCatalogError";
    this.code = code;
  }
}

/**
 * Server-owned, exact-match allowlist for project database connections.
 *
 * It deliberately has no environment or request parser. Production deployments
 * must inject provisioner-created pools; raw connection URLs are not accepted by
 * this boundary. An empty catalog is valid and is the fail-closed default.
 */
export class TrustedProjectDatabaseConnectionCatalog implements ProjectDatabaseConnectionResolver {
  private readonly entries: ReadonlyMap<string, ResolvedProjectDatabaseConnection>;
  private readonly pools: readonly SqlPool[];
  private closePromise?: Promise<void>;
  private state: "open" | "closing" | "closed" = "open";

  constructor(entries: readonly ProjectDatabaseCatalogEntry[] = []) {
    const byReference = new Map<string, ResolvedProjectDatabaseConnection>();
    const ownedPools = new Set<SqlPool>();

    for (const entry of entries) {
      assertEntry(entry);
      if (byReference.has(entry.databaseInstanceRef) || ownedPools.has(entry.pool)) {
        throw new ProjectDatabaseCatalogError("DUPLICATE_CATALOG_BINDING");
      }

      ownedPools.add(entry.pool);
      byReference.set(entry.databaseInstanceRef, Object.freeze({
        pool: entry.pool,
        expectedRole: entry.expectedRole,
        expectedDatabase: entry.expectedDatabase,
        expectedLedgerOwner: entry.expectedLedgerOwner,
      }));
    }

    this.entries = byReference;
    this.pools = Object.freeze([...ownedPools]);
  }

  resolve(databaseInstanceRef: string): ResolvedProjectDatabaseConnection {
    if (this.state !== "open") {
      throw new ProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
    }
    if (!isCatalogReference(databaseInstanceRef)) {
      throw new ProjectDatabaseCatalogError("PROJECT_DATABASE_REFERENCE_NOT_ALLOWED");
    }
    const entry = this.entries.get(databaseInstanceRef);
    if (!entry) {
      throw new ProjectDatabaseCatalogError("PROJECT_DATABASE_REFERENCE_NOT_ALLOWED");
    }
    return entry;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.state = "closing";
    this.closePromise = this.closePools();
    return this.closePromise;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async closePools(): Promise<void> {
    const results = await Promise.allSettled(this.pools.map(async (pool) => pool.end()));
    this.state = "closed";
    if (results.some((result) => result.status === "rejected")) {
      // Do not retain the driver error as a cause: it can contain a connection URL.
      throw new ProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSE_FAILED");
    }
  }
}

export function isCatalogReference(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && OPAQUE_REFERENCE.test(value);
}

function assertEntry(entry: ProjectDatabaseCatalogEntry): void {
  if (!entry || typeof entry !== "object" ||
      !isCatalogReference(entry.databaseInstanceRef) ||
      !isPool(entry.pool) ||
      !isSafeIdentifier(entry.expectedRole) ||
      !isSafeIdentifier(entry.expectedDatabase) ||
      !isSafeIdentifier(entry.expectedLedgerOwner) ||
      entry.expectedRole === entry.expectedLedgerOwner ||
      entry.expectedRole.startsWith("pg_") ||
      entry.expectedLedgerOwner.startsWith("pg_")) {
    throw new ProjectDatabaseCatalogError("INVALID_CATALOG_ENTRY");
  }
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && POSTGRES_IDENTIFIER.test(value);
}

function isPool(value: unknown): value is SqlPool {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SqlPool>;
  return typeof candidate.query === "function" &&
    typeof candidate.connect === "function" &&
    typeof candidate.end === "function";
}

function messageFor(code: ProjectDatabaseCatalogErrorCode): string {
  switch (code) {
    case "INVALID_CATALOG_ENTRY":
      return "The project database catalog configuration is invalid.";
    case "DUPLICATE_CATALOG_BINDING":
      return "The project database catalog contains a duplicate binding.";
    case "PROJECT_DATABASE_REFERENCE_NOT_ALLOWED":
      return "The project database reference is not allowlisted.";
    case "PROJECT_DATABASE_CATALOG_CLOSED":
      return "The project database catalog is not available.";
    case "PROJECT_DATABASE_CATALOG_CLOSE_FAILED":
      return "The project database catalog could not be closed cleanly.";
  }
}
