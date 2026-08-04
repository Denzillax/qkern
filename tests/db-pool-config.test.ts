import { describe, expect, it } from "vitest";
import {
  postgresPoolConfigFromEnv,
  provisionerPostgresPoolConfigFromEnv,
  verifyDatabaseBoundary,
  workerPostgresPoolConfigFromEnv,
} from "@/lib/server/db/pool";
import type { SqlPool, SqlPoolClient, SqlQueryResult } from "@/lib/server/db/sql";

class BoundaryPool implements SqlPool {
  constructor(private readonly role: {
    rolsuper: boolean; rolbypassrls: boolean; runtime_member: boolean; auth_member: boolean;
    rolcreatedb?: boolean; rolcreaterole?: boolean; rolreplication?: boolean; privileged_member?: boolean;
    rolname?: string; session_user?: string; rolcanlogin?: boolean; unexpected_member?: boolean; worker_member?: boolean;
    provisioner_member?: boolean;
  }) {}
  async query<Row extends Record<string, unknown>>(text: string): Promise<SqlQueryResult<Row>> {
    const rows = text.includes("pg_has_role") ? [{
      rolname: "qkern_app", session_user: "qkern_app", rolcanlogin: true,
      unexpected_member: false, worker_member: false, provisioner_member: false,
      ...this.role,
    }] : [];
    return { rows: rows as unknown as Row[], rowCount: rows.length };
  }
  async connect(): Promise<SqlPoolClient> { throw new Error("not needed"); }
  async end(): Promise<void> {}
}

describe("PostgreSQL runtime configuration", () => {
  it("requires a distinct runtime credential in production", () => {
    expect(() => postgresPoolConfigFromEnv({ NODE_ENV: "production", DATABASE_URL: "postgresql://owner/db" } as NodeJS.ProcessEnv)).toThrow("QKERN_RUNTIME_DATABASE_URL");
  });

  it("prefers the least-privilege runtime connection", () => {
    const config = postgresPoolConfigFromEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://owner/db",
      QKERN_RUNTIME_DATABASE_URL: "postgresql://runtime/db",
      DATABASE_SSL: "require",
    } as NodeJS.ProcessEnv);
    expect(config.connectionString).toBe("postgresql://runtime/db");
  });

  it("requires a distinct worker credential and production TLS", () => {
    expect(() => workerPostgresPoolConfigFromEnv({ NODE_ENV: "production", DATABASE_SSL: "require" }))
      .toThrow("QKERN_WORKER_DATABASE_URL");
    expect(() => workerPostgresPoolConfigFromEnv({
      NODE_ENV: "production",
      DATABASE_SSL: "disable",
      QKERN_WORKER_DATABASE_URL: "postgresql://worker/db",
    })).toThrow("DATABASE_SSL=require");
    expect(workerPostgresPoolConfigFromEnv({
      NODE_ENV: "production",
      DATABASE_SSL: "require",
      QKERN_WORKER_DATABASE_URL: "postgresql://worker/db",
    })).toMatchObject({ connectionString: "postgresql://worker/db", applicationName: "qkern-migration-worker" });
  });

  it("requires a distinct provisioner credential and production TLS", () => {
    expect(() => provisionerPostgresPoolConfigFromEnv({ NODE_ENV: "production", DATABASE_SSL: "require" }))
      .toThrow("QKERN_PROVISIONER_DATABASE_URL");
    expect(() => provisionerPostgresPoolConfigFromEnv({
      NODE_ENV: "production", DATABASE_SSL: "disable",
      QKERN_PROVISIONER_DATABASE_URL: "postgresql://provisioner/db",
    })).toThrow("DATABASE_SSL=require");
    expect(provisionerPostgresPoolConfigFromEnv({
      NODE_ENV: "production", DATABASE_SSL: "require",
      QKERN_PROVISIONER_DATABASE_URL: "postgresql://provisioner/db",
    })).toMatchObject({
      connectionString: "postgresql://provisioner/db",
      applicationName: "qkern-project-provisioner",
    });
  });

  it("rejects superusers and cross-boundary role memberships before queries run", async () => {
    const validRuntime = verifyDatabaseBoundary(new BoundaryPool({ rolsuper: false, rolbypassrls: false, runtime_member: true, auth_member: false }), "runtime");
    await expect(validRuntime.query("SELECT 1")).resolves.toMatchObject({ rowCount: 0 });

    const merged = verifyDatabaseBoundary(new BoundaryPool({ rolsuper: false, rolbypassrls: false, runtime_member: true, auth_member: true }), "runtime");
    await expect(merged.query("SELECT 1")).rejects.toThrow("least-privilege role boundary");

    const validAuth = verifyDatabaseBoundary(new BoundaryPool({ rolsuper: false, rolbypassrls: false, runtime_member: false, auth_member: true }), "auth");
    await expect(validAuth.query("SELECT 1")).resolves.toMatchObject({ rowCount: 0 });

    const validWorker = verifyDatabaseBoundary(new BoundaryPool({
      rolsuper: false, rolbypassrls: false, runtime_member: false, auth_member: false, worker_member: true,
    }), "worker");
    await expect(validWorker.query("SELECT 1")).resolves.toMatchObject({ rowCount: 0 });

    const validProvisioner = verifyDatabaseBoundary(new BoundaryPool({
      rolsuper: false, rolbypassrls: false, runtime_member: false, auth_member: false,
      provisioner_member: true,
    }), "provisioner");
    await expect(validProvisioner.query("SELECT 1")).resolves.toMatchObject({ rowCount: 0 });

    const bypassRls = verifyDatabaseBoundary(new BoundaryPool({ rolsuper: false, rolbypassrls: true, runtime_member: true, auth_member: false }), "runtime");
    await expect(bypassRls.query("SELECT 1")).rejects.toThrow("least-privilege role boundary");

    const privilegedMembership = verifyDatabaseBoundary(new BoundaryPool({
      rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false,
      rolreplication: false, privileged_member: true, runtime_member: true, auth_member: false,
    }), "runtime");
    await expect(privilegedMembership.query("SELECT 1")).rejects.toThrow("least-privilege role boundary");

    const switchedRole = verifyDatabaseBoundary(new BoundaryPool({
      rolsuper: false, rolbypassrls: false, runtime_member: true, auth_member: false,
      session_user: "database_owner",
    }), "runtime");
    await expect(switchedRole.query("SELECT 1")).rejects.toThrow("least-privilege role boundary");

    const unexpectedMembership = verifyDatabaseBoundary(new BoundaryPool({
      rolsuper: false, rolbypassrls: false, runtime_member: true, auth_member: false,
      unexpected_member: true,
    }), "runtime");
    await expect(unexpectedMembership.query("SELECT 1")).rejects.toThrow("least-privilege role boundary");

    const superuser = verifyDatabaseBoundary(new BoundaryPool({ rolsuper: true, rolbypassrls: false, runtime_member: false, auth_member: true }), "auth");
    await expect(superuser.query("SELECT 1")).rejects.toThrow("least-privilege role boundary");
  });
});
