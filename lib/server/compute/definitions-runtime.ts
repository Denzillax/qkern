import { randomUUID } from "node:crypto";
import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import {
  ComputeDefinitionService,
  type ComputeDefinitionScope,
  type ComputeQueueDirectory,
} from "@/lib/server/compute/definitions";
import { PostgresComputeDefinitionRepository } from
  "@/lib/server/compute/definitions-postgres-repository";
import { DatabaseWebhookService } from "@/lib/server/compute/database-webhook-definitions";
import { PostgresDatabaseWebhookRepository } from
  "@/lib/server/compute/database-webhook-postgres-repository";
import { PostgresDatabaseWebhookCursorRepository } from
  "@/lib/server/compute/database-webhook-cursor-postgres-repository";
import { LogDrainService } from "@/lib/server/compute/log-drains";
import { PostgresLogDrainRepository } from "@/lib/server/compute/log-drain-postgres-repository";
import { PostgresLogDrainCursorRepository } from
  "@/lib/server/compute/log-drain-cursor-postgres-repository";
import { DashboardWebhookService } from "@/lib/server/compute/dashboard-webhooks";
import { PostgresDashboardWebhookRepository } from
  "@/lib/server/compute/dashboard-webhook-postgres-repository";
import { PostgresDashboardWebhookCursorRepository } from
  "@/lib/server/compute/dashboard-webhook-cursor-postgres-repository";
import { PostgresFunctionConcurrency } from "@/lib/server/compute/function-concurrency";
import { MediatedFunctionEgress } from "@/lib/server/compute/function-egress";
import { DockerFunctionSandbox } from "@/lib/server/compute/function-sandbox-docker";
import { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import { FunctionInvoker } from "@/lib/server/compute/functions";
import { createProjectQueueServiceFromEnv } from "@/lib/server/project-queues/runtime";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import { createUsageEmitterFromEnv } from "@/lib/server/usage/runtime";

/**
 * Bindet die Cron-Zielqueue an die tatsächlich vorhandenen Queues.
 *
 * Ohne diese Prüfung entstünde ein Zeitplan, der bei jedem Vorkommen scheitert
 * und dabei aussieht, als liefe er — der Scheduler zählt den Fehlschlag, aber
 * die Definition steht unverändert als „aktiv" in der Liste.
 */
class ProjectQueueDirectory implements ComputeQueueDirectory {
  constructor(private readonly queues: {
    listQueues(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope):
      Promise<ReadonlyArray<{ name: string }>>;
  }) {}

  async queueNames(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    return (await this.queues.listQueues(principal, scope)).map((queue) => queue.name);
  }
}

export function createComputeDefinitionServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.QKERN_COMPUTE_DEFINITIONS_ENABLED !== "true") {
    throw new ConfigurationError("Set QKERN_COMPUTE_DEFINITIONS_ENABLED=true explicitly.");
  }
  // Es gibt bewusst keinen Memory-Port. Definitionen, die ein Neustart verliert,
  // waeren fuer einen Zeitplan oder ein Zustellziel wertlos.
  if (runtimeModeFromEnv(env) !== "postgres") {
    throw new ConfigurationError("Compute definitions require the PostgreSQL runtime mode.");
  }
  // Ohne Queues gibt es keine Cron-Ziele. Der Dienst laeuft dann weiter, prueft
  // die Zielqueue aber nicht mehr — ein stiller Rueckschritt, deshalb wird
  // stattdessen abgewiesen.
  const queues = createProjectQueueServiceFromEnv(env);
  return new ComputeDefinitionService({
    repository: new PostgresComputeDefinitionRepository(new PostgresControlPlane(getPostgresPool(env))),
    queues: new ProjectQueueDirectory(queues),
  });
}

/**
 * Aufrufweg für Functions.
 *
 * Getrennt freizuschalten: Definitionen zu verwalten ist eine
 * Verwaltungsentscheidung, fremden Code auszuführen eine ganz andere. Ohne
 * Container-Laufzeit soll die Verwaltungsfläche trotzdem benutzbar bleiben.
 */
export function createFunctionInvocationServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.QKERN_FUNCTIONS_ENABLED !== "true") {
    throw new ConfigurationError("Set QKERN_FUNCTIONS_ENABLED=true explicitly.");
  }
  if (runtimeModeFromEnv(env) !== "postgres") {
    throw new ConfigurationError("Function invocation requires the PostgreSQL runtime mode.");
  }
  return new FunctionInvocationService({
    repository: new PostgresComputeDefinitionRepository(
      new PostgresControlPlane(getPostgresPool(env)),
    ),
    usage: createUsageEmitterFromEnv("compute", env),
    // Geteilt statt prozesslokal. Ohne diesen Port waere die tatsaechliche
    // Obergrenze `maxConcurrency × Instanzen`.
    concurrency: new PostgresFunctionConcurrency(
      new PostgresControlPlane(getPostgresPool(env)),
      `instance:${randomUUID()}`,
    ),
    invoker: new FunctionInvoker(new DockerFunctionSandbox({
      docker: env.QKERN_FUNCTIONS_CONTAINER_RUNTIME?.trim() || "docker",
      // Ohne Vermittler wird eine Definition mit erlaubten Origins abgewiesen.
      // Der Container bekommt in keinem Fall ein Netz; die Verbindung stellt
      // dieser Prozess her, und er prueft dabei die Allowlist.
      egress: new MediatedFunctionEgress({
        maxRequests: integer(env.QKERN_FUNCTIONS_EGRESS_MAX_REQUESTS, 10),
        timeoutMs: integer(env.QKERN_FUNCTIONS_EGRESS_TIMEOUT_MS, 10_000),
      }),
    })),
  });
}

function integer(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new ConfigurationError("A function egress setting must be an integer.");
  }
  return value;
}

/**
 * Datenbank-Webhooks (2.50).
 *
 * Dieselbe Freischaltung wie die uebrigen Definitionen: Wer die
 * Verwaltungsflaeche fuer Cron und Webhooks nicht hat, soll auch diese nicht
 * haben. Ein eigener Schalter waere eine zweite Stelle, an der jemand eine
 * Flaeche ohne Absicht aufmacht.
 */
export function createDatabaseWebhookServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.QKERN_COMPUTE_DEFINITIONS_ENABLED !== "true") {
    throw new ConfigurationError("Set QKERN_COMPUTE_DEFINITIONS_ENABLED=true explicitly.");
  }
  if (runtimeModeFromEnv(env) !== "postgres") {
    throw new ConfigurationError("Database webhooks require the PostgreSQL runtime mode.");
  }
  const controlPlane = new PostgresControlPlane(getPostgresPool(env));
  return new DatabaseWebhookService({
    repository: new PostgresDatabaseWebhookRepository(controlPlane),
    // Der Stand der Bruecke (2.53). Er steht in der Control Plane, seit der
    // Compute-Prozess die Bruecke wirklich betreibt; ohne den Prozess bleibt
    // die Zeile leer, und die Ansicht sagt genau das.
    bridge: new PostgresDatabaseWebhookCursorRepository(controlPlane),
  });
}

/**
 * Log-Drains (2.54).
 *
 * Dieselbe Freischaltung wie die uebrigen Definitionen, aus demselben Grund wie
 * bei den Datenbank-Webhooks: Wer die Verwaltungsflaeche fuer Cron und Webhooks
 * nicht hat, soll auch diese nicht haben. Ein eigener Schalter waere eine zweite
 * Stelle, an der jemand eine Flaeche ohne Absicht aufmacht.
 */
export function createLogDrainServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.QKERN_COMPUTE_DEFINITIONS_ENABLED !== "true") {
    throw new ConfigurationError("Set QKERN_COMPUTE_DEFINITIONS_ENABLED=true explicitly.");
  }
  if (runtimeModeFromEnv(env) !== "postgres") {
    throw new ConfigurationError("Log drains require the PostgreSQL runtime mode.");
  }
  const controlPlane = new PostgresControlPlane(getPostgresPool(env));
  return new LogDrainService({
    repository: new PostgresLogDrainRepository(controlPlane),
    // Der Stand des Sammlers (2.64). Er steht in der Control Plane, seit der
    // Compute-Prozess den Sammler wirklich betreibt; ohne den Prozess bleibt
    // die Liste leer, und die Ansicht sagt genau das.
    collector: new PostgresLogDrainCursorRepository(controlPlane),
  });
}

/**
 * Dashboard-Webhooks (2.75).
 *
 * Dieselbe Freischaltung wie die uebrigen Definitionen, aus demselben Grund wie
 * bei den Log-Drains: Wer die Verwaltungsflaeche fuer Cron und Webhooks nicht
 * hat, soll auch diese nicht haben. Ein eigener Schalter waere eine zweite
 * Stelle, an der jemand eine Flaeche ohne Absicht aufmacht.
 */
export function createDashboardWebhookServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.QKERN_COMPUTE_DEFINITIONS_ENABLED !== "true") {
    throw new ConfigurationError("Set QKERN_COMPUTE_DEFINITIONS_ENABLED=true explicitly.");
  }
  if (runtimeModeFromEnv(env) !== "postgres") {
    throw new ConfigurationError("Dashboard webhooks require the PostgreSQL runtime mode.");
  }
  const controlPlane = new PostgresControlPlane(getPostgresPool(env));
  return new DashboardWebhookService({
    repository: new PostgresDashboardWebhookRepository(controlPlane),
    // Der Stand des Sammlers. Er steht in der Control Plane, weil der
    // Compute-Prozess den Sammler betreibt; ohne den Prozess bleibt die Liste
    // leer, und die Ansicht sagt genau das.
    collector: new PostgresDashboardWebhookCursorRepository(controlPlane),
  });
}

type GlobalComputeDefinitions = typeof globalThis & {
  __qkernComputeDefinitionService?: ComputeDefinitionService;
  __qkernFunctionInvocationService?: FunctionInvocationService;
  __qkernDatabaseWebhookService?: DatabaseWebhookService;
  __qkernLogDrainService?: LogDrainService;
  __qkernDashboardWebhookService?: DashboardWebhookService;
};

export function getComputeDefinitionService() {
  const runtime = globalThis as GlobalComputeDefinitions;
  runtime.__qkernComputeDefinitionService ??= createComputeDefinitionServiceFromEnv();
  return runtime.__qkernComputeDefinitionService;
}

export function getFunctionInvocationService() {
  const runtime = globalThis as GlobalComputeDefinitions;
  runtime.__qkernFunctionInvocationService ??= createFunctionInvocationServiceFromEnv();
  return runtime.__qkernFunctionInvocationService;
}

export function getDatabaseWebhookService() {
  const runtime = globalThis as GlobalComputeDefinitions;
  runtime.__qkernDatabaseWebhookService ??= createDatabaseWebhookServiceFromEnv();
  return runtime.__qkernDatabaseWebhookService;
}

export function getLogDrainService() {
  const runtime = globalThis as GlobalComputeDefinitions;
  runtime.__qkernLogDrainService ??= createLogDrainServiceFromEnv();
  return runtime.__qkernLogDrainService;
}

export function getDashboardWebhookService() {
  const runtime = globalThis as GlobalComputeDefinitions;
  runtime.__qkernDashboardWebhookService ??= createDashboardWebhookServiceFromEnv();
  return runtime.__qkernDashboardWebhookService;
}
