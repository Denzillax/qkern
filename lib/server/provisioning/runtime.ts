import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ProjectDatabaseProvisioningService } from "@/lib/server/provisioning/service";
import {
  MemoryProjectDatabaseProvisioningService,
  PostgresProjectDatabaseProvisioningService,
} from "@/lib/server/provisioning/services";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

export function createProjectDatabaseProvisioningService(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { pool?: SqlPool } = {},
): ProjectDatabaseProvisioningService {
  if (runtimeModeFromEnv(env) === "memory") return new MemoryProjectDatabaseProvisioningService();
  return new PostgresProjectDatabaseProvisioningService(
    new PostgresControlPlane(dependencies.pool ?? getPostgresPool(env)),
  );
}

type GlobalProvisioningRuntime = typeof globalThis & {
  __qkernProjectDatabaseProvisioningService?: ProjectDatabaseProvisioningService;
};
const runtime = globalThis as GlobalProvisioningRuntime;
export const projectDatabaseProvisioningService = runtime.__qkernProjectDatabaseProvisioningService ??
  createProjectDatabaseProvisioningService();
if (process.env.NODE_ENV !== "production") {
  runtime.__qkernProjectDatabaseProvisioningService = projectDatabaseProvisioningService;
}
