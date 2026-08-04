import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { MigrationReviewService } from "@/lib/server/migrations/review-service";
import {
  MemoryMigrationReviewService,
  PostgresMigrationReviewService,
} from "@/lib/server/migrations/review-services";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

export function createMigrationReviewService(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { pool?: SqlPool } = {},
): MigrationReviewService {
  if (runtimeModeFromEnv(env) === "memory") return new MemoryMigrationReviewService();
  return new PostgresMigrationReviewService(new PostgresControlPlane(dependencies.pool ?? getPostgresPool(env)));
}

type GlobalReviewRuntime = typeof globalThis & { __qkernMigrationReviewService?: MigrationReviewService };
const globalReviewRuntime = globalThis as GlobalReviewRuntime;
export const migrationReviewService = globalReviewRuntime.__qkernMigrationReviewService ?? createMigrationReviewService();
if (process.env.NODE_ENV !== "production") globalReviewRuntime.__qkernMigrationReviewService = migrationReviewService;
