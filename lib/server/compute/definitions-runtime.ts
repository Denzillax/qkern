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

type GlobalComputeDefinitions = typeof globalThis & {
  __qkernComputeDefinitionService?: ComputeDefinitionService;
  __qkernFunctionInvocationService?: FunctionInvocationService;
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
