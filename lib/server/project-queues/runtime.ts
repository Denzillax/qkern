import { ConfigurationError } from "@/lib/server/db/errors";
import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { controlPlaneService } from "@/lib/server/control-plane/runtime";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { MemoryProjectQueueRepository, type ProjectQueueRepository } from "@/lib/server/project-queues/repository";
import { ProjectQueueError, ProjectQueueService, isProjectQueueError } from "@/lib/server/project-queues/service";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import { createUsageEmitterFromEnv } from "@/lib/server/usage/runtime";

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
    usage: createUsageEmitterFromEnv("project_queues", env),
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

/**
 * Ein abgeschalteter Dienst, der bei jedem Aufruf `PROJECT_QUEUES_DISABLED`
 * wirft (2.24). Bis dahin warf schon `getProjectQueueService()` beim Anlegen,
 * und zwar in jeder der elf Routen vor dem `try`: Next antwortete 500 ohne
 * Koerper statt 503 "Project Queues are disabled". Jetzt fliegt der Fehler
 * erst im Handler, wo `projectQueueRouteError` ihn abbildet.
 */
function disabledProjectQueueService(): ProjectQueueService {
  return new Proxy({} as ProjectQueueService, {
    get: (_target, property) => property === "then" ? undefined : () => { throw new ProjectQueueError("PROJECT_QUEUES_DISABLED"); },
  });
}

export function getProjectQueueService() {
  const runtime = globalThis as GlobalProjectQueues;
  if (!runtime.__qkernProjectQueueService) {
    try {
      runtime.__qkernProjectQueueService = createProjectQueueServiceFromEnv();
    } catch (error) {
      if (!isProjectQueueError(error, "PROJECT_QUEUES_DISABLED")) throw error;
      // Nicht merken: schaltet die Umgebung die Queues spaeter ein, soll der naechste Aufruf sie sehen.
      return disabledProjectQueueService();
    }
  }
  return runtime.__qkernProjectQueueService;
}
