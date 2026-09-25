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

export async function getProjectDataPlane(): Promise<ProjectDataPlanePort> {
  const globalDataPlane = globalThis as GlobalDataPlane;
  if (globalDataPlane.__qkernProjectDataPlanePromise) {
    const remembered = await globalDataPlane.__qkernProjectDataPlanePromise;
    // Eine gemerkte abgeschaltete Instanz aus einem frueheren Modulgraphen wird
    // verworfen, am Namen erkannt, weil `instanceof` sie nicht mehr kennt.
    if (remembered.constructor.name !== "DisabledProjectDataPlane") return remembered;
    delete globalDataPlane.__qkernProjectDataPlanePromise;
  }
  const created = createProjectDataPlaneFromEnv();
  const plane = await created;
  // Der abgeschaltete Plane haelt keinen Zustand und wird nicht gemerkt (2.24):
  // im Dev-Modus ueberlebt `globalThis` das Neuladen der Module, und eine
  // gemerkte Instanz kennt die Methoden nicht, die seither dazukamen
  // ("service.inspectRoles is not a function", 500 statt 503). Nur der echte
  // Dienst mit seinen Pools wird gemerkt.
  if (plane instanceof DisabledProjectDataPlane) return plane;
  globalDataPlane.__qkernProjectDataPlanePromise = created;
  return plane;
}
