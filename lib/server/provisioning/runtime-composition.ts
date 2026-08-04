import { ConfigurationError } from "@/lib/server/db/errors";
import {
  getProvisionerPostgresPool,
  verifyDatabaseBoundary,
} from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import {
  createSignedProjectProvisioningBrokerFromEnv,
  provisioningBrokerTimeoutMsFromEnv,
  type ProvisioningBrokerSigningKeyProvider,
} from "@/lib/server/provisioning/broker-adapter";
import { PostgresProjectDatabaseProvisioningPort } from "@/lib/server/provisioning/postgres-port";
import {
  ProjectDatabaseProvisioningWorker,
  type ProjectDatabaseProvisioningAdapter,
  type ProjectDatabaseProvisioningLogEvent,
} from "@/lib/server/provisioning/worker";
import type { RuntimeProbeObserver } from "@/lib/server/operations/runtime-probe";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE = /^[a-z0-9][a-z0-9._:-]{0,199}$/i;

export type ProjectProvisionerRuntimeConfiguration = Readonly<{
  organizationId: string;
  provisionerId: string;
  leaseMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  idleMs: number;
}>;

export function projectProvisionerRuntimeConfigurationFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectProvisionerRuntimeConfiguration {
  if (env.QKERN_PROJECT_PROVISIONER_ENABLED !== "true") {
    throw new ConfigurationError("The project database provisioner is disabled.");
  }
  const organizationId = env.QKERN_PROVISIONER_ORGANIZATION_ID?.trim() ?? "";
  const provisionerId = env.QKERN_PROJECT_PROVISIONER_ID?.trim() ?? "";
  if (!UUID.test(organizationId)) throw new ConfigurationError("QKERN_PROVISIONER_ORGANIZATION_ID must be a UUID.");
  if (!REFERENCE.test(provisionerId)) throw new ConfigurationError("QKERN_PROJECT_PROVISIONER_ID must be a bounded reference.");
  const leaseMs = integer(env, "QKERN_PROVISIONER_LEASE_MS", 60_000, 1_000, 900_000);
  if (provisioningBrokerTimeoutMsFromEnv(env) > leaseMs - 1_000) {
    throw new ConfigurationError("The provisioning broker timeout must leave 1000ms of lease time for completion.");
  }
  const retryBaseMs = integer(env, "QKERN_PROVISIONER_RETRY_BASE_MS", 1_000, 100, 60_000);
  return {
    organizationId,
    provisionerId,
    leaseMs,
    retryBaseMs,
    retryMaxMs: integer(env, "QKERN_PROVISIONER_RETRY_MAX_MS", 60_000, retryBaseMs, 86_400_000),
    idleMs: integer(env, "QKERN_PROVISIONER_IDLE_MS", 1_000, 10, 60_000),
  };
}

export function createProjectDatabaseProvisioningWorkerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: {
    pool?: SqlPool;
    adapter?: ProjectDatabaseProvisioningAdapter;
    logger?: { log(event: ProjectDatabaseProvisioningLogEvent): void };
    fetchFn?: typeof fetch;
    now?: () => Date;
    signingKeyProvider?: ProvisioningBrokerSigningKeyProvider;
    probe?: RuntimeProbeObserver;
  } = {},
): ProjectDatabaseProvisioningWorker {
  const config = projectProvisionerRuntimeConfigurationFromEnv(env);
  const pool = dependencies.pool
    ? verifyDatabaseBoundary(dependencies.pool, "provisioner")
    : getProvisionerPostgresPool(env);
  const adapter = dependencies.adapter ?? createSignedProjectProvisioningBrokerFromEnv(env, {
    signingKeyProvider: dependencies.signingKeyProvider,
    fetchFn: dependencies.fetchFn,
    now: dependencies.now,
  });
  return new ProjectDatabaseProvisioningWorker(
    new PostgresProjectDatabaseProvisioningPort(new PostgresControlPlane(pool), config.organizationId),
    adapter,
    {
      provisionerId: config.provisionerId,
      leaseDurationMs: config.leaseMs,
      retryBaseDelayMs: config.retryBaseMs,
      retryMaxDelayMs: config.retryMaxMs,
      idleDelayMs: config.idleMs,
      logger: dependencies.logger,
      now: dependencies.now,
      probe: dependencies.probe,
    },
  );
}

function integer(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(`${name} is invalid.`);
  }
  return value;
}
