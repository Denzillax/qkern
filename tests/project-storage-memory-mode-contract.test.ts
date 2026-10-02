import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectStorageBucket } from "@/lib/server/project-storage/model";
import { getMemoryProjectStorageRepository } from "@/lib/server/project-storage/repository";
import { createProjectStorageServiceFromEnv } from "@/lib/server/project-storage/runtime";
import { createProjectStorageS3AccessKeyService } from "@/lib/server/project-storage/s3-access-keys-runtime";

/**
 * Der Modus `memory` teilt seine Bucket-Ablage (2.127).
 *
 * **Der Befund.** `createProjectStorageServiceFromEnv` und
 * `createProjectStorageS3AccessKeyService` bauten sich im Modus `memory` je eine
 * eigene `MemoryProjectStorageRepository`. Die Maps liegen in der Instanz, also
 * sah der Schluesseldienst von einem Bucket des Storage-Dienstes nichts:
 * `listBuckets` gab eine leere Liste, und ein Paar fuer diesen Bucket fiel mit
 * `STORAGE_RESOURCE_NOT_FOUND`. Der S3-Endpunkt war im Modus der
 * Entwicklungsumgebung damit nicht benutzbar. Gefunden hat das der Schnitt, der
 * die AWS CLI in den Stack geholt hat: Er konnte den Endpunkt nicht ueber einen
 * Next-Server fahren, weil sich dort gar kein Paar ausstellen laesst.
 *
 * **Warum ein Vertrag und keine einmalige Korrektur.** Die naechste Fabrik, die
 * eine Bucket-Ablage braucht, wird aus einer dieser beiden kopiert, und ein
 * `new MemoryProjectStorageRepository()` sieht an jeder Stelle richtig aus.
 *
 * **Warum der Bucket hier direkt in die Ablage geschrieben wird.** Ueber
 * `service.createBucket` ginge es nicht: Der Weg verlangt ein Projekt und eine
 * Umgebung in der Steuerungsdatenbank, und die gibt es im Modus `memory` nicht.
 * Geprueft werden soll die Verdrahtung der beiden Fabriken, nicht der
 * Anlegeweg; der ist im Storage-Stack belegt.
 *
 * **Was er nicht kann.** Er laeuft im Modus `memory` und sagt nichts ueber
 * `postgres`. Dort teilen beide Dienste die Datenbank, und zwei
 * Repository-Instanzen lesen dieselben Zeilen.
 */
const ENV = {
  QKERN_PROJECT_STORAGE_ENABLED: "true",
  QKERN_RUNTIME_MODE: "memory",
  QKERN_PROJECT_STORAGE_S3_SECRET_KEY: "a".repeat(64),
  NODE_ENV: "test",
} as const;

const SCOPE = {
  organizationId: "org-1",
  projectId: "project-1",
  environment: "development" as const,
};

const PRINCIPAL = {
  organizationId: "org-1",
  actorRef: "storage-owner@qkern.test",
  role: "admin" as const,
  subject: "11111111-1111-4111-8111-111111111111",
};

type GlobalMemoryBuckets = typeof globalThis & {
  __qkernMemoryProjectStorageBuckets?: unknown;
  __qkernProjectStorageS3AccessKeys?: unknown;
};

function clearProcessState(): void {
  const runtime = globalThis as GlobalMemoryBuckets;
  delete runtime.__qkernMemoryProjectStorageBuckets;
  delete runtime.__qkernProjectStorageS3AccessKeys;
}

async function seedBucket(): Promise<ProjectStorageBucket> {
  const now = new Date("2026-10-02T12:00:00.000Z");
  const bucket: ProjectStorageBucket = {
    ...SCOPE,
    id: "22222222-2222-4222-8222-222222222222",
    name: "shots",
    readPolicy: "private",
    writePolicy: "owner",
    allowedMimeTypes: ["image/png"],
    maxObjectBytes: 1024 ** 2,
    quotaBytes: 10 * 1024 ** 2,
    usedBytes: 0,
    reservedBytes: 0,
    retentionDays: null,
    createdAt: now,
    updatedAt: now,
  };
  return getMemoryProjectStorageRepository().createBucket(PRINCIPAL, bucket);
}

beforeEach(clearProcessState);
afterEach(clearProcessState);

describe("project storage memory mode contract", () => {
  it("lets the storage service read the shared bucket ablage", async () => {
    const bucket = await seedBucket();
    const storage = createProjectStorageServiceFromEnv(ENV);

    const listed = await storage.listBuckets(PRINCIPAL, SCOPE);

    expect(listed.map((entry) => entry.id)).toEqual([bucket.id]);
  });

  it("issues an S3 key pair for a bucket of the shared ablage", async () => {
    const bucket = await seedBucket();
    const keys = createProjectStorageS3AccessKeyService(ENV);

    // Genau hier fiel es vorher mit STORAGE_RESOURCE_NOT_FOUND: Der
    // Schluesseldienst sah eine leere Bucket-Liste.
    const pair = await keys.create(PRINCIPAL, SCOPE, {
      name: "cli",
      bucketIds: [bucket.id],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(pair.key.bucketIds).toEqual([bucket.id]);
    const listed = await keys.list(PRINCIPAL, SCOPE);
    expect(listed.map((entry) => entry.id)).toContain(pair.key.id);
  });
});
