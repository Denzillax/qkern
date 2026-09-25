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
    try {
      const remembered = await globalDataPlane.__qkernProjectDataPlanePromise;
      // Eine gemerkte abgeschaltete Instanz aus einem frueheren Modulgraphen
      // wird verworfen, am Literal `kind` erkannt (2.24, seit 2.28 nicht mehr
      // am Klassennamen, den ein Bundle kuerzen darf).
      if ((remembered as { kind?: string }).kind !== "disabled") return remembered;
    } catch {
      // Ein gemerktes, abgelehntes Versprechen darf nicht jede Anfrage bis
      // zum Neustart scheitern lassen (Review 2.28).
    }
    delete globalDataPlane.__qkernProjectDataPlanePromise;
  }
  // Sofort merken, nicht erst nach dem await: sonst bauen N gleichzeitige
  // erste Anfragen N Dienste mit eigenen Pools, und N-1 werden nie
  // geschlossen (Review 2.28). Ein abgeschalteter Plane haelt keinen Zustand
  // und wird wieder vergessen, damit ein Neuladen die aktuelle Klasse liefert.
  const created = createProjectDataPlaneFromEnv();
  globalDataPlane.__qkernProjectDataPlanePromise = created;
  try {
    const plane = await created;
    if ((plane as { kind?: string }).kind === "disabled") delete globalDataPlane.__qkernProjectDataPlanePromise;
    return plane;
  } catch (error) {
    delete globalDataPlane.__qkernProjectDataPlanePromise;
    throw error;
  }
}
