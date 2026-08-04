import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { MemoryProjectQueueRepository, type ProjectQueueRepository } from "@/lib/server/project-queues/repository";
import { ProjectQueueError, ProjectQueueService } from "@/lib/server/project-queues/service";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

export function createProjectQueueServiceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { repository?: ProjectQueueRepository } = {},
) {
  if (env.QKERN_PROJECT_QUEUES_ENABLED !== "true") throw new ProjectQueueError("PROJECT_QUEUES_DISABLED");
  validateOrigins(env);
  const repository = dependencies.repository ?? (runtimeModeFromEnv(env) === "postgres"
    ? new PostgresProjectQueueRepository(new PostgresControlPlane(getPostgresPool(env)))
    : new MemoryProjectQueueRepository());
  if (env.NODE_ENV === "production" && repository.durability !== "durable") {
    throw new ConfigurationError("Production Project Queues require an injected durable broker repository.");
  }
  return new ProjectQueueService({
    repository,
    controlPlane: controlPlaneService,
    maxPayloadBytes: integer(env.QKERN_PROJECT_QUEUES_MAX_PAYLOAD_BYTES, 64 * 1024, 256, 256 * 1024),
  });
}

function validateOrigins(env: Readonly<Record<string, string | undefined>>) {
  const entries = env.QKERN_PROJECT_QUEUES_ALLOWED_ORIGINS?.split(",")
    .map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (entries.length > 20 || new Set(entries).size !== entries.length) {
    throw new ConfigurationError("Invalid Project Queues allowed origins.");
  }
  for (const entry of entries) {
    try {
      const url = new URL(entry);
      const localHttp = env.NODE_ENV !== "production" && url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname);
      if ((url.protocol !== "https:" && !localHttp) || url.origin !== entry || url.username || url.password) {
        throw new Error("invalid");
      }
    } catch { throw new ConfigurationError("Project Queues allowed origins must be exact HTTPS origins."); }
  }
}

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigurationError("Invalid Project Queues numeric setting.");
  }
  return parsed;
}

type GlobalProjectQueues = typeof globalThis & { __qkernProjectQueueService?: ProjectQueueService };

export function getProjectQueueService() {
  const runtime = globalThis as GlobalProjectQueues;
  runtime.__qkernProjectQueueService ??= createProjectQueueServiceFromEnv();
  return runtime.__qkernProjectQueueService;
}
