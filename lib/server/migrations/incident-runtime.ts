import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { MigrationIncidentService } from "@/lib/server/migrations/incident-service";
import {
  MemoryMigrationIncidentService,
  PostgresMigrationIncidentService,
} from "@/lib/server/migrations/incident-services";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

export function createMigrationIncidentService(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { pool?: SqlPool } = {},
): MigrationIncidentService {
  if (runtimeModeFromEnv(env) === "memory") return new MemoryMigrationIncidentService();
  return new PostgresMigrationIncidentService(new PostgresControlPlane(dependencies.pool ?? getPostgresPool(env)));
}

type GlobalIncidentRuntime = typeof globalThis & { __qkernMigrationIncidentService?: MigrationIncidentService };
const globalIncidentRuntime = globalThis as GlobalIncidentRuntime;
export const migrationIncidentService = globalIncidentRuntime.__qkernMigrationIncidentService ?? createMigrationIncidentService();
if (process.env.NODE_ENV !== "production") globalIncidentRuntime.__qkernMigrationIncidentService = migrationIncidentService;
