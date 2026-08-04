import { describe, expect, it, vi } from "vitest";
import type { StatementCipher } from "@/lib/server/control-plane/crypto";
import type { SqlPool } from "@/lib/server/db/sql";
import { ConfigurationError } from "@/lib/server/db/errors";
import {
  createMigrationIncidentOutboxPublisherFromEnv,
  createMigrationIncidentWebhookPublisherFromEnv,
  createMigrationApplyBrokerPublisherFromEnv,
  createMigrationOutboxPublisherFromEnv,
  createMigrationWorkerRuntimeFromEnv,
  migrationRuntimeConfigurationFromEnv,
} from "@/lib/server/migrations/runtime-composition";
import { TrustedProjectDatabaseConnectionCatalog } from "@/lib/server/migrations/connection-catalog";

const ORGANIZATION_ID = "0d9423d9-7437-4f66-898a-86275e6598fb";
const baseEnv = {
  NODE_ENV: "development",
  QKERN_RUNTIME_MODE: "postgres",
  QKERN_MIGRATION_WORKER_ENABLED: "true",
  QKERN_WORKER_ORGANIZATION_ID: ORGANIZATION_ID,
  QKERN_MIGRATION_WORKER_ID: "worker-1",
};

describe("migration runtime composition", () => {
  it("is disabled by default and requires explicit PostgreSQL tenant/worker bindings", () => {
    expect(() => migrationRuntimeConfigurationFromEnv({ QKERN_RUNTIME_MODE: "postgres" }))
      .toThrow("disabled");
    expect(() => migrationRuntimeConfigurationFromEnv({
      ...baseEnv,
      QKERN_WORKER_ORGANIZATION_ID: "org-not-a-uuid",
    })).toThrow("must be a UUID");
    expect(() => migrationRuntimeConfigurationFromEnv({
      ...baseEnv,
      QKERN_RUNTIME_MODE: "memory",
    })).toThrow("requires QKERN_RUNTIME_MODE=postgres");
  });

  it("constructs only from an injected catalog, worker pool and cipher", () => {
    const pool = {
      connect: vi.fn(), query: vi.fn(), end: vi.fn(),
    } as unknown as SqlPool;
    const cipher = {
      encrypt: vi.fn(), decrypt: vi.fn(),
    } as unknown as StatementCipher;
    const runtime = createMigrationWorkerRuntimeFromEnv(baseEnv, {
      catalog: new TrustedProjectDatabaseConnectionCatalog(),
      pool,
      cipher,
    });
    expect(runtime).toBeDefined();
  });

  it("verifies the worker database role even for an injected publisher pool", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      rolname: "qkern_app",
      session_user: "qkern_app",
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      privileged_member: false,
      unexpected_member: false,
      runtime_member: true,
      auth_member: false,
      worker_member: false,
    }], rowCount: 1 });
    const connect = vi.fn();
    const sink = { publish: vi.fn() };
    const publisher = createMigrationOutboxPublisherFromEnv(
      {
        ...baseEnv,
        QKERN_OUTBOX_PUBLISHER_ENABLED: "true",
        QKERN_OUTBOX_PUBLISHER_ID: "publisher-1",
      },
      sink,
      { pool: { query, connect, end: vi.fn() } as unknown as SqlPool },
    );

    await expect(publisher.runOnce()).resolves.toEqual({ status: "retry_command_failed" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("worker_member"), ["qkern_worker"]);
    expect(connect).not.toHaveBeenCalled();
    expect(sink.publish).not.toHaveBeenCalled();
  });

  it("configures the outbox publisher independently from worker enablement and identity", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const publisher = createMigrationOutboxPublisherFromEnv(
      {
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_WORKER_ORGANIZATION_ID: ORGANIZATION_ID,
        QKERN_OUTBOX_PUBLISHER_ENABLED: "true",
        QKERN_OUTBOX_PUBLISHER_ID: "publisher-standalone",
      },
      { publish: vi.fn() },
      { pool: { query, connect: vi.fn(), end: vi.fn() } as unknown as SqlPool },
    );

    await expect(publisher.runOnce()).resolves.toEqual({ status: "retry_command_failed" });
    expect(query).toHaveBeenCalled();
  });

  it("configures the incident publisher independently from worker and apply-outbox enablement", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const sink = { publish: vi.fn() };
    const publisher = createMigrationIncidentOutboxPublisherFromEnv(
      {
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_WORKER_ORGANIZATION_ID: ORGANIZATION_ID,
        QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED: "true",
        QKERN_INCIDENT_OUTBOX_PUBLISHER_ID: "incident-publisher-standalone",
      },
      sink,
      { pool: { query, connect: vi.fn(), end: vi.fn() } as unknown as SqlPool },
    );

    await expect(publisher.runOnce()).resolves.toEqual({ status: "retry_command_failed" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("worker_member"), ["qkern_worker"]);
    expect(sink.publish).not.toHaveBeenCalled();
  });

  it("keeps the incident publisher disabled, PostgreSQL-only and tenant-bound", () => {
    const pool = { query: vi.fn(), connect: vi.fn(), end: vi.fn() } as unknown as SqlPool;
    const sink = { publish: vi.fn() };
    const incidentEnv = {
      QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED: "true",
      QKERN_INCIDENT_OUTBOX_PUBLISHER_ID: "incident-publisher-1",
      QKERN_WORKER_ORGANIZATION_ID: ORGANIZATION_ID,
    };

    expect(() => createMigrationIncidentOutboxPublisherFromEnv(
      { ...incidentEnv, QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED: "false", QKERN_RUNTIME_MODE: "postgres" },
      sink,
      { pool },
    )).toThrow("disabled");
    expect(() => createMigrationIncidentOutboxPublisherFromEnv(
      { ...incidentEnv, QKERN_RUNTIME_MODE: "memory" }, sink, { pool },
    )).toThrow("requires QKERN_RUNTIME_MODE=postgres");
    expect(() => createMigrationIncidentOutboxPublisherFromEnv(
      { ...incidentEnv, QKERN_RUNTIME_MODE: "postgres", QKERN_WORKER_ORGANIZATION_ID: "invalid" },
      sink,
      { pool },
    )).toThrow("QKERN_WORKER_ORGANIZATION_ID must be a UUID");
  });

  it("composes the signed incident host only when its timeout leaves lease completion headroom", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const env = {
      QKERN_RUNTIME_MODE: "postgres",
      QKERN_WORKER_ORGANIZATION_ID: ORGANIZATION_ID,
      QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED: "true",
      QKERN_INCIDENT_OUTBOX_PUBLISHER_ID: "incident-webhook-1",
      QKERN_INCIDENT_OUTBOX_LEASE_MS: "30000",
      QKERN_INCIDENT_WEBHOOK_TIMEOUT_MS: "10000",
      QKERN_INCIDENT_WEBHOOK_URL: "https://pager.example.com/qkern/incidents",
      QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS: "pager.example.com",
      QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID: "pager-primary-2026-07",
      QKERN_INCIDENT_WEBHOOK_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
      NODE_ENV: "production",
    };
    const publisher = createMigrationIncidentWebhookPublisherFromEnv(env, {
      pool: { query, connect: vi.fn(), end: vi.fn() } as unknown as SqlPool,
      fetchFn: vi.fn(),
    });
    await expect(publisher.runOnce()).resolves.toEqual({ status: "retry_command_failed" });

    expect(() => createMigrationIncidentWebhookPublisherFromEnv({
      ...env,
      QKERN_INCIDENT_OUTBOX_LEASE_MS: "10000",
      QKERN_INCIDENT_WEBHOOK_TIMEOUT_MS: "9001",
    }, {
      pool: { query, connect: vi.fn(), end: vi.fn() } as unknown as SqlPool,
    })).toThrow("leave at least 1000ms");
  });

  it("composes the signed apply broker only with lease completion headroom", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const env = {
      QKERN_RUNTIME_MODE: "postgres",
      QKERN_WORKER_ORGANIZATION_ID: ORGANIZATION_ID,
      QKERN_OUTBOX_PUBLISHER_ENABLED: "true",
      QKERN_OUTBOX_PUBLISHER_ID: "apply-broker-1",
      QKERN_OUTBOX_LEASE_MS: "30000",
      QKERN_APPLY_BROKER_TIMEOUT_MS: "10000",
      QKERN_APPLY_BROKER_URL: "https://broker.example.com/qkern/apply",
      QKERN_APPLY_BROKER_ALLOWED_HOSTS: "broker.example.com",
      NODE_ENV: "production",
    };
    const signingKeyProvider = {
      getActiveSigningKey: vi.fn().mockResolvedValue({
        keyId: "broker-primary-2026-07",
        secret: "0123456789abcdef0123456789abcdef",
      }),
    };
    const publisher = createMigrationApplyBrokerPublisherFromEnv(env, {
      pool: { query, connect: vi.fn(), end: vi.fn() } as unknown as SqlPool,
      signingKeyProvider,
      fetchFn: vi.fn(),
    });
    await expect(publisher.runOnce()).resolves.toEqual({ status: "retry_command_failed" });

    expect(() => createMigrationApplyBrokerPublisherFromEnv({
      ...env,
      QKERN_OUTBOX_LEASE_MS: "10000",
      QKERN_APPLY_BROKER_TIMEOUT_MS: "9001",
    }, {
      pool: { query, connect: vi.fn(), end: vi.fn() } as unknown as SqlPool,
      signingKeyProvider,
    })).toThrow("leave at least 1000ms");
  });

  it("keeps standalone publisher PostgreSQL and tenant gates fail-closed", () => {
    const pool = { query: vi.fn(), connect: vi.fn(), end: vi.fn() } as unknown as SqlPool;
    const sink = { publish: vi.fn() };
    const publisherEnv = {
      QKERN_OUTBOX_PUBLISHER_ENABLED: "true",
      QKERN_OUTBOX_PUBLISHER_ID: "publisher-1",
      QKERN_WORKER_ORGANIZATION_ID: ORGANIZATION_ID,
    };

    expect(() => createMigrationOutboxPublisherFromEnv(
      { ...publisherEnv, QKERN_RUNTIME_MODE: "memory" }, sink, { pool },
    )).toThrow("requires QKERN_RUNTIME_MODE=postgres");
    expect(() => createMigrationOutboxPublisherFromEnv(
      { ...publisherEnv, QKERN_RUNTIME_MODE: "postgres", QKERN_WORKER_ORGANIZATION_ID: "invalid" },
      sink,
      { pool },
    )).toThrow("QKERN_WORKER_ORGANIZATION_ID must be a UUID");
  });

  it("rejects malformed timing configuration with a sanitized configuration error", () => {
    expect(() => migrationRuntimeConfigurationFromEnv({ ...baseEnv, QKERN_WORKER_LEASE_MS: "NaN" }))
      .toThrow(ConfigurationError);
    expect(() => migrationRuntimeConfigurationFromEnv({
      ...baseEnv,
      QKERN_WORKER_LEASE_MS: "1000",
      QKERN_WORKER_HEARTBEAT_MS: "1000",
    })).toThrow(ConfigurationError);
    expect(() => createMigrationIncidentOutboxPublisherFromEnv({
      QKERN_RUNTIME_MODE: "postgres",
      QKERN_WORKER_ORGANIZATION_ID: ORGANIZATION_ID,
      QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED: "true",
      QKERN_INCIDENT_OUTBOX_PUBLISHER_ID: "incident-publisher-1",
      QKERN_INCIDENT_OUTBOX_LEASE_MS: "NaN",
    }, { publish: vi.fn() }, {
      pool: { query: vi.fn(), connect: vi.fn(), end: vi.fn() } as unknown as SqlPool,
    })).toThrow(ConfigurationError);
  });
});
