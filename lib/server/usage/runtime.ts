import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import { PostgresUsageRepository } from "@/lib/server/usage/postgres-repository";
import { MemoryUsageRepository, type UsageRepository } from "@/lib/server/usage/repository";
import { UsageError, UsageService } from "@/lib/server/usage/service";

export function createUsageServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { repository?: UsageRepository } = {},
) {
  if (env.QKERN_USAGE_METERING_ENABLED !== "true") throw new UsageError("USAGE_METERING_DISABLED");
  const repository = dependencies.repository ?? (runtimeModeFromEnv(env) === "postgres"
    ? new PostgresUsageRepository(new PostgresControlPlane(getPostgresPool(env)))
    : new MemoryUsageRepository());
  if (env.NODE_ENV === "production" && repository.durability !== "durable") {
    throw new ConfigurationError("Production Usage Metering requires the durable PostgreSQL repository.");
  }
  return new UsageService({ repository, controlPlane: controlPlaneService });
}

type GlobalUsage = typeof globalThis & { __qkernUsageService?: UsageService };

export function getUsageService() {
  const runtime = globalThis as GlobalUsage;
  runtime.__qkernUsageService ??= createUsageServiceFromEnv();
  return runtime.__qkernUsageService;
}
