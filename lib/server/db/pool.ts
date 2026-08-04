import { createRequire } from "node:module";
import type { PeerCertificate } from "node:tls";
import { ConfigurationError, DependencyUnavailableError } from "@/lib/server/db/errors";
import type { SqlPool } from "@/lib/server/db/sql";

export type PostgresPoolConfig = {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  applicationName?: string;
  ssl?: boolean | {
    rejectUnauthorized: boolean;
    servername?: string;
    checkServerIdentity?: (hostname: string, certificate: PeerCertificate) => Error | undefined;
  };
};

type PgPoolConstructor = new (config: Record<string, unknown>) => SqlPool;
type PgModule = { Pool: PgPoolConstructor };

function loadPg(): PgModule {
  try {
    const require = createRequire(import.meta.url);
    return require("pg") as PgModule;
  } catch (error) {
    throw new DependencyUnavailableError(
      "The PostgreSQL driver is unavailable. Install the `pg` package before enabling the database adapter.",
      error,
    );
  }
}

export function postgresPoolConfigFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): PostgresPoolConfig {
  const runtimeConnectionString = env.QKERN_RUNTIME_DATABASE_URL?.trim();
  if (!runtimeConnectionString) throw new ConfigurationError("QKERN_RUNTIME_DATABASE_URL is required so application traffic never uses the migration owner.");
  if (env.NODE_ENV === "production" && env.DATABASE_SSL !== "require") {
    throw new ConfigurationError("DATABASE_SSL=require is mandatory for production database connections.");
  }

  const numberFromEnv = (name: string, fallback: number): number => {
    const raw = env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new ConfigurationError(`${name} must be a positive integer.`);
    }
    return value;
  };

  return {
    connectionString: runtimeConnectionString,
    max: numberFromEnv("DATABASE_POOL_MAX", 10),
    idleTimeoutMillis: numberFromEnv("DATABASE_IDLE_TIMEOUT_MS", 30_000),
    connectionTimeoutMillis: numberFromEnv("DATABASE_CONNECT_TIMEOUT_MS", 5_000),
    statementTimeoutMillis: numberFromEnv("DATABASE_STATEMENT_TIMEOUT_MS", 15_000),
    applicationName: env.DATABASE_APPLICATION_NAME?.trim() || "qkern-control-plane",
    ssl: env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : false,
  };
}

export function authPostgresPoolConfigFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): PostgresPoolConfig {
  const connectionString = env.QKERN_AUTH_DATABASE_URL?.trim();
  if (!connectionString) throw new ConfigurationError("QKERN_AUTH_DATABASE_URL is required for persistent authentication.");
  if (env.NODE_ENV === "production" && env.DATABASE_SSL !== "require") {
    throw new ConfigurationError("DATABASE_SSL=require is mandatory for production database connections.");
  }
  return { ...postgresPoolConfigFromEnv({ ...env, QKERN_RUNTIME_DATABASE_URL: connectionString }), applicationName: "qkern-auth" };
}

export function workerPostgresPoolConfigFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): PostgresPoolConfig {
  const connectionString = env.QKERN_WORKER_DATABASE_URL?.trim();
  if (!connectionString) throw new ConfigurationError("QKERN_WORKER_DATABASE_URL is required for the migration worker boundary.");
  if (env.NODE_ENV === "production" && env.DATABASE_SSL !== "require") {
    throw new ConfigurationError("DATABASE_SSL=require is mandatory for production database connections.");
  }
  return {
    ...postgresPoolConfigFromEnv({ ...env, QKERN_RUNTIME_DATABASE_URL: connectionString }),
    applicationName: "qkern-migration-worker",
  };
}

export function provisionerPostgresPoolConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PostgresPoolConfig {
  const connectionString = env.QKERN_PROVISIONER_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new ConfigurationError("QKERN_PROVISIONER_DATABASE_URL is required for the project provisioner boundary.");
  }
  if (env.NODE_ENV === "production" && env.DATABASE_SSL !== "require") {
    throw new ConfigurationError("DATABASE_SSL=require is mandatory for production database connections.");
  }
  return {
    ...postgresPoolConfigFromEnv({ ...env, QKERN_RUNTIME_DATABASE_URL: connectionString }),
    applicationName: "qkern-project-provisioner",
  };
}

export function createPostgresPool(config: PostgresPoolConfig): SqlPool {
  if (!config.connectionString?.trim()) throw new ConfigurationError("A PostgreSQL connection string is required.");
  const { Pool } = loadPg();
  return new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5_000,
    statement_timeout: config.statementTimeoutMillis ?? 15_000,
    application_name: config.applicationName ?? "qkern-control-plane",
    ssl: config.ssl ?? false,
  });
}

export type DatabaseBoundary = "runtime" | "auth" | "worker" | "provisioner";

class BoundaryVerifiedPool implements SqlPool {
  private verification?: Promise<void>;

  constructor(private readonly pool: SqlPool, private readonly boundary: DatabaseBoundary) {}

  private verify(): Promise<void> {
    this.verification ??= this.pool.query<{
      rolname: string;
      session_user: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      privileged_member: boolean;
      unexpected_member: boolean;
      runtime_member: boolean;
      auth_member: boolean;
      worker_member: boolean;
      provisioner_member: boolean;
    }>(`SELECT role.rolname, session_user::text AS session_user, role.rolcanlogin,
              role.rolsuper, role.rolbypassrls, role.rolcreatedb, role.rolcreaterole, role.rolreplication,
              EXISTS (
                SELECT 1 FROM pg_roles AS privileged
                WHERE (privileged.rolsuper OR privileged.rolbypassrls OR privileged.rolcreatedb OR
                       privileged.rolcreaterole OR privileged.rolreplication OR
                       privileged.rolname IN (
                         'pg_execute_server_program','pg_read_server_files','pg_write_server_files',
                         'pg_read_all_data','pg_write_all_data','pg_maintain','pg_signal_backend',
                         'pg_checkpoint','pg_create_subscription','pg_database_owner',
                         'pg_use_reserved_connections','pg_signal_autovacuum_worker','pg_monitor',
                         'pg_read_all_settings','pg_read_all_stats','pg_stat_scan_tables'
                       ))
                  AND privileged.rolname <> current_user
                  AND pg_has_role(current_user, privileged.oid, 'MEMBER')
              ) AS privileged_member,
              EXISTS (
                SELECT 1 FROM pg_roles AS inherited
                WHERE inherited.oid <> role.oid AND inherited.rolname <> $1
                  AND pg_has_role(current_user, inherited.oid, 'MEMBER')
              ) AS unexpected_member,
              pg_has_role(current_user, 'qkern_runtime', 'MEMBER') AS runtime_member,
              pg_has_role(current_user, 'qkern_auth', 'MEMBER') AS auth_member,
              pg_has_role(current_user, 'qkern_worker', 'MEMBER') AS worker_member,
              pg_has_role(current_user, 'qkern_provisioner', 'MEMBER') AS provisioner_member
       FROM pg_roles AS role
       WHERE role.rolname = current_user`, [`qkern_${this.boundary}`]).then((result) => {
      const role = result.rows[0];
      const expectedRuntime = this.boundary === "runtime";
      const expectedAuth = this.boundary === "auth";
      const expectedWorker = this.boundary === "worker";
      const expectedProvisioner = this.boundary === "provisioner";
      if (!role || !role.rolcanlogin || role.session_user !== role.rolname || role.rolsuper || role.rolbypassrls ||
          role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.privileged_member || role.unexpected_member ||
          role.runtime_member !== expectedRuntime || role.auth_member !== expectedAuth ||
          role.worker_member !== expectedWorker || role.provisioner_member !== expectedProvisioner) {
        throw new ConfigurationError(`The ${this.boundary} database login violates the required least-privilege role boundary.`);
      }
    });
    return this.verification;
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly import("@/lib/server/db/sql").SqlValue[]) {
    await this.verify();
    return this.pool.query<Row>(text, values);
  }

  async connect() {
    await this.verify();
    return this.pool.connect();
  }

  end() { return this.pool.end(); }
}

export function verifyDatabaseBoundary(pool: SqlPool, boundary: DatabaseBoundary): SqlPool {
  return new BoundaryVerifiedPool(pool, boundary);
}

let sharedPool: SqlPool | undefined;
let sharedAuthPool: SqlPool | undefined;
let sharedWorkerPool: SqlPool | undefined;
let sharedProvisionerPool: SqlPool | undefined;

export function getPostgresPool(env: Readonly<Record<string, string | undefined>> = process.env): SqlPool {
  sharedPool ??= verifyDatabaseBoundary(createPostgresPool(postgresPoolConfigFromEnv(env)), "runtime");
  return sharedPool;
}

export function getAuthPostgresPool(env: Readonly<Record<string, string | undefined>> = process.env): SqlPool {
  sharedAuthPool ??= verifyDatabaseBoundary(createPostgresPool(authPostgresPoolConfigFromEnv(env)), "auth");
  return sharedAuthPool;
}

export function getWorkerPostgresPool(env: Readonly<Record<string, string | undefined>> = process.env): SqlPool {
  sharedWorkerPool ??= verifyDatabaseBoundary(createPostgresPool(workerPostgresPoolConfigFromEnv(env)), "worker");
  return sharedWorkerPool;
}

export function getProvisionerPostgresPool(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SqlPool {
  sharedProvisionerPool ??= verifyDatabaseBoundary(
    createPostgresPool(provisionerPostgresPoolConfigFromEnv(env)),
    "provisioner",
  );
  return sharedProvisionerPool;
}

export async function closePostgresPool(): Promise<void> {
  const pool = sharedPool;
  const authPool = sharedAuthPool;
  const workerPool = sharedWorkerPool;
  const provisionerPool = sharedProvisionerPool;
  sharedPool = undefined;
  sharedAuthPool = undefined;
  sharedWorkerPool = undefined;
  sharedProvisionerPool = undefined;
  if (pool) await pool.end();
  if (authPool && authPool !== pool) await authPool.end();
  if (workerPool && workerPool !== pool && workerPool !== authPool) await workerPool.end();
  if (provisionerPool && provisionerPool !== pool && provisionerPool !== authPool && provisionerPool !== workerPool) {
    await provisionerPool.end();
  }
}
