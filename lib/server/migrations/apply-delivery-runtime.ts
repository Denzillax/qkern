import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { MigrationApplyDeliveryService } from "@/lib/server/migrations/apply-delivery-service";
import {
  MemoryMigrationApplyDeliveryService,
  PostgresMigrationApplyDeliveryService,
} from "@/lib/server/migrations/apply-delivery-services";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

export function createMigrationApplyDeliveryService(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { pool?: SqlPool } = {},
): MigrationApplyDeliveryService {
  if (runtimeModeFromEnv(env) === "memory") return new MemoryMigrationApplyDeliveryService();
  return new PostgresMigrationApplyDeliveryService(
    new PostgresControlPlane(dependencies.pool ?? getPostgresPool(env)),
  );
}

type GlobalApplyDeliveryRuntime = typeof globalThis & {
  __qkernMigrationApplyDeliveryService?: MigrationApplyDeliveryService;
};
const globalApplyDeliveryRuntime = globalThis as GlobalApplyDeliveryRuntime;
export const migrationApplyDeliveryService = globalApplyDeliveryRuntime.__qkernMigrationApplyDeliveryService ??
  createMigrationApplyDeliveryService();
if (process.env.NODE_ENV !== "production") {
  globalApplyDeliveryRuntime.__qkernMigrationApplyDeliveryService = migrationApplyDeliveryService;
}
