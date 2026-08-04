import { ConfigurationError } from "@/lib/server/db/errors";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import {
  DisabledProjectDataPlane,
  ProjectDataPlaneService,
  type ProjectDataPlaneContext,
  type ProjectDataPlanePort,
  type ProjectDataPlaneScope,
  type ProjectDataPlaneTargetResolver,
} from "@/lib/server/data-plane/service";
import { createLocalProjectDatabaseCatalogFromEnv } from
  "@/lib/server/migrations/connection-catalog-env";
import type { ProjectDatabaseConnectionResolver } from
  "@/lib/server/migrations/postgres-executor";

export class ControlPlaneDataTargetResolver implements ProjectDataPlaneTargetResolver {
  constructor(private readonly controlPlane: ControlPlaneService) {}

  resolveTarget(context: ProjectDataPlaneContext, scope: ProjectDataPlaneScope) {
    return this.controlPlane.getProjectDatabaseTarget({
      organizationId: context.organizationId,
      actor: { ref: context.actorRef },
    }, scope.projectId, scope.environment);
  }
}

export async function createProjectDataPlaneFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    controlPlane?: ControlPlaneService;
    connections?: ProjectDatabaseConnectionResolver;
    targets?: ProjectDataPlaneTargetResolver;
  } = {},
): Promise<ProjectDataPlanePort> {
  if (env.QKERN_DATA_PLANE_ENABLED !== "true") return new DisabledProjectDataPlane();
  const targets = dependencies.targets ?? new ControlPlaneDataTargetResolver(
    dependencies.controlPlane ?? controlPlaneService,
  );
  if (dependencies.connections) {
    return new ProjectDataPlaneService(targets, dependencies.connections);
  }
  if (env.NODE_ENV === "production") {
    throw new ConfigurationError(
      "Production data-plane reads require an injected dedicated read-role catalog.",
    );
  }
  const catalog = await createLocalProjectDatabaseCatalogFromEnv(env);
  return new ProjectDataPlaneService(targets, catalog);
}

type GlobalDataPlane = typeof globalThis & {
  __qkernProjectDataPlanePromise?: Promise<ProjectDataPlanePort>;
};

export function getProjectDataPlane(): Promise<ProjectDataPlanePort> {
  const globalDataPlane = globalThis as GlobalDataPlane;
  globalDataPlane.__qkernProjectDataPlanePromise ??= createProjectDataPlaneFromEnv();
  return globalDataPlane.__qkernProjectDataPlanePromise;
}
