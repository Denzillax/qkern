import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ProjectDatabaseBackupService,
  backupObjectKey,
  identityOf,
  restoreDatabaseName,
  type ProjectDatabaseBackupClaim,
  type ProjectDatabaseBackupDataKeyProtector,
  type ProjectDatabaseBackupErrorCode,
  type ProjectDatabaseBackupObjectStore,
  type ProjectDatabaseBackupRecord,
  type ProjectDatabaseBackupScope,
  type ProjectDatabaseBackupStore,
  type ProjectDatabaseDumpPort,
  type ProjectDatabaseRestoreTargetPort,
} from "@/lib/server/backup/project-database";
import {
  newBackupDataKey,
  openBackupArtifact,
  sealBackupArtifact,
  unwrapBackupDataKey,
  wrapBackupDataKey,
} from "@/lib/server/backup/project-database-artifact";
import {
  firstDifferingManifestPart,
  type ProjectDatabaseManifest,
} from "@/lib/server/backup/project-database-manifest";

/**
 * Die Teile des Projektdatenbank-Backups, die ohne Datenbank pruefbar sind
 * (2.126). Was eine echte Datenbank, einen Vault und einen Objektspeicher
 * braucht, steht im Fall `(2.126)` des Backup-Stacks; hier stehen der Umschlag,
 * die Ableitungen und die Runde des Dienstes gegen eingespeiste Haelften.
 */

const identity = Object.freeze({
  organizationId: "3f1a5f2e-9c4b-4a6d-8e2f-7b1c0d9a5e44",
  projectId: "5c2b7d1e-2a3f-4b5c-9d8e-1f2a3b4c5d6e",
  environment: "production" as const,
  backupId: "7a9b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d",
});

const OBJECT_KEY_SHAPE =
  /^project-database-backups\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(development|staging|production)\/[0-9a-f-]{36}\.qkbak$/;

describe("Der Umschlag um ein Backup", () => {
  it("gibt den Dump genau unter seiner eigenen Kennung zurueck", () => {
    const dataKey = newBackupDataKey();
    const dump = Buffer.from("CREATE TABLE tenant_rows (id integer);\n", "utf8");
    const artifact = sealBackupArtifact({ dump, dataKey, identity });
    expect(artifact.subarray(0, 7).toString("utf8")).toBe("QKBAK1\n");
    expect(artifact.includes("CREATE TABLE")).toBe(false);
    expect(openBackupArtifact({ artifact, dataKey, identity }).equals(dump)).toBe(true);
  });

  it("geht unter der Kennung eines anderen Mandanten nicht auf", () => {
    const dataKey = newBackupDataKey();
    const artifact = sealBackupArtifact({ dump: Buffer.from("x"), dataKey, identity });
    for (const foreign of [
      { ...identity, organizationId: randomUUID() },
      { ...identity, projectId: randomUUID() },
      { ...identity, backupId: randomUUID() },
      { ...identity, environment: "staging" as const },
    ]) {
      expect(() => openBackupArtifact({ artifact, dataKey, identity: foreign }))
        .toThrowError(expect.objectContaining({ code: "ARTIFACT_IDENTITY_MISMATCH" }));
    }
  });

  it("merkt ein gekipptes Byte", () => {
    const dataKey = newBackupDataKey();
    const artifact = sealBackupArtifact({ dump: Buffer.from("hello backup"), dataKey, identity });
    const tampered = Buffer.from(artifact);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => openBackupArtifact({ artifact: tampered, dataKey, identity }))
      .toThrowError(expect.objectContaining({ code: "ARTIFACT_IDENTITY_MISMATCH" }));
    const shortened = artifact.subarray(0, 10);
    expect(() => openBackupArtifact({ artifact: shortened, dataKey, identity }))
      .toThrowError(expect.objectContaining({ code: "ARTIFACT_MALFORMED" }));
  });

  it("wickelt den Datenschluessel so ein, dass Kennung und Schluesselname mitgelten", () => {
    const dataKey = newBackupDataKey();
    const keyEncryptionKey = newBackupDataKey();
    const wrapped = wrapBackupDataKey({ dataKey, keyEncryptionKey, identity, keyId: "tenant-2026-10" });
    expect(wrapped).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(unwrapBackupDataKey({ wrapped, keyEncryptionKey, identity, keyId: "tenant-2026-10" }).equals(dataKey))
      .toBe(true);
    expect(() => unwrapBackupDataKey({ wrapped, keyEncryptionKey, identity, keyId: "tenant-2026-11" }))
      .toThrowError(expect.objectContaining({ code: "DATA_KEY_INVALID" }));
    expect(() => unwrapBackupDataKey({
      wrapped, keyEncryptionKey, keyId: "tenant-2026-10",
      identity: { ...identity, organizationId: randomUUID() },
    })).toThrowError(expect.objectContaining({ code: "DATA_KEY_INVALID" }));
    expect(() => unwrapBackupDataKey({
      wrapped, keyEncryptionKey: newBackupDataKey(), identity, keyId: "tenant-2026-10",
    })).toThrowError(expect.objectContaining({ code: "DATA_KEY_INVALID" }));
  });
});

describe("Die Ableitungen", () => {
  it("baut den Objektschluessel aus der Zeile und in der Form, die 0083 prueft", () => {
    const key = backupObjectKey({
      organizationId: identity.organizationId,
      projectId: identity.projectId,
      environment: "production",
      id: identity.backupId,
    });
    expect(key).toMatch(OBJECT_KEY_SHAPE);
    expect(key.startsWith(`project-database-backups/${identity.organizationId}/`)).toBe(true);
  });

  it("baut einen Datenbanknamen, der in die 63 Byte von PostgreSQL passt", () => {
    const name = restoreDatabaseName(identity.backupId);
    expect(name).toMatch(/^[a-z_][a-z0-9_]{0,62}$/);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).not.toMatch(/^pg_/);
  });

  it("nennt den ersten Teil, der zwischen zwei Manifesten abweicht", () => {
    const base: ProjectDatabaseManifest = {
      parts: { schema: "a", rows: "b", policies: "c", extensions: "d", sequences: "e", grants: "f" },
      sha256: "0".repeat(64), tableCount: 1, rowCount: 1,
    };
    expect(firstDifferingManifestPart(base, base)).toBeNull();
    expect(firstDifferingManifestPart(base, { ...base, parts: { ...base.parts, policies: "z" } }))
      .toBe("policies");
    expect(firstDifferingManifestPart(base, {
      ...base, parts: { ...base.parts, rows: "z", sequences: "z" },
    })).toBe("rows");
  });
});

/** Eine Haelfte des Katalogs im Speicher, mit Lease und Versuchen wie 0083. */
class MemoryBackupStore implements ProjectDatabaseBackupStore {
  readonly records = new Map<string, ProjectDatabaseBackupRecord>();
  private leases = new Map<string, string>();

  constructor(private readonly organizationId: string, private readonly now: () => Date) {}

  async enqueue(scope: ProjectDatabaseBackupScope, databaseInstanceRef: string) {
    const existing = [...this.records.values()].find((record) =>
      record.projectId === scope.projectId && record.environment === scope.environment &&
      (record.status === "pending" || record.status === "running"));
    if (existing) return existing;
    const record: ProjectDatabaseBackupRecord = Object.freeze({
      id: randomUUID(), organizationId: this.organizationId, projectId: scope.projectId,
      environment: scope.environment, databaseInstanceRef, status: "pending",
      objectKey: null, artifactSha256: null, sizeBytes: null, wrappedDataKey: null, keyId: null,
      manifestSha256: null, includes: [], snapshotAt: null, completedAt: null, expiresAt: null,
      attemptCount: 0, maxAttempts: 2, lastErrorCode: null, createdAt: this.now(),
    });
    this.records.set(record.id, record);
    return record;
  }

  async claimNext(workerId: string): Promise<ProjectDatabaseBackupClaim | null> {
    const pending = [...this.records.values()]
      .filter((record) => record.status === "pending")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
    if (!pending) return null;
    const claimed = { ...pending, status: "running" as const, attemptCount: pending.attemptCount + 1 };
    this.records.set(claimed.id, Object.freeze(claimed));
    const leaseToken = randomUUID();
    this.leases.set(claimed.id, leaseToken);
    void workerId;
    return Object.freeze({ record: claimed, leaseToken });
  }

  async releaseExpiredLeases() { return []; }

  async complete(claim: ProjectDatabaseBackupClaim, result: Parameters<ProjectDatabaseBackupStore["complete"]>[1]) {
    if (this.leases.get(claim.record.id) !== claim.leaseToken) throw new Error("lease lost");
    const record = Object.freeze({
      ...this.records.get(claim.record.id)!,
      status: "available" as const, ...result, includes: [...result.includes],
      lastErrorCode: null,
    });
    this.records.set(record.id, record);
    return record;
  }

  async recordFailure(claim: ProjectDatabaseBackupClaim, errorCode: ProjectDatabaseBackupErrorCode) {
    const current = this.records.get(claim.record.id)!;
    const record = Object.freeze({
      ...current,
      status: current.attemptCount >= current.maxAttempts ? "failed" as const : "pending" as const,
      lastErrorCode: errorCode,
    });
    this.records.set(record.id, record);
    return record;
  }

  async get(backupId: string) { return this.records.get(backupId) ?? null; }
  async list() { return [...this.records.values()]; }
  async findExpired(expiredBefore: Date, limit: number) {
    return [...this.records.values()]
      .filter((record) => record.status === "available" && record.expiresAt !== null &&
        record.expiresAt.getTime() < expiredBefore.getTime())
      .slice(0, limit);
  }
  async forget(backupId: string) {
    const current = this.records.get(backupId)!;
    this.records.set(backupId, Object.freeze({
      ...current, status: "expired" as const, objectKey: null, wrappedDataKey: null,
      keyId: null, artifactSha256: null, sizeBytes: null,
    }));
  }
}

class MemoryObjects implements ProjectDatabaseBackupObjectStore {
  readonly objects = new Map<string, Buffer>();
  readonly order: string[] = [];
  async put(key: string, bytes: Buffer) { this.objects.set(key, bytes); this.order.push(`put ${key}`); }
  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw Object.assign(new Error("missing"), { code: "OBJECT_NOT_FOUND" });
    return bytes;
  }
  async delete(key: string) { this.objects.delete(key); this.order.push(`delete ${key}`); }
}

const protector: ProjectDatabaseBackupDataKeyProtector = {
  async wrap(input) {
    return { keyId: "memory-kek", wrapped: wrapBackupDataKey({
      dataKey: input.dataKey, keyEncryptionKey: Buffer.alloc(32, 7),
      identity: input.identity, keyId: "memory-kek",
    }) };
  },
  async unwrap(input) {
    return unwrapBackupDataKey({
      wrapped: input.wrapped, keyEncryptionKey: Buffer.alloc(32, 7),
      identity: input.identity, keyId: input.keyId,
    });
  },
};

const manifest: ProjectDatabaseManifest = Object.freeze({
  parts: Object.freeze({
    schema: "1".repeat(64), rows: "2".repeat(64), policies: "3".repeat(64),
    extensions: "4".repeat(64), sequences: "5".repeat(64), grants: "6".repeat(64),
  }),
  sha256: "a".repeat(64), tableCount: 3, rowCount: 10,
});

function dumpPort(options: { fail?: boolean } = {}): ProjectDatabaseDumpPort {
  return {
    async dump() {
      if (options.fail) throw Object.assign(new Error("no"), { code: "DUMP_FAILED" });
      return Buffer.from("-- dump\nCREATE TABLE t (id integer);\n", "utf8");
    },
    async withReader(_input, operation) {
      return operation({ query: async () => ({ rows: [], rowCount: 0 }) }) as never;
    },
  };
}

/** Der Leser des Manifests wird im Dienst ueber `withReader` aufgerufen; hier
 * liefert eine Haelfte das feste Manifest, damit die Runde pruefbar bleibt. */
function dumpPortWithManifest(options: { fail?: boolean } = {}): ProjectDatabaseDumpPort {
  const port = dumpPort(options);
  return {
    dump: port.dump.bind(port),
    withReader: (async (_input, operation) => {
      void operation;
      return manifest;
    }) as ProjectDatabaseDumpPort["withReader"],
  };
}

const restoreTarget: ProjectDatabaseRestoreTargetPort = {
  async createDatabase() { /* im Speicher gibt es nichts anzulegen */ },
  async restore() { /* und nichts einzuspielen */ },
  withReader: (async () => manifest) as ProjectDatabaseRestoreTargetPort["withReader"],
};

describe("Die Runde des Dienstes", () => {
  const scope: ProjectDatabaseBackupScope = {
    organizationId: identity.organizationId,
    projectId: identity.projectId,
    environment: "production",
  };

  function build(options: { fail?: boolean } = {}) {
    let now = new Date("2026-10-01T08:00:00.000Z");
    const store = new MemoryBackupStore(scope.organizationId, () => now);
    const objects = new MemoryObjects();
    const service = new ProjectDatabaseBackupService({
      store, objects, keys: protector, restoreTarget,
      dump: dumpPortWithManifest(options),
      workerId: "memory-worker", retentionDays: 30, now: () => now,
    });
    return { store, objects, service, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
  }

  it("macht aus einem Auftrag ein lesbares Backup und legt genau ein Objekt ab", async () => {
    const { store, objects, service } = build();
    const job = await service.enqueue(scope, "managed:memory-one");
    expect(await service.runRound()).toMatchObject({ status: "succeeded", backupId: job.id });
    const record = (await store.get(job.id))!;
    expect(record.status).toBe("available");
    expect(record.manifestSha256).toBe(manifest.sha256);
    expect(record.objectKey).toBe(backupObjectKey(record));
    expect(objects.objects.size).toBe(1);
    expect(record.expiresAt!.getTime() - record.completedAt!.getTime()).toBe(30 * 24 * 60 * 60 * 1_000);
    // Der Datenschluessel ist nur eingewickelt da, und er geht nur unter der
    // Kennung dieses Backups wieder auf.
    const dataKey = await protector.unwrap({
      wrapped: record.wrappedDataKey!, keyId: record.keyId!, identity: identityOf(record),
    });
    const artifact = await objects.get(record.objectKey!);
    expect(openBackupArtifact({ artifact, dataKey, identity: identityOf(record) }).toString("utf8"))
      .toContain("CREATE TABLE");
    expect(await service.runRound()).toMatchObject({ status: "idle" });
  });

  it("zaehlt einen Fehlschlag mit festem Code und gibt nach dem letzten Versuch auf", async () => {
    const { store, service } = build({ fail: true });
    const job = await service.enqueue(scope, "managed:memory-two");
    expect(await service.runRound()).toMatchObject({ status: "failed", errorCode: "DUMP_FAILED" });
    expect((await store.get(job.id))!.status).toBe("pending");
    expect(await service.runRound()).toMatchObject({ status: "failed", errorCode: "DUMP_FAILED" });
    const failed = (await store.get(job.id))!;
    expect(failed.status).toBe("failed");
    expect(failed.lastErrorCode).toBe("DUMP_FAILED");
    expect(failed.attemptCount).toBe(2);
    // Ein aufgegebener Auftrag wird nicht noch einmal genommen.
    expect(await service.runRound()).toMatchObject({ status: "idle" });
  });

  it("raeumt erst das Objekt weg und dann die Zeile, und nur was abgelaufen ist", async () => {
    const { store, objects, service, advance } = build();
    const job = await service.enqueue(scope, "managed:memory-three");
    await service.runRound();
    const record = (await store.get(job.id))!;
    expect(await service.pruneExpired()).toBe(0);
    advance(31 * 24 * 60 * 60 * 1_000);
    expect(await service.pruneExpired({ batchSize: 2 })).toBe(1);
    expect(objects.order).toEqual([`put ${record.objectKey}`, `delete ${record.objectKey}`]);
    const forgotten = (await store.get(job.id))!;
    expect(forgotten.status).toBe("expired");
    expect(forgotten.objectKey).toBeNull();
    expect(forgotten.wrappedDataKey).toBeNull();
    // Die Tatsache bleibt: es hat ein Backup gegeben.
    expect(forgotten.manifestSha256).toBe(manifest.sha256);
  });

  it("stellt nur ein vorhandenes Backup wieder her und vergleicht dabei das Manifest", async () => {
    const { store, service } = build();
    await expect(service.restoreToNewDatabase({ backupId: randomUUID() }))
      .rejects.toMatchObject({ code: "BACKUP_NOT_FOUND" });
    const job = await service.enqueue(scope, "managed:memory-four");
    await expect(service.restoreToNewDatabase({ backupId: job.id }))
      .rejects.toMatchObject({ code: "BACKUP_NOT_AVAILABLE" });
    await service.runRound();
    const restored = await service.restoreToNewDatabase({ backupId: job.id });
    expect(restored.restoredManifestSha256).toBe(restored.expectedManifestSha256);
    expect(restored.databaseName).toBe(restoreDatabaseName((await store.get(job.id))!.id));
  });

  it("weist eine Arbeiterkennung ab, die keine ist", () => {
    const store = new MemoryBackupStore(scope.organizationId, () => new Date());
    expect(() => new ProjectDatabaseBackupService({
      store, objects: new MemoryObjects(), keys: protector, restoreTarget,
      dump: dumpPortWithManifest(), workerId: "nicht erlaubt mit Leerzeichen",
    })).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });
});
