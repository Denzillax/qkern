import { ConfigurationError } from "@/lib/server/db/errors";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import {
  DisabledGeneratedDataApi,
  GeneratedDataApiService,
  type GeneratedDataApiPort,
} from "@/lib/server/data-plane/generated-api";
import { ControlPlaneDataTargetResolver } from "@/lib/server/data-plane/runtime";
import { createLocalProjectDatabaseCatalogFromEnv } from
  "@/lib/server/migrations/connection-catalog-env";
import type { ProjectDatabaseConnectionResolver } from
  "@/lib/server/migrations/postgres-executor";
import type { ProjectDataPlaneTargetResolver } from "@/lib/server/data-plane/service";

export async function createGeneratedDataApiFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: {
    controlPlane?: ControlPlaneService;
    connections?: ProjectDatabaseConnectionResolver;
    targets?: ProjectDataPlaneTargetResolver;
  } = {},
): Promise<GeneratedDataApiPort> {
  if (env.QKERN_GENERATED_DATA_API_ENABLED !== "true") return new DisabledGeneratedDataApi();
  const targets = dependencies.targets ?? new ControlPlaneDataTargetResolver(
    dependencies.controlPlane ?? controlPlaneService,
  );
  if (dependencies.connections) return new GeneratedDataApiService(targets, dependencies.connections);
  if (env.NODE_ENV === "production") {
    throw new ConfigurationError(
      "Production generated data writes require an injected dedicated project API-role catalog.",
    );
  }
  const catalog = await createLocalProjectDatabaseCatalogFromEnv(env, undefined, {
    allowFlag: "QKERN_ALLOW_LOCAL_PROJECT_DATA_API_CATALOG",
    catalogVariable: "QKERN_LOCAL_PROJECT_DATA_API_CATALOG_JSON",
    applicationName: "qkern-local-generated-data-api",
  });
  return new GeneratedDataApiService(targets, catalog);
}

type GlobalGeneratedDataApi = typeof globalThis & {
  __qkernGeneratedDataApiPromise?: Promise<GeneratedDataApiPort>;
};

export function getGeneratedDataApi(): Promise<GeneratedDataApiPort> {
  const runtime = globalThis as GlobalGeneratedDataApi;
  runtime.__qkernGeneratedDataApiPromise ??= createGeneratedDataApiFromEnv();
  return runtime.__qkernGeneratedDataApiPromise;
}
