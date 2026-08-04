import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { getAuthPostgresPool, getPostgresPool } from "@/lib/server/db/pool";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import {
  MemoryProjectApiKeyStore,
  PostgresProjectApiKeyStore,
  PostgresProjectApiKeyVerifier,
  ProjectApiKeyService,
} from "@/lib/server/project-api-keys/service";

export function createProjectApiKeyService(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectApiKeyService {
  if (runtimeModeFromEnv(env) === "memory") {
    const store = new MemoryProjectApiKeyStore();
    return new ProjectApiKeyService(controlPlaneService, store, store);
  }
  const store = new PostgresProjectApiKeyStore(new PostgresControlPlane(getPostgresPool(env)));
  const verifier = new PostgresProjectApiKeyVerifier(getAuthPostgresPool(env));
  return new ProjectApiKeyService(controlPlaneService, store, verifier);
}

type GlobalProjectApiKeys = typeof globalThis & { __qkernProjectApiKeys?: ProjectApiKeyService };
const runtime = globalThis as GlobalProjectApiKeys;
export const projectApiKeyService = runtime.__qkernProjectApiKeys ?? createProjectApiKeyService();
if (process.env.NODE_ENV !== "production") runtime.__qkernProjectApiKeys = projectApiKeyService;
