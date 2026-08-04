import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PeerCertificate } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostgresPoolConfig } from "@/lib/server/db/pool";
import type { SqlPool, SqlPoolClient } from "@/lib/server/db/sql";
import {
  VaultProjectDatabaseCatalogError,
  VaultProjectDatabaseConnectionCatalog,
  VaultTokenFileProvider,
  type VaultProjectDatabaseBinding,
} from "@/lib/server/migrations/connection-catalog-vault";
import { createVaultProjectDatabaseCatalogFromEnv } from "@/lib/server/migrations/connection-catalog-vault-env";
import { itOnPosix } from "./support/posix";

const PIN = "ab".repeat(32);
const binding: VaultProjectDatabaseBinding = {
  databaseInstanceRef: "managed:database-1",
  vaultStaticRole: "project-database-1",
  host: "db.customer.example",
  port: 5432,
  expectedRole: "qkern_project_migrator",
  expectedDatabase: "project_database",
  expectedLedgerOwner: "qkern_ledger_owner",
  serverCertificateSha256: PIN,
};

function credential(password = "rotated!password", ttl = 120, username = binding.expectedRole): Response {
  return Response.json({
    request_id: "request-1",
    data: { username, password, ttl, last_vault_rotation: "2026-07-20T00:00:00Z", rotation_period: 300 },
  });
}

function rejected(status = 500): Response {
  return Response.json({ errors: ["provider detail that must not escape"] }, { status });
}

function mockPool(): {
  pool: SqlPool;
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  clients: SqlPoolClient[];
} {
  const clients: SqlPoolClient[] = [];
  const connect = vi.fn(async () => {
    const client: SqlPoolClient = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    clients.push(client);
    return client;
  });
  const end = vi.fn(async () => undefined);
  return {
    pool: { connect, query: vi.fn(async () => ({ rows: [], rowCount: 0 })), end },
    connect,
    end,
    clients,
  };
}

function createCatalog(overrides: Partial<ConstructorParameters<typeof VaultProjectDatabaseConnectionCatalog>[0]> = {}) {
  const created = mockPool();
  const poolFactory = vi.fn((_config: PostgresPoolConfig) => created.pool);
  const fetchFn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => credential());
  const catalog = new VaultProjectDatabaseConnectionCatalog({
    vaultDatabaseUrl: new URL("https://vault.service.internal:8200/v1/database"),
    bindings: [binding],
    tokenProvider: { getToken: vi.fn(async () => "hvs.valid-vault-token") },
    production: true,
    fetchFn: fetchFn as unknown as typeof fetch,
    poolFactory,
    ...overrides,
  });
  return { catalog, fetchFn, poolFactory, created };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Vault project database connection catalog", () => {
  it("resolves only an opaque allowlist reference and fetches exact static credentials", async () => {
    const { catalog, fetchFn, poolFactory, created } = createCatalog({ namespace: "qkern/production" });
    const resolved = catalog.resolve(binding.databaseInstanceRef);
    expect(resolved).toMatchObject({
      expectedRole: binding.expectedRole,
      expectedDatabase: binding.expectedDatabase,
      expectedLedgerOwner: binding.expectedLedgerOwner,
    });
    expect(JSON.stringify(resolved)).not.toContain("password");

    const client = await resolved.pool.connect();
    client.release();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, request] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://vault.service.internal:8200/v1/database/static-creds/project-database-1");
    expect(request).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect((request?.headers as Record<string, string>)["x-vault-token"]).toBe("hvs.valid-vault-token");
    expect((request?.headers as Record<string, string>)["x-vault-namespace"]).toBe("qkern/production");

    const config = poolFactory.mock.calls[0]![0];
    const connection = new URL(config.connectionString);
    expect(connection).toMatchObject({
      username: binding.expectedRole,
      password: "rotated!password",
      hostname: binding.host,
      port: "5432",
      pathname: `/${binding.expectedDatabase}`,
    });
    const ssl = config.ssl as Exclude<PostgresPoolConfig["ssl"], boolean | undefined>;
    const certificate = {
      subjectaltname: `DNS:${binding.host}`,
      fingerprint256: PIN.toUpperCase().match(/.{2}/g)!.join(":"),
    } as PeerCertificate;
    expect(ssl.checkServerIdentity?.(binding.host, certificate)).toBeUndefined();
    expect(ssl.checkServerIdentity?.(binding.host, { ...certificate, fingerprint256: "CD".repeat(32) }))
      .toBeInstanceOf(Error);
    await catalog.close();
    expect(created.end).toHaveBeenCalledTimes(1);
  });

  it("uses the same redacted failure for malformed, URL-shaped and unknown references", () => {
    const { catalog, fetchFn } = createCatalog();
    for (const reference of [
      "managed:missing",
      "postgresql://admin:secret@attacker.invalid/database",
      "managed:database-1@attacker",
    ]) {
      const error = (() => { try { catalog.resolve(reference); } catch (caught) { return caught; } })();
      expect(error).toMatchObject({ code: "PROJECT_DATABASE_REFERENCE_NOT_ALLOWED" });
      expect(String(error)).not.toContain(reference);
      expect(String(error)).not.toContain("secret");
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("coalesces concurrent first use into one token request, Vault request and pool", async () => {
    let releaseFetch!: (response: Response) => void;
    const fetchFn = vi.fn(() => new Promise<Response>((resolve) => { releaseFetch = resolve; }));
    const tokenProvider = { getToken: vi.fn(async () => "hvs.concurrent-token") };
    const created = mockPool();
    const poolFactory = vi.fn(() => created.pool);
    const catalog = createCatalog({ fetchFn, tokenProvider, poolFactory }).catalog;
    const pool = catalog.resolve(binding.databaseInstanceRef).pool;
    const first = pool.connect();
    const second = pool.connect();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    releaseFetch(credential());
    const [firstClient, secondClient] = await Promise.all([first, second]);
    expect(tokenProvider.getToken).toHaveBeenCalledTimes(1);
    expect(poolFactory).toHaveBeenCalledTimes(1);
    firstClient.release();
    secondClient.release();
    await catalog.close();
  });

  it("extends the lease without pool churn when Vault returns the same password", async () => {
    let now = 0;
    const fetchFn = vi.fn(async () => credential("same-password", 1));
    const created = mockPool();
    const poolFactory = vi.fn(() => created.pool);
    const catalog = createCatalog({ now: () => now, refreshSkewMs: 500, fetchFn, poolFactory }).catalog;
    const pool = catalog.resolve(binding.databaseInstanceRef).pool;
    (await pool.connect()).release();
    now = 600;
    (await pool.connect()).release();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(poolFactory).toHaveBeenCalledTimes(1);
    await catalog.close();
  });

  it("rotates atomically and retires the old pool only after its active client releases", async () => {
    let now = 0;
    const firstPool = mockPool();
    const secondPool = mockPool();
    const poolFactory = vi.fn()
      .mockReturnValueOnce(firstPool.pool)
      .mockReturnValueOnce(secondPool.pool);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(credential("password-one", 1))
      .mockResolvedValueOnce(credential("password-two", 120));
    const catalog = createCatalog({ now: () => now, refreshSkewMs: 500, fetchFn, poolFactory }).catalog;
    const pool = catalog.resolve(binding.databaseInstanceRef).pool;
    const activeOldClient = await pool.connect();
    now = 600;
    const newClient = await pool.connect();
    expect(firstPool.end).not.toHaveBeenCalled();
    expect(secondPool.connect).toHaveBeenCalledTimes(1);

    activeOldClient.release();
    await vi.waitFor(() => expect(firstPool.end).toHaveBeenCalledTimes(1));
    newClient.release();
    await catalog.close();
    expect(secondPool.end).toHaveBeenCalledTimes(1);
  });

  it("fails closed after credential expiry instead of silently reusing the old pool", async () => {
    let now = 0;
    const created = mockPool();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(credential("password-one", 1))
      .mockResolvedValueOnce(rejected(503));
    const catalog = createCatalog({
      now: () => now,
      refreshSkewMs: 500,
      fetchFn,
      poolFactory: () => created.pool,
    }).catalog;
    const pool = catalog.resolve(binding.databaseInstanceRef).pool;
    (await pool.connect()).release();
    now = 600;
    await expect(pool.connect()).rejects.toMatchObject({ code: "VAULT_RESPONSE_REJECTED" });
    expect(created.connect).toHaveBeenCalledTimes(1);
    await catalog.close();
  });

  it("rejects mismatched roles, oversized bodies and provider details without leaking secrets", async () => {
    for (const response of [
      credential("vault-super-secret", 120, "attacker_role"),
      new Response("x".repeat(32_769), { headers: { "content-type": "application/json" } }),
    ]) {
      const poolFactory = vi.fn(() => mockPool().pool);
      const catalog = createCatalog({ fetchFn: vi.fn(async () => response), poolFactory }).catalog;
      const error = await catalog.resolve(binding.databaseInstanceRef).pool.connect().catch((caught) => caught);
      expect(error).toBeInstanceOf(VaultProjectDatabaseCatalogError);
      expect(["VAULT_CREDENTIAL_REJECTED", "VAULT_RESPONSE_TOO_LARGE"]).toContain(error.code);
      expect(String(error)).not.toContain("vault-super-secret");
      expect(String(error)).not.toContain("attacker_role");
      expect(poolFactory).not.toHaveBeenCalled();
      await catalog.close();
    }
  });

  it("bounds token lookup and transport with one timeout", async () => {
    vi.useFakeTimers();
    const catalog = createCatalog({
      timeoutMs: 100,
      tokenProvider: { getToken: () => new Promise<string>(() => undefined) },
    }).catalog;
    const pending = catalog.resolve(binding.databaseInstanceRef).pool.connect();
    const rejectedAsTimeout = expect(pending).rejects.toMatchObject({ code: "VAULT_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(100);
    await rejectedAsTimeout;
    await catalog.close();
  });

  it("aborts an in-flight refresh and closes idempotently", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchFn = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => observedSignal?.addEventListener("abort", () => reject(new Error("secret transport detail"))));
    });
    const { catalog } = createCatalog({ fetchFn });
    const pending = catalog.resolve(binding.databaseInstanceRef).pool.connect();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const closing = catalog.close();
    expect(catalog.close()).toBe(closing);
    await closing;
    expect(observedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "PROJECT_DATABASE_CATALOG_CLOSED" });
    expect(() => catalog.resolve(binding.databaseInstanceRef)).toThrowError(expect.objectContaining({
      code: "PROJECT_DATABASE_CATALOG_CLOSED",
    }));
  });

  it("sanitizes pool construction and shutdown failures", async () => {
    const construction = createCatalog({
      poolFactory: () => { throw new Error("postgresql://admin:pool-secret@host/database"); },
    }).catalog;
    const constructionError = await construction.resolve(binding.databaseInstanceRef).pool.connect().catch((error) => error);
    expect(constructionError).toMatchObject({ code: "PROJECT_DATABASE_POOL_UNAVAILABLE" });
    expect(String(constructionError)).not.toContain("pool-secret");
    await construction.close();

    const broken = mockPool();
    broken.end.mockRejectedValue(new Error("postgresql://admin:close-secret@host/database"));
    const catalog = createCatalog({ poolFactory: () => broken.pool }).catalog;
    (await catalog.resolve(binding.databaseInstanceRef).pool.connect()).release();
    const closeError = await catalog.close().catch((error) => error);
    expect(closeError).toMatchObject({ code: "PROJECT_DATABASE_CATALOG_CLOSE_FAILED" });
    expect(String(closeError)).not.toContain("close-secret");
  });

  it("rejects insecure production bindings, duplicate static roles and mixed env authority", () => {
    expect(() => createCatalog({ bindings: [{ ...binding, serverCertificateSha256: undefined }] })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() => createCatalog({ bindings: [binding, { ...binding, databaseInstanceRef: "managed:database-2" }] }))
      .toThrowError(expect.objectContaining({ code: "DUPLICATE_CATALOG_BINDING" }));

    const env = {
      NODE_ENV: "production",
      QKERN_VAULT_DATABASE_URL: "https://vault.service.internal:8200/v1/database",
      QKERN_VAULT_PROJECT_DATABASE_CATALOG_JSON: JSON.stringify([binding]),
    };
    const dependencies = { tokenProvider: { getToken: () => "hvs.valid-token" } };
    expect(createVaultProjectDatabaseCatalogFromEnv(env, dependencies)).toBeInstanceOf(
      VaultProjectDatabaseConnectionCatalog,
    );
    expect(() => createVaultProjectDatabaseCatalogFromEnv({
      ...env,
      QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG: "true",
    }, dependencies)).toThrow("configuration is invalid");
    expect(() => createVaultProjectDatabaseCatalogFromEnv({
      ...env,
      VAULT_TOKEN: "hvs.environment-token-is-forbidden",
    }, dependencies)).toThrow("configuration is invalid");
    expect(() => createVaultProjectDatabaseCatalogFromEnv({
      ...env,
      QKERN_VAULT_DATABASE_URL: "http://vault.service.internal:8200/v1/database",
    }, dependencies)).toThrow("configuration is invalid");
  });
});

describe("Vault token file provider", () => {
  itOnPosix("rereads a private Agent sink for token rotation and rejects world-readable files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qkern-vault-token-"));
    const path = join(directory, "token");
    try {
      await writeFile(path, "hvs.first-agent-token\n", { mode: 0o600 });
      const provider = new VaultTokenFileProvider(path, { production: true });
      expect(await provider.getToken({ signal: new AbortController().signal })).toBe("hvs.first-agent-token");
      await writeFile(path, "hvs.second-agent-token\n", { mode: 0o600 });
      expect(await provider.getToken({ signal: new AbortController().signal })).toBe("hvs.second-agent-token");
      await chmod(path, 0o604);
      await expect(provider.getToken({ signal: new AbortController().signal })).rejects.toMatchObject({
        code: "VAULT_TOKEN_UNAVAILABLE",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
