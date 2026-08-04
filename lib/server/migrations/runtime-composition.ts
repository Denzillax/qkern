import { ConfigurationError } from "@/lib/server/db/errors";
import { getWorkerPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import { statementCipherFromEnv, type StatementCipher } from "@/lib/server/control-plane/crypto";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import type { ProjectDatabaseConnectionResolver } from "@/lib/server/migrations/postgres-executor";
import { PostgresProjectDatabaseExecutor } from "@/lib/server/migrations/postgres-executor";
import { PostgresMigrationQueue } from "@/lib/server/migrations/postgres-queue";
import { MigrationWorker, type MigrationWorkerLogger } from "@/lib/server/migrations/worker";
import {
  MigrationWorkerRuntime,
  type MigrationWorkerRuntimeLogger,
} from "@/lib/server/migrations/worker-runtime";
import { MigrationOutboxPublisher, type MigrationOutboxPublisherLogger, type MigrationOutboxSink } from "@/lib/server/migrations/outbox-publisher";
import { PostgresMigrationOutboxLeasePort } from "@/lib/server/migrations/postgres-outbox";
import {
  MigrationIncidentOutboxPublisher,
  type MigrationIncidentOutboxPublisherLogger,
  type MigrationIncidentOutboxSink,
} from "@/lib/server/migrations/incident-outbox-publisher";
import { PostgresMigrationIncidentOutboxLeasePort } from "@/lib/server/migrations/postgres-incident-outbox";
import {
  applyBrokerTimeoutMsFromEnv,
  createSignedApplyBrokerSinkFromEnv,
  type ApplyBrokerSigningKeyProvider,
} from "@/lib/server/migrations/apply-broker-sink";
import {
  createSignedIncidentWebhookSinkFromEnv,
  incidentWebhookTimeoutMsFromEnv,
  type IncidentWebhookSigningKeyProvider,
} from "@/lib/server/migrations/incident-webhook-sink";
import type { RuntimeProbeObserver } from "@/lib/server/operations/runtime-probe";
import { createProductionApplyAuthorizerFromEnv } from
  "@/lib/server/migrations/production-apply-authorization-runtime";
import type { ProductionApplyAuthorizer } from
  "@/lib/server/migrations/production-apply-authorization";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE = /^[a-z0-9][a-z0-9._:-]{0,199}$/i;

export type MigrationRuntimeConfiguration = {
  organizationId: string;
  workerId: string;
  workerLeaseMs: number;
  workerHeartbeatMs: number;
  workerIdleMs: number;
  workerRetryBaseMs: number;
  workerErrorMaxMs: number;
};

type MigrationTenantConfiguration = {
  organizationId: string;
};

export type MigrationWorkerCompositionDependencies = {
  catalog: ProjectDatabaseConnectionResolver;
  pool?: SqlPool;
  cipher?: StatementCipher;
  workerLogger?: MigrationWorkerLogger;
  runtimeLogger?: MigrationWorkerRuntimeLogger;
  probe?: RuntimeProbeObserver;
  productionApplyAuthorizer?: ProductionApplyAuthorizer;
};

export function migrationRuntimeConfigurationFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MigrationRuntimeConfiguration {
  if (env.QKERN_MIGRATION_WORKER_ENABLED !== "true") {
    throw new ConfigurationError("The migration worker runtime is disabled.");
  }
  const { organizationId } = migrationTenantConfigurationFromEnv(env, "migration worker");
  const workerId = env.QKERN_MIGRATION_WORKER_ID?.trim() ?? "";
  if (!REFERENCE.test(workerId)) throw new ConfigurationError("QKERN_MIGRATION_WORKER_ID must be a bounded reference.");
  const workerLeaseMs = integerFromEnv(env, "QKERN_WORKER_LEASE_MS", 60_000, 1_000, 600_000);
  return {
    organizationId,
    workerId,
    workerLeaseMs,
    workerHeartbeatMs: integerFromEnv(
      env,
      "QKERN_WORKER_HEARTBEAT_MS",
      Math.max(250, Math.floor(workerLeaseMs / 3)),
      100,
      workerLeaseMs - 1,
    ),
    workerIdleMs: integerFromEnv(env, "QKERN_WORKER_IDLE_MS", 1_000, 10, 60_000),
    workerRetryBaseMs: integerFromEnv(env, "QKERN_WORKER_RETRY_BASE_MS", 1_000, 100, 60_000),
    workerErrorMaxMs: integerFromEnv(env, "QKERN_WORKER_ERROR_MAX_MS", 30_000, 10, 60_000),
  };
}

export function createMigrationWorkerRuntimeFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: MigrationWorkerCompositionDependencies,
): MigrationWorkerRuntime {
  const config = migrationRuntimeConfigurationFromEnv(env);
  if (!dependencies.catalog || typeof dependencies.catalog.resolve !== "function") {
    throw new ConfigurationError("A trusted project database catalog is required.");
  }
  const pool = dependencies.pool
    ? verifyDatabaseBoundary(dependencies.pool, "worker")
    : getWorkerPostgresPool(env);
  const cipher = dependencies.cipher ?? statementCipherFromEnv(env);
  const database = new PostgresControlPlane(pool);
  const queue = new PostgresMigrationQueue(database, config.organizationId);
  const executor = new PostgresProjectDatabaseExecutor(dependencies.catalog);
  const worker = new MigrationWorker(queue, executor, cipher, {
    workerId: config.workerId,
    leaseDurationMs: config.workerLeaseMs,
    heartbeatIntervalMs: config.workerHeartbeatMs,
    retryBaseDelayMs: config.workerRetryBaseMs,
    logger: dependencies.workerLogger,
  }, dependencies.productionApplyAuthorizer ?? createProductionApplyAuthorizerFromEnv(env));
  return new MigrationWorkerRuntime(worker, {
    idleDelayMs: config.workerIdleMs,
    errorBaseDelayMs: config.workerRetryBaseMs,
    errorMaxDelayMs: config.workerErrorMaxMs,
    logger: dependencies.runtimeLogger,
    probe: dependencies.probe,
  });
}

export function createMigrationOutboxPublisherFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  sink: MigrationOutboxSink,
  dependencies: {
    pool?: SqlPool;
    logger?: MigrationOutboxPublisherLogger;
    probe?: RuntimeProbeObserver;
  } = {},
): MigrationOutboxPublisher {
  if (env.QKERN_OUTBOX_PUBLISHER_ENABLED !== "true") {
    throw new ConfigurationError("The migration outbox publisher is disabled.");
  }
  const { organizationId } = migrationTenantConfigurationFromEnv(env, "migration outbox publisher");
  const publisherId = env.QKERN_OUTBOX_PUBLISHER_ID?.trim() ?? "";
  if (!REFERENCE.test(publisherId)) throw new ConfigurationError("QKERN_OUTBOX_PUBLISHER_ID must be a bounded reference.");
  if (!sink || typeof sink.publish !== "function") throw new ConfigurationError("A migration outbox sink is required.");
  const pool = dependencies.pool
    ? verifyDatabaseBoundary(dependencies.pool, "worker")
    : getWorkerPostgresPool(env);
  return new MigrationOutboxPublisher(
    new PostgresMigrationOutboxLeasePort(new PostgresControlPlane(pool), organizationId),
    sink,
    {
      publisherId,
      leaseDurationMs: integerFromEnv(env, "QKERN_OUTBOX_LEASE_MS", 30_000, 1_000, 900_000),
      retryBaseDelayMs: integerFromEnv(env, "QKERN_OUTBOX_RETRY_BASE_MS", 1_000, 10, 86_400_000),
      retryMaxDelayMs: integerFromEnv(env, "QKERN_OUTBOX_RETRY_MAX_MS", 60_000, 10, 86_400_000),
      idleDelayMs: integerFromEnv(env, "QKERN_OUTBOX_IDLE_MS", 1_000, 10, 60_000),
      logger: dependencies.logger,
      probe: dependencies.probe,
    },
  );
}

export function createMigrationApplyBrokerPublisherFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: {
    pool?: SqlPool;
    logger?: MigrationOutboxPublisherLogger;
    fetchFn?: typeof fetch;
    now?: () => Date;
    signingKeyProvider?: ApplyBrokerSigningKeyProvider;
    probe?: RuntimeProbeObserver;
  } = {},
): MigrationOutboxPublisher {
  if (env.QKERN_OUTBOX_PUBLISHER_ENABLED !== "true") {
    throw new ConfigurationError("The migration outbox publisher is disabled.");
  }
  const leaseMs = integerFromEnv(env, "QKERN_OUTBOX_LEASE_MS", 30_000, 1_000, 900_000);
  const timeoutMs = applyBrokerTimeoutMsFromEnv(env);
  if (timeoutMs > leaseMs - 1_000) {
    throw new ConfigurationError(
      "QKERN_APPLY_BROKER_TIMEOUT_MS must leave at least 1000ms of the migration outbox lease for completion.",
    );
  }
  const sink = createSignedApplyBrokerSinkFromEnv(env, {
    fetchFn: dependencies.fetchFn,
    now: dependencies.now,
    signingKeyProvider: dependencies.signingKeyProvider,
  });
  return createMigrationOutboxPublisherFromEnv(env, sink, {
    pool: dependencies.pool,
    logger: dependencies.logger,
    probe: dependencies.probe,
  });
}

export function createMigrationIncidentOutboxPublisherFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  sink: MigrationIncidentOutboxSink,
  dependencies: {
    pool?: SqlPool;
    logger?: MigrationIncidentOutboxPublisherLogger;
    probe?: RuntimeProbeObserver;
  } = {},
): MigrationIncidentOutboxPublisher {
  if (env.QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED !== "true") {
    throw new ConfigurationError("The migration incident outbox publisher is disabled.");
  }
  const { organizationId } = migrationTenantConfigurationFromEnv(env, "migration incident outbox publisher");
  const publisherId = env.QKERN_INCIDENT_OUTBOX_PUBLISHER_ID?.trim() ?? "";
  if (!REFERENCE.test(publisherId)) {
    throw new ConfigurationError("QKERN_INCIDENT_OUTBOX_PUBLISHER_ID must be a bounded reference.");
  }
  if (!sink || typeof sink.publish !== "function") {
    throw new ConfigurationError("A migration incident outbox sink is required.");
  }
  const pool = dependencies.pool
    ? verifyDatabaseBoundary(dependencies.pool, "worker")
    : getWorkerPostgresPool(env);
  return new MigrationIncidentOutboxPublisher(
    new PostgresMigrationIncidentOutboxLeasePort(new PostgresControlPlane(pool), organizationId),
    sink,
    {
      publisherId,
      leaseDurationMs: integerFromEnv(env, "QKERN_INCIDENT_OUTBOX_LEASE_MS", 30_000, 1_000, 900_000),
      retryBaseDelayMs: integerFromEnv(env, "QKERN_INCIDENT_OUTBOX_RETRY_BASE_MS", 1_000, 10, 86_400_000),
      retryMaxDelayMs: integerFromEnv(env, "QKERN_INCIDENT_OUTBOX_RETRY_MAX_MS", 60_000, 10, 86_400_000),
      idleDelayMs: integerFromEnv(env, "QKERN_INCIDENT_OUTBOX_IDLE_MS", 1_000, 10, 60_000),
      logger: dependencies.logger,
      probe: dependencies.probe,
    },
  );
}

export function createMigrationIncidentWebhookPublisherFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: {
    pool?: SqlPool;
    logger?: MigrationIncidentOutboxPublisherLogger;
    fetchFn?: typeof fetch;
    now?: () => Date;
    signingKeyProvider?: IncidentWebhookSigningKeyProvider;
    probe?: RuntimeProbeObserver;
  } = {},
): MigrationIncidentOutboxPublisher {
  if (env.QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED !== "true") {
    throw new ConfigurationError("The migration incident outbox publisher is disabled.");
  }
  const leaseMs = integerFromEnv(env, "QKERN_INCIDENT_OUTBOX_LEASE_MS", 30_000, 1_000, 900_000);
  const timeoutMs = incidentWebhookTimeoutMsFromEnv(env);
  if (timeoutMs > leaseMs - 1_000) {
    throw new ConfigurationError(
      "QKERN_INCIDENT_WEBHOOK_TIMEOUT_MS must leave at least 1000ms of the incident outbox lease for completion.",
    );
  }
  const sink = createSignedIncidentWebhookSinkFromEnv(env, {
    fetchFn: dependencies.fetchFn,
    now: dependencies.now,
    signingKeyProvider: dependencies.signingKeyProvider,
  });
  return createMigrationIncidentOutboxPublisherFromEnv(env, sink, {
    pool: dependencies.pool,
    logger: dependencies.logger,
    probe: dependencies.probe,
  });
}

function migrationTenantConfigurationFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  component: string,
): MigrationTenantConfiguration {
  if (runtimeModeFromEnv(env) !== "postgres") {
    throw new ConfigurationError(`The ${component} requires QKERN_RUNTIME_MODE=postgres.`);
  }
  const organizationId = env.QKERN_WORKER_ORGANIZATION_ID?.trim() ?? "";
  if (!UUID.test(organizationId)) {
    throw new ConfigurationError("QKERN_WORKER_ORGANIZATION_ID must be a UUID.");
  }
  return { organizationId };
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
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
