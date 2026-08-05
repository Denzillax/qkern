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
import { createProjectQueueServiceFromEnv } from "@/lib/server/project-queues/runtime";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

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

type GlobalComputeDefinitions = typeof globalThis & {
  __qkernComputeDefinitionService?: ComputeDefinitionService;
};

export function getComputeDefinitionService() {
  const runtime = globalThis as GlobalComputeDefinitions;
  runtime.__qkernComputeDefinitionService ??= createComputeDefinitionServiceFromEnv();
  return runtime.__qkernComputeDefinitionService;
}
