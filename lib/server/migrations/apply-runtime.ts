import type { ChangeSetApplyService } from "@/lib/server/migrations/apply-service";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import { MemoryChangeSetApplyService, PostgresChangeSetApplyService } from "@/lib/server/migrations/services";
import { createProductionApplyAuthorizerFromEnv } from
  "@/lib/server/migrations/production-apply-authorization-runtime";

export function createChangeSetApplyService(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { pool?: SqlPool; controlPlane?: typeof controlPlaneService } = {},
): ChangeSetApplyService {
  if (runtimeModeFromEnv(env) === "memory") {
    return new MemoryChangeSetApplyService(dependencies.controlPlane ?? controlPlaneService);
  }
  return new PostgresChangeSetApplyService(
    new PostgresControlPlane(dependencies.pool ?? getPostgresPool(env)),
    createProductionApplyAuthorizerFromEnv(env),
  );
}

type GlobalApplyRuntime = typeof globalThis & { __qkernChangeSetApplyService?: ChangeSetApplyService };
const globalApplyRuntime = globalThis as GlobalApplyRuntime;
export const changeSetApplyService = globalApplyRuntime.__qkernChangeSetApplyService ?? createChangeSetApplyService();
if (process.env.NODE_ENV !== "production") globalApplyRuntime.__qkernChangeSetApplyService = changeSetApplyService;
