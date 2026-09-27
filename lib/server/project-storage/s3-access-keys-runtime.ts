import { getPostgresPool } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PostgresProjectStorageRepository } from "@/lib/server/project-storage/postgres-repository";
import { MemoryProjectStorageRepository } from "@/lib/server/project-storage/repository";
import {
  MemoryProjectStorageS3AccessKeyStore,
  PostgresProjectStorageS3AccessKeyStore,
  ProjectStorageS3AccessKeyService,
} from "@/lib/server/project-storage/s3-access-keys";
import { ProjectStorageError } from "@/lib/server/project-storage/service";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";

/**
 * Der S3-Zugang haengt am Storage-Schalter (2.78). Ein Schluesselpaar fuer
 * Buckets einer Umgebung ohne Storage waere eine Erklaerung ueber nichts, also
 * antwortet die Route dann mit 503, genau wie jeder andere Storage-Weg.
 */
export function createProjectStorageS3AccessKeyService(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectStorageS3AccessKeyService {
  if (env.QKERN_PROJECT_STORAGE_ENABLED !== "true") {
    throw new ProjectStorageError("PROJECT_STORAGE_DISABLED");
  }
  if (runtimeModeFromEnv(env) === "memory") {
    return new ProjectStorageS3AccessKeyService({
      store: new MemoryProjectStorageS3AccessKeyStore(),
      buckets: new MemoryProjectStorageRepository(),
    });
  }
  const control = new PostgresControlPlane(getPostgresPool(env));
  return new ProjectStorageS3AccessKeyService({
    store: new PostgresProjectStorageS3AccessKeyStore(control),
    buckets: new PostgresProjectStorageRepository(control),
  });
}

type GlobalS3AccessKeys = typeof globalThis & {
  __qkernProjectStorageS3AccessKeys?: ProjectStorageS3AccessKeyService;
};

/**
 * Ein abgeschalteter Dienst, der erst im Handler wirft. Dieselbe Bauart wie
 * `disabledProjectStorageService` in runtime.ts und aus demselben Grund: Wuerfe
 * der Aufbau vor dem `try` der Route, antwortete Next 500 ohne Koerper statt
 * 503 mit Grund.
 */
function disabledService(): ProjectStorageS3AccessKeyService {
  return new Proxy({} as ProjectStorageS3AccessKeyService, {
    get: (_target, property) => property === "then"
      ? undefined
      : () => { throw new ProjectStorageError("PROJECT_STORAGE_DISABLED"); },
  });
}

export function getProjectStorageS3AccessKeyService(): ProjectStorageS3AccessKeyService {
  const runtime = globalThis as GlobalS3AccessKeys;
  if (!runtime.__qkernProjectStorageS3AccessKeys) {
    try {
      runtime.__qkernProjectStorageS3AccessKeys = createProjectStorageS3AccessKeyService();
    } catch (error) {
      if (!(error instanceof ProjectStorageError) || error.code !== "PROJECT_STORAGE_DISABLED") throw error;
      // Nicht merken: schaltet die Umgebung Storage spaeter ein, soll der
      // naechste Aufruf es sehen.
      return disabledService();
    }
  }
  return runtime.__qkernProjectStorageS3AccessKeys;
}
