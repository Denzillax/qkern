import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { statementCipherFromEnv, type StatementCipher } from "@/lib/server/control-plane/crypto";
import { MemoryControlPlaneService } from "@/lib/server/control-plane/memory";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import { PostgresControlPlaneService } from "@/lib/server/control-plane/postgres";
import type { SqlPool } from "@/lib/server/db/sql";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

export type ControlPlaneAdapter = "memory" | "postgres";

export type ControlPlaneRuntimeDependencies = {
  pool?: SqlPool;
  cipher?: StatementCipher;
};

export function controlPlaneAdapterFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ControlPlaneAdapter {
  const adapter = runtimeModeFromEnv(env);
  if (adapter === "postgres" && !env.QKERN_RUNTIME_DATABASE_URL?.trim()) {
    throw new ConfigurationError("QKERN_RUNTIME_DATABASE_URL is required when QKERN_RUNTIME_MODE=postgres.");
  }
  return adapter;
}

export function createControlPlaneService(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: ControlPlaneRuntimeDependencies = {},
): ControlPlaneService {
  const adapter = controlPlaneAdapterFromEnv(env);
  if (adapter === "memory") return new MemoryControlPlaneService();
  const pool = dependencies.pool ?? getPostgresPool(env);
  const cipher = dependencies.cipher ?? statementCipherFromEnv(env);
  return new PostgresControlPlaneService(new PostgresControlPlane(pool), cipher);
}

type GlobalControlPlane = typeof globalThis & { __qkernControlPlaneService?: ControlPlaneService };
const globalControlPlane = globalThis as GlobalControlPlane;
export const controlPlaneService = globalControlPlane.__qkernControlPlaneService ?? createControlPlaneService();
if (process.env.NODE_ENV !== "production") globalControlPlane.__qkernControlPlaneService = controlPlaneService;
