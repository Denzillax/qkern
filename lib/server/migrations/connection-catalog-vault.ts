import { timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import { isIP } from "node:net";
import { checkServerIdentity, type PeerCertificate } from "node:tls";
import { ConfigurationError } from "@/lib/server/db/errors";
import { createPostgresPool, type PostgresPoolConfig } from "@/lib/server/db/pool";
import type { SqlPool, SqlPoolClient, SqlQueryResult, SqlValue } from "@/lib/server/db/sql";
import { isCatalogReference } from "@/lib/server/migrations/connection-catalog";
import type {
  ProjectDatabaseConnectionResolver,
  ResolvedProjectDatabaseConnection,
} from "@/lib/server/migrations/postgres-executor";

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const VAULT_ROLE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const VAULT_PATH = /^\/v1\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,63})*$/;
const VAULT_NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,63})*$/;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const FINGERPRINT = /^[a-f0-9]{64}$/i;
const MAX_RESPONSE_BYTES = 32_768;
const MAX_TOKEN_BYTES = 4_096;

export type VaultProjectDatabaseCatalogErrorCode =
  | "INVALID_CONFIGURATION"
  | "DUPLICATE_CATALOG_BINDING"
  | "PROJECT_DATABASE_REFERENCE_NOT_ALLOWED"
  | "PROJECT_DATABASE_CATALOG_CLOSED"
  | "VAULT_TOKEN_UNAVAILABLE"
  | "VAULT_TIMEOUT"
  | "VAULT_REQUEST_FAILED"
  | "VAULT_RESPONSE_REJECTED"
  | "VAULT_RESPONSE_TOO_LARGE"
  | "VAULT_CREDENTIAL_REJECTED"
  | "PROJECT_DATABASE_POOL_UNAVAILABLE"
  | "PROJECT_DATABASE_CATALOG_CLOSE_FAILED";

/** Stable and deliberately cause-free: tokens, passwords, endpoints and driver details never escape. */
export class VaultProjectDatabaseCatalogError extends Error {
  readonly code: VaultProjectDatabaseCatalogErrorCode;

  constructor(code: VaultProjectDatabaseCatalogErrorCode) {
    super(messageFor(code));
    this.name = "VaultProjectDatabaseCatalogError";
    this.code = code;
  }
}

export interface VaultTokenProvider {
  getToken(options: { signal: AbortSignal }): string | Promise<string>;
}

/** Reads a Vault Agent token sink on every credential refresh so token rotation is automatic. */
export class VaultTokenFileProvider implements VaultTokenProvider {
  private readonly path: string;
  private readonly production: boolean;

  constructor(path: string, options: { production?: boolean } = {}) {
    if (!path.startsWith("/") || path.length > 1_024 || path.includes("\0")) {
      throw new ConfigurationError("QKERN_VAULT_TOKEN_FILE must be a bounded absolute path.");
    }
    this.path = path;
    this.production = options.production ?? false;
  }

  async getToken(options: { signal: AbortSignal }): Promise<string> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      if (options.signal.aborted) throw new Error("Aborted");
      handle = await open(this.path, "r");
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_TOKEN_BYTES ||
          (this.production && (metadata.mode & 0o007) !== 0)) {
        throw new Error("Invalid token file");
      }
      const buffer = Buffer.alloc(metadata.size);
      const result = await handle.read(buffer, 0, metadata.size, 0);
      if (result.bytesRead !== metadata.size || options.signal.aborted) throw new Error("Incomplete token file");
      const token = buffer.toString("utf8").trim();
      buffer.fill(0);
      if (!isValidToken(token)) throw new Error("Invalid token");
      return token;
    } catch {
      throw new VaultProjectDatabaseCatalogError("VAULT_TOKEN_UNAVAILABLE");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export type VaultProjectDatabaseBinding = Readonly<{
  databaseInstanceRef: string;
  vaultStaticRole: string;
  host: string;
  port: number;
  expectedRole: string;
  expectedDatabase: string;
  expectedLedgerOwner: string;
  /** Exact leaf-certificate SHA-256 pin, hex-encoded without separators. */
  serverCertificateSha256?: string;
}>;

export type VaultProjectDatabaseCatalogOptions = Readonly<{
  /** Exact mount URL, for example https://vault.example.net/v1/database. */
  vaultDatabaseUrl: URL;
  bindings: readonly VaultProjectDatabaseBinding[];
  tokenProvider: VaultTokenProvider;
  namespace?: string;
  timeoutMs?: number;
  refreshSkewMs?: number;
  production?: boolean;
  fetchFn?: typeof fetch;
  poolFactory?: (config: PostgresPoolConfig) => SqlPool;
  now?: () => number;
}>;

type VaultCredential = Readonly<{ username: string; password: string; ttlSeconds: number }>;
type PoolGeneration = {
  pool: SqlPool;
  password: string;
  refreshAt: number;
  active: number;
  retired: boolean;
  endPromise?: Promise<void>;
};

/**
 * Exact-match production catalog backed by Vault database static roles.
 * A stable role is required because the executor verifies current_user exactly.
 */
export class VaultProjectDatabaseConnectionCatalog implements ProjectDatabaseConnectionResolver {
  private readonly entries: ReadonlyMap<string, ResolvedProjectDatabaseConnection>;
  private readonly pools: readonly RotatingVaultSqlPool[];
  private state: "open" | "closing" | "closed" = "open";
  private closePromise?: Promise<void>;

  constructor(options: VaultProjectDatabaseCatalogOptions) {
    const validated = validateOptions(options);
    const entries = new Map<string, ResolvedProjectDatabaseConnection>();
    const pools: RotatingVaultSqlPool[] = [];
    const roles = new Set<string>();

    for (const binding of validated.bindings) {
      if (entries.has(binding.databaseInstanceRef) || roles.has(binding.vaultStaticRole)) {
        throw new VaultProjectDatabaseCatalogError("DUPLICATE_CATALOG_BINDING");
      }
      roles.add(binding.vaultStaticRole);
      const pool = new RotatingVaultSqlPool(binding, validated);
      pools.push(pool);
      entries.set(binding.databaseInstanceRef, Object.freeze({
        pool,
        expectedRole: binding.expectedRole,
        expectedDatabase: binding.expectedDatabase,
        expectedLedgerOwner: binding.expectedLedgerOwner,
      }));
    }
    this.entries = entries;
    this.pools = Object.freeze(pools);
  }

  resolve(databaseInstanceRef: string): ResolvedProjectDatabaseConnection {
    if (this.state !== "open") {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
    }
    if (!isCatalogReference(databaseInstanceRef)) {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_REFERENCE_NOT_ALLOWED");
    }
    const entry = this.entries.get(databaseInstanceRef);
    if (!entry) throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_REFERENCE_NOT_ALLOWED");
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
    const results = await Promise.allSettled(this.pools.map((pool) => pool.end()));
    this.state = "closed";
    if (results.some((result) => result.status === "rejected")) {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSE_FAILED");
    }
  }
}

type ValidatedOptions = {
  vaultDatabaseUrl: URL;
  bindings: readonly VaultProjectDatabaseBinding[];
  tokenProvider: VaultTokenProvider;
  namespace?: string;
  timeoutMs: number;
  refreshSkewMs: number;
  production: boolean;
  fetchFn: typeof fetch;
  poolFactory: (config: PostgresPoolConfig) => SqlPool;
  now: () => number;
};

class RotatingVaultSqlPool implements SqlPool {
  private readonly generations = new Set<PoolGeneration>();
  private readonly abortController = new AbortController();
  private current?: PoolGeneration;
  private refreshPromise?: Promise<PoolGeneration>;
  private closePromise?: Promise<void>;
  private state: "open" | "closing" | "closed" = "open";
  private retirementFailed = false;

  constructor(
    private readonly binding: VaultProjectDatabaseBinding,
    private readonly options: ValidatedOptions,
  ) {}

  /** Prevent structured loggers from serializing bindings, endpoints or credentials. */
  toJSON(): Readonly<{ type: "project-database-pool" }> {
    return Object.freeze({ type: "project-database-pool" });
  }

  async connect(): Promise<SqlPoolClient> {
    const generation = await this.acquireGeneration();
    try {
      const client = await generation.pool.connect();
      let released = false;
      return {
        query: (text, values) => client.query(text, values),
        release: (error) => {
          if (released) return;
          released = true;
          try {
            client.release(error);
          } finally {
            this.releaseGeneration(generation);
          }
        },
      } as SqlPoolClient;
    } catch {
      this.releaseGeneration(generation);
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_POOL_UNAVAILABLE");
    }
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>> {
    const generation = await this.acquireGeneration();
    try {
      return await generation.pool.query<Row>(text, values);
    } catch {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_POOL_UNAVAILABLE");
    } finally {
      this.releaseGeneration(generation);
    }
  }

  end(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.state = "closing";
    this.abortController.abort();
    this.closePromise = this.closeAll();
    return this.closePromise;
  }

  private async acquireGeneration(): Promise<PoolGeneration> {
    if (this.retirementFailed) {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_POOL_UNAVAILABLE");
    }
    const generation = await this.ensureCurrent();
    if (this.state !== "open") throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
    if (this.retirementFailed) {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_POOL_UNAVAILABLE");
    }
    generation.active += 1;
    return generation;
  }

  private async ensureCurrent(): Promise<PoolGeneration> {
    if (this.state !== "open") throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
    const now = this.options.now();
    if (this.current && now < this.current.refreshAt) return this.current;
    if (this.refreshPromise) return this.refreshPromise;
    const pending = this.refresh();
    this.refreshPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.refreshPromise === pending) this.refreshPromise = undefined;
    }
  }

  private async refresh(): Promise<PoolGeneration> {
    const credential = await fetchVaultCredential(this.binding, this.options, this.abortController.signal);
    if (this.state !== "open") throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
    const refreshAt = refreshDeadline(this.options.now(), credential.ttlSeconds, this.options.refreshSkewMs);
    if (this.current && credential.password === this.current.password) {
      this.current.refreshAt = refreshAt;
      return this.current;
    }

    let pool: SqlPool;
    try {
      pool = this.options.poolFactory(poolConfig(this.binding, credential, this.options.production));
      if (!isPool(pool)) throw new Error("Invalid pool");
    } catch {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_POOL_UNAVAILABLE");
    }
    const generation: PoolGeneration = {
      pool,
      password: credential.password,
      refreshAt,
      active: 0,
      retired: false,
    };
    this.generations.add(generation);
    if (this.state !== "open") {
      generation.retired = true;
      await this.endGeneration(generation).catch(() => undefined);
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
    }

    const previous = this.current;
    this.current = generation;
    if (previous) {
      previous.retired = true;
      this.maybeEndRetired(previous);
    }
    return generation;
  }

  private releaseGeneration(generation: PoolGeneration): void {
    generation.active = Math.max(0, generation.active - 1);
    this.maybeEndRetired(generation);
  }

  private maybeEndRetired(generation: PoolGeneration): void {
    if (!generation.retired || generation.active !== 0 || generation.endPromise) return;
    void this.endGeneration(generation).catch(() => {
      this.retirementFailed = true;
    });
  }

  private endGeneration(generation: PoolGeneration): Promise<void> {
    generation.endPromise ??= Promise.resolve().then(() => generation.pool.end());
    return generation.endPromise.finally(() => {
      generation.password = "";
      this.generations.delete(generation);
    });
  }

  private async closeAll(): Promise<void> {
    await this.refreshPromise?.catch(() => undefined);
    for (const generation of this.generations) generation.retired = true;
    const results = await Promise.allSettled([...this.generations].map((generation) => this.endGeneration(generation)));
    this.state = "closed";
    if (this.retirementFailed || results.some((result) => result.status === "rejected")) {
      throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSE_FAILED");
    }
  }
}

async function fetchVaultCredential(
  binding: VaultProjectDatabaseBinding,
  options: ValidatedOptions,
  closeSignal: AbortSignal,
): Promise<VaultCredential> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs);
  const signal = AbortSignal.any([closeSignal, timeout.signal]);
  try {
    let token: string;
    try {
      token = await abortable(options.tokenProvider.getToken({ signal }), signal);
      if (!isValidToken(token)) throw new Error("Invalid token");
    } catch (error) {
      if (closeSignal.aborted) throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
      if (timeout.signal.aborted) throw new VaultProjectDatabaseCatalogError("VAULT_TIMEOUT");
      if (error instanceof VaultProjectDatabaseCatalogError) throw error;
      throw new VaultProjectDatabaseCatalogError("VAULT_TOKEN_UNAVAILABLE");
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "QKERN-Migration-Worker/0.21",
      "x-vault-token": token,
    };
    if (options.namespace) headers["x-vault-namespace"] = options.namespace;
    let response: Response;
    try {
      response = await options.fetchFn(vaultCredentialUrl(options.vaultDatabaseUrl, binding.vaultStaticRole), {
        method: "GET",
        headers,
        cache: "no-store",
        redirect: "error",
        signal,
      });
    } catch {
      if (closeSignal.aborted) throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
      if (timeout.signal.aborted) throw new VaultProjectDatabaseCatalogError("VAULT_TIMEOUT");
      throw new VaultProjectDatabaseCatalogError("VAULT_REQUEST_FAILED");
    }
    if (!response.ok || !isJson(response.headers.get("content-type"))) {
      await cancelBody(response);
      throw new VaultProjectDatabaseCatalogError("VAULT_RESPONSE_REJECTED");
    }
    const raw = await readBoundedBody(response, MAX_RESPONSE_BYTES);
    return parseCredential(raw, binding.expectedRole);
  } catch (error) {
    if (error instanceof VaultProjectDatabaseCatalogError) throw error;
    if (closeSignal.aborted) throw new VaultProjectDatabaseCatalogError("PROJECT_DATABASE_CATALOG_CLOSED");
    if (timeout.signal.aborted) throw new VaultProjectDatabaseCatalogError("VAULT_TIMEOUT");
    throw new VaultProjectDatabaseCatalogError("VAULT_REQUEST_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

function validateOptions(options: VaultProjectDatabaseCatalogOptions): ValidatedOptions {
  try {
    const production = options.production ?? false;
    const vaultDatabaseUrl = validatedVaultUrl(options.vaultDatabaseUrl, production);
    if (!Array.isArray(options.bindings) || options.bindings.length < 1 || options.bindings.length > 32 ||
        !options.bindings.every((binding) => isBinding(binding, production)) ||
        !options.tokenProvider || typeof options.tokenProvider.getToken !== "function") {
      throw new Error("Invalid options");
    }
    const namespace = options.namespace?.trim();
    if (namespace && (namespace.length > 256 || !VAULT_NAMESPACE.test(namespace))) {
      throw new Error("Invalid namespace");
    }
    return {
      vaultDatabaseUrl,
      bindings: options.bindings.map((binding) => Object.freeze({ ...binding, host: normalizedHost(binding.host) })),
      tokenProvider: options.tokenProvider,
      namespace,
      timeoutMs: boundedInteger(options.timeoutMs ?? 5_000, 100, 60_000),
      refreshSkewMs: boundedInteger(options.refreshSkewMs ?? 30_000, 100, 3_600_000),
      production,
      fetchFn: options.fetchFn ?? fetch,
      poolFactory: options.poolFactory ?? createPostgresPool,
      now: options.now ?? Date.now,
    };
  } catch (error) {
    if (error instanceof VaultProjectDatabaseCatalogError) throw error;
    throw new VaultProjectDatabaseCatalogError("INVALID_CONFIGURATION");
  }
}

function isBinding(value: unknown, production: boolean): value is VaultProjectDatabaseBinding {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  const required = ["databaseInstanceRef", "expectedDatabase", "expectedLedgerOwner", "expectedRole", "host", "port", "vaultStaticRole"];
  const withFingerprint = [...required, "serverCertificateSha256"];
  if (keys !== required.sort().join(",") && keys !== withFingerprint.sort().join(",")) return false;
  return isCatalogReference(value.databaseInstanceRef) &&
    typeof value.vaultStaticRole === "string" && VAULT_ROLE.test(value.vaultStaticRole) &&
    typeof value.host === "string" && isHost(value.host) &&
    Number.isSafeInteger(value.port) && Number(value.port) >= 1 && Number(value.port) <= 65_535 &&
    isIdentifier(value.expectedRole) && isIdentifier(value.expectedDatabase) && isIdentifier(value.expectedLedgerOwner) &&
    value.expectedRole !== value.expectedLedgerOwner &&
    (value.serverCertificateSha256 === undefined
      ? !production
      : typeof value.serverCertificateSha256 === "string" && FINGERPRINT.test(value.serverCertificateSha256));
}

function validatedVaultUrl(input: URL, production: boolean): URL {
  if (!(input instanceof URL)) throw new Error("Invalid URL");
  const url = new URL(input.toString());
  if (url.username || url.password || url.search || url.hash || !isHost(url.hostname) ||
      (production ? url.protocol !== "https:" : !["https:", "http:"].includes(url.protocol)) ||
      !VAULT_PATH.test(url.pathname.replace(/\/$/, ""))) {
    throw new Error("Invalid Vault URL");
  }
  url.hostname = normalizedHost(url.hostname);
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function poolConfig(
  binding: VaultProjectDatabaseBinding,
  credential: VaultCredential,
  production: boolean,
): PostgresPoolConfig {
  const connection = new URL("postgresql://placeholder.invalid");
  connection.username = credential.username;
  connection.password = credential.password;
  connection.hostname = isIP(binding.host) === 6 ? `[${binding.host}]` : binding.host;
  connection.port = binding.port.toString(10);
  connection.pathname = `/${binding.expectedDatabase}`;
  const expectedFingerprint = binding.serverCertificateSha256?.toLowerCase();
  return {
    connectionString: connection.toString(),
    applicationName: "qkern-vault-project-migrator",
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 15_000,
    ssl: expectedFingerprint ? {
      rejectUnauthorized: true,
      ...(isIP(binding.host) === 0 ? { servername: binding.host } : {}),
      checkServerIdentity: (hostname, certificate) => pinnedServerIdentity(
        binding.host,
        hostname,
        certificate,
        expectedFingerprint,
      ),
    } : production ? { rejectUnauthorized: true } : false,
  };
}

function pinnedServerIdentity(
  expectedHost: string,
  presentedHost: string,
  certificate: PeerCertificate,
  expectedFingerprint: string,
): Error | undefined {
  const hostnameError = checkServerIdentity(expectedHost, certificate);
  if (hostnameError || presentedHost !== expectedHost) return new Error("Project database TLS identity rejected.");
  const actual = certificate.fingerprint256?.replaceAll(":", "").toLowerCase() ?? "";
  if (!FINGERPRINT.test(actual) || !safeEqual(actual, expectedFingerprint)) {
    return new Error("Project database TLS identity rejected.");
  }
  return undefined;
}

function parseCredential(raw: string, expectedRole: string): VaultCredential {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("Invalid response");
    const { username, password, ttl } = parsed.data;
    if (typeof username !== "string" || username !== expectedRole || !isIdentifier(username) ||
        typeof password !== "string" || password.length < 1 || Buffer.byteLength(password, "utf8") > MAX_TOKEN_BYTES ||
        password.includes("\0") || !Number.isSafeInteger(ttl) || Number(ttl) < 1 || Number(ttl) > 31_536_000) {
      throw new Error("Invalid credential");
    }
    return Object.freeze({ username, password, ttlSeconds: Number(ttl) });
  } catch {
    throw new VaultProjectDatabaseCatalogError("VAULT_CREDENTIAL_REJECTED");
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    await cancelBody(response);
    throw new VaultProjectDatabaseCatalogError("VAULT_RESPONSE_TOO_LARGE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new VaultProjectDatabaseCatalogError("VAULT_RESPONSE_TOO_LARGE");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function vaultCredentialUrl(base: URL, role: string): URL {
  const url = new URL(base.toString());
  url.pathname = `${base.pathname}/static-creds/${encodeURIComponent(role)}`;
  return url;
}

function refreshDeadline(now: number, ttlSeconds: number, skewMs: number): number {
  const ttlMs = ttlSeconds * 1_000;
  return now + Math.max(100, ttlMs - Math.min(skewMs, Math.floor(ttlMs / 2)));
}

function abortable<T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(new Error("Aborted")); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => { cleanup(); resolve(result); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function isValidToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && Buffer.byteLength(value, "utf8") <= MAX_TOKEN_BYTES &&
    !/[\u0000-\u0020\u007f]/.test(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value) && !value.startsWith("pg_");
}

function isHost(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\.$/, "");
  return HOSTNAME.test(normalized) || isIP(normalized) !== 0 || normalized === "localhost";
}

function normalizedHost(value: string): string {
  return value.toLowerCase().replace(/\.$/, "");
}

function isJson(contentType: string | null): boolean {
  return /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPool(value: unknown): value is SqlPool {
  if (!value || typeof value !== "object") return false;
  const pool = value as Partial<SqlPool>;
  return typeof pool.connect === "function" && typeof pool.query === "function" && typeof pool.end === "function";
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid integer");
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function messageFor(code: VaultProjectDatabaseCatalogErrorCode): string {
  switch (code) {
    case "INVALID_CONFIGURATION": return "The Vault project database catalog configuration is invalid.";
    case "DUPLICATE_CATALOG_BINDING": return "The Vault project database catalog contains a duplicate binding.";
    case "PROJECT_DATABASE_REFERENCE_NOT_ALLOWED": return "The project database reference is not allowlisted.";
    case "PROJECT_DATABASE_CATALOG_CLOSED": return "The project database catalog is not available.";
    case "VAULT_TOKEN_UNAVAILABLE": return "The Vault access token is unavailable.";
    case "VAULT_TIMEOUT": return "The Vault credential request timed out.";
    case "VAULT_REQUEST_FAILED": return "The Vault credential request failed.";
    case "VAULT_RESPONSE_REJECTED": return "The Vault credential response was rejected.";
    case "VAULT_RESPONSE_TOO_LARGE": return "The Vault credential response exceeded the size limit.";
    case "VAULT_CREDENTIAL_REJECTED": return "The Vault credential response is invalid.";
    case "PROJECT_DATABASE_POOL_UNAVAILABLE": return "The project database connection pool is unavailable.";
    case "PROJECT_DATABASE_CATALOG_CLOSE_FAILED": return "The project database catalog could not be closed cleanly.";
  }
}
