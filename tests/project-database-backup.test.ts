import { createHash, randomUUID } from "node:crypto";
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
  type ProjectDatabaseRestoreErrorCode,
  type ProjectDatabaseRestoreTargetPort,
} from "@/lib/server/backup/project-database";
import {
  CHUNKED_HEADER_BYTES,
  DEFAULT_PART_PLAINTEXT_BYTES,
  MAX_ARTIFACT_PARTS,
  NO_PREVIOUS_TAG,
  chunkedPartCount,
  chunkedPartRange,
  maxChunkedDumpBytes,
  newBackupDataKey,
  openBackupArtifact,
  openBackupPart,
  sealBackupArtifact,
  sealBackupPart,
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
  private restoreLeases = new Map<string, string>();

  constructor(private readonly organizationId: string, private readonly now: () => Date) {}

  async enqueue(scope: ProjectDatabaseBackupScope, databaseInstanceRef: string) {
    const existing = [...this.records.values()].find((record) =>
      record.projectId === scope.projectId && record.environment === scope.environment &&
      (record.status === "pending" || record.status === "running"));
    if (existing) return Object.freeze({ record: existing, created: false });
    const record: ProjectDatabaseBackupRecord = Object.freeze({
      id: randomUUID(), organizationId: this.organizationId, projectId: scope.projectId,
      environment: scope.environment, databaseInstanceRef, status: "pending",
      objectKey: null, artifactSha256: null, sizeBytes: null, wrappedDataKey: null, keyId: null,
      manifestSha256: null, includes: [],
      artifactFormat: "single" as const, partCount: null, partPlaintextBytes: null,
      restoreStatus: null, restoreRequestedAt: null, restoreRequestedBy: null,
      restoreDatabaseName: null, restoreCompletedAt: null, restoreErrorCode: null,
      snapshotAt: null, completedAt: null, expiresAt: null,
      attemptCount: 0, maxAttempts: 2, lastErrorCode: null, createdAt: this.now(),
    });
    this.records.set(record.id, record);
    return Object.freeze({ record, created: true });
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
  /**
   * Die bestellte Wiederherstellung (2.129). Dieselbe Bedingung wie in der
   * Anweisung von 0084: nur ein vorhandenes Backup, und nur wenn keine laeuft.
   */
  async requestRestore(input: {
    backupId: string; databaseName: string; requestedBy: string; at: Date;
  }) {
    const current = this.records.get(input.backupId);
    if (!current || current.status !== "available" ||
        current.restoreStatus === "requested" || current.restoreStatus === "running") {
      return null;
    }
    const record = Object.freeze({
      ...current, restoreStatus: "requested" as const, restoreRequestedAt: input.at,
      restoreRequestedBy: input.requestedBy, restoreDatabaseName: input.databaseName,
      restoreCompletedAt: null, restoreErrorCode: null,
    });
    this.records.set(record.id, record);
    return record;
  }

  async claimNextRestore() {
    const requested = [...this.records.values()].find((record) => record.restoreStatus === "requested");
    if (!requested) return null;
    const record = Object.freeze({ ...requested, restoreStatus: "running" as const });
    this.records.set(record.id, record);
    const leaseToken = randomUUID();
    this.restoreLeases.set(record.id, leaseToken);
    return Object.freeze({ record, databaseName: record.restoreDatabaseName!, leaseToken });
  }

  async completeRestore(claim: { record: ProjectDatabaseBackupRecord; leaseToken: string }, at: Date) {
    if (this.restoreLeases.get(claim.record.id) !== claim.leaseToken) throw new Error("lease lost");
    this.records.set(claim.record.id, Object.freeze({
      ...this.records.get(claim.record.id)!, restoreStatus: "succeeded" as const,
      restoreCompletedAt: at, restoreErrorCode: null,
    }));
  }

  async failRestore(
    claim: { record: ProjectDatabaseBackupRecord; leaseToken: string },
    errorCode: ProjectDatabaseRestoreErrorCode,
    at: Date,
  ) {
    this.records.set(claim.record.id, Object.freeze({
      ...this.records.get(claim.record.id)!, restoreStatus: "failed" as const,
      restoreCompletedAt: at, restoreErrorCode: errorCode,
    }));
  }

  async failExpiredRestoreLeases() { return []; }

  async forget(backupId: string) {
    const current = this.records.get(backupId)!;
    this.records.set(backupId, Object.freeze({
      ...current, status: "expired" as const, objectKey: null, wrappedDataKey: null,
      keyId: null, artifactSha256: null, sizeBytes: null,
      partCount: null, partPlaintextBytes: null,
    }));
  }
}

/**
 * Ein Objektspeicher im Speicher, mit Multipart und Bytebereichen (2.129).
 *
 * Er haelt die Teile getrennt, bis der Abschluss kommt, und setzt sie dann in
 * der Reihenfolge der Liste zusammen -- wie S3. Dass die Teile einzeln liegen,
 * ist der Punkt: so kann ein Fall einen davon vertauschen oder weglassen.
 */
class MemoryObjects implements ProjectDatabaseBackupObjectStore {
  readonly objects = new Map<string, Buffer>();
  readonly order: string[] = [];
  readonly uploads = new Map<string, Map<number, Buffer>>();
  /** Wird auf die Liste des Abschlusses angewandt, bevor zusammengesetzt wird. */
  mangleParts?: (parts: readonly { partNumber: number; etag: string }[]) =>
    readonly { partNumber: number; etag: string }[];

  async beginMultipart(key: string) {
    const uploadId = `upload-${this.uploads.size + 1}`;
    this.uploads.set(uploadId, new Map());
    this.order.push(`begin ${key}`);
    return uploadId;
  }

  async putPart(input: { key: string; uploadId: string; partNumber: number; bytes: Buffer }) {
    const upload = this.uploads.get(input.uploadId);
    if (!upload) throw Object.assign(new Error("no upload"), { code: "OBJECT_STORE_UNAVAILABLE" });
    upload.set(input.partNumber, Buffer.from(input.bytes));
    return { partNumber: input.partNumber, etag: `"etag-${input.partNumber}"` };
  }

  async completeMultipart(input: {
    key: string; uploadId: string; parts: readonly { partNumber: number; etag: string }[];
  }) {
    const upload = this.uploads.get(input.uploadId);
    if (!upload) throw Object.assign(new Error("no upload"), { code: "OBJECT_STORE_UNAVAILABLE" });
    const parts = this.mangleParts ? this.mangleParts(input.parts) : input.parts;
    this.objects.set(input.key, Buffer.concat(parts.map((part) => upload.get(part.partNumber)!)));
    this.uploads.delete(input.uploadId);
    this.order.push(`put ${input.key}`);
  }

  async abortMultipart(key: string, uploadId: string) {
    this.uploads.delete(uploadId);
    this.order.push(`abort ${key}`);
  }

  async getRange(key: string, offset: number, length: number) {
    const bytes = this.objects.get(key);
    if (!bytes) throw Object.assign(new Error("missing"), { code: "OBJECT_NOT_FOUND" });
    if (offset + length > bytes.length) {
      throw Object.assign(new Error("short"), { code: "OBJECT_CHECKSUM_MISMATCH" });
    }
    return bytes.subarray(offset, offset + length);
  }

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

/**
 * Eine Haelfte des Dumps, als **Strom** (2.129). `chunkBytes` sagt, in welchen
 * Haeppchen der Strom kommt: der Dienst darf nicht davon abhaengen, dass ein
 * Haeppchen des Kindprozesses genau eine Teilegroesse ist.
 *
 * Das Manifest kommt aus `withReader` als fester Wert, damit die Runde ohne
 * Datenbank pruefbar bleibt.
 */
function dumpPortWithManifest(options: {
  fail?: boolean; body?: Buffer; chunkBytes?: number; cancelled?: { value: boolean };
} = {}): ProjectDatabaseDumpPort {
  const body = options.body ?? Buffer.from("-- dump\nCREATE TABLE t (id integer);\n", "utf8");
  const chunkBytes = options.chunkBytes ?? 7;
  return {
    async dumpStream() {
      if (options.fail) throw Object.assign(new Error("no"), { code: "DUMP_FAILED" });
      async function* chunks() {
        for (let offset = 0; offset < body.length; offset += chunkBytes) {
          yield body.subarray(offset, Math.min(offset + chunkBytes, body.length));
        }
      }
      return {
        chunks: chunks(),
        cancel: () => { if (options.cancelled) options.cancelled.value = true; },
      };
    },
    withReader: (async (_input, operation) => {
      void operation;
      return manifest;
    }) as ProjectDatabaseDumpPort["withReader"],
  };
}

/**
 * Das Ziel einer Wiederherstellung im Speicher. Es **liest den Strom zu Ende**,
 * und das ist der Punkt: ein Ziel, das den Strom wegwirft, prueft kein Siegel
 * und keine Kette, und ein Fall darueber belegte nichts.
 */
function memoryRestoreTarget(): ProjectDatabaseRestoreTargetPort & { restored: Buffer[] } {
  const restored: Buffer[] = [];
  return {
    restored,
    async createDatabase() { /* im Speicher gibt es nichts anzulegen */ },
    async restore(input) {
      const parts: Buffer[] = [];
      for await (const chunk of input.dump) parts.push(chunk);
      restored.push(Buffer.concat(parts));
    },
    withReader: (async () => manifest) as ProjectDatabaseRestoreTargetPort["withReader"],
  };
}

describe("Der stueckweise Umschlag (2.129)", () => {
  const dataKey = newBackupDataKey();
  const partPlaintextBytes = 1_024;

  /** Siegelt einen Klartext in Teile, so wie der Dienst es tut. */
  function seal(plaintext: Buffer) {
    const parts: { bytes: Buffer; tagHex: string }[] = [];
    let previousTagHex = NO_PREVIOUS_TAG;
    const count = Math.max(1, Math.ceil(plaintext.length / partPlaintextBytes));
    for (let index = 0; index < count; index += 1) {
      const chunk = plaintext.subarray(index * partPlaintextBytes,
        Math.min((index + 1) * partPlaintextBytes, plaintext.length));
      const sealed = sealBackupPart({
        chunk, dataKey, identity, partPlaintextBytes,
        partNumber: index + 1, final: index + 1 === count, previousTagHex,
      });
      previousTagHex = sealed.tagHex;
      parts.push(sealed);
    }
    return parts;
  }

  function open(parts: readonly { bytes: Buffer }[], count = parts.length) {
    const chunks: Buffer[] = [];
    let previousTagHex = NO_PREVIOUS_TAG;
    for (let index = 0; index < parts.length; index += 1) {
      const opened = openBackupPart({
        part: parts[index].bytes, dataKey, identity, partPlaintextBytes,
        partNumber: index + 1, final: index + 1 === count, previousTagHex,
      });
      previousTagHex = opened.tagHex;
      chunks.push(opened.chunk);
    }
    return Buffer.concat(chunks);
  }

  it("gibt den Klartext ueber mehrere Teile genau zurueck", () => {
    const plaintext = Buffer.alloc(partPlaintextBytes * 2 + 17, 0x61);
    const parts = seal(plaintext);
    expect(parts).toHaveLength(3);
    expect(open(parts).equals(plaintext)).toBe(true);
  });

  it("laesst einen vertauschten Teil nicht aufgehen", () => {
    const parts = seal(Buffer.alloc(partPlaintextBytes * 2 + 1, 0x62));
    const swapped = [parts[1], parts[0], parts[2]];
    expect(() => open(swapped))
      .toThrowError(expect.objectContaining({ code: "ARTIFACT_IDENTITY_MISMATCH" }));
  });

  it("laesst einen weggelassenen Teil in der Mitte nicht aufgehen", () => {
    // Die Kette bricht: Teil 3 bindet das Tag von Teil 2, und das steht hier
    // nicht mehr davor. Eine Nummer allein wuerde das nicht fangen.
    const parts = seal(Buffer.alloc(partPlaintextBytes * 2 + 1, 0x63));
    expect(() => open([parts[0], parts[2]], 3))
      .toThrowError(expect.objectContaining({ code: "ARTIFACT_IDENTITY_MISMATCH" }));
  });

  it("laesst einen abgeschnittenen Strom nicht als ganzen durchgehen", () => {
    // Teil 2 traegt `more`, also kann er nicht der letzte sein. Ohne das
    // `final`-Zeichen waeren zwei von drei Teilen ein gueltiges Artefakt.
    const parts = seal(Buffer.alloc(partPlaintextBytes * 2 + 1, 0x64));
    expect(() => open([parts[0], parts[1]], 2))
      .toThrowError(expect.objectContaining({ code: "ARTIFACT_IDENTITY_MISMATCH" }));
  });

  it("laesst einen eingefuegten Teil nicht aufgehen", () => {
    const parts = seal(Buffer.alloc(partPlaintextBytes + 1, 0x65));
    const foreign = seal(Buffer.alloc(partPlaintextBytes + 1, 0x66));
    expect(() => open([parts[0], foreign[0], parts[1]], 3))
      .toThrowError(expect.objectContaining({ code: "ARTIFACT_IDENTITY_MISMATCH" }));
  });

  it("laesst einen Teil unter einer fremden Kennung nicht aufgehen", () => {
    const parts = seal(Buffer.from("tenant bytes"));
    expect(() => openBackupPart({
      part: parts[0].bytes, dataKey, identity: { ...identity, projectId: randomUUID() },
      partPlaintextBytes, partNumber: 1, final: true, previousTagHex: NO_PREVIOUS_TAG,
    })).toThrowError(expect.objectContaining({ code: "ARTIFACT_IDENTITY_MISMATCH" }));
  });

  it("weist einen nicht letzten Teil ab, der kuerzer ist als die Teilegroesse", () => {
    // Ein kurzer Teil in der Mitte macht die Versatzrechnung des Lesers falsch.
    expect(() => sealBackupPart({
      chunk: Buffer.alloc(10, 1), dataKey, identity, partPlaintextBytes,
      partNumber: 1, final: false, previousTagHex: NO_PREVIOUS_TAG,
    })).toThrowError(expect.objectContaining({ code: "ARTIFACT_MALFORMED" }));
  });
});

describe("Die Obergrenze, gerechnet (2.129)", () => {
  it("ist Teilegroesse mal Teilezahl, und im Produkt 625 GiB", () => {
    expect(maxChunkedDumpBytes()).toBe(DEFAULT_PART_PLAINTEXT_BYTES * MAX_ARTIFACT_PARTS);
    expect(maxChunkedDumpBytes()).toBe(625 * 1024 * 1024 * 1024);
  });

  it("bleibt unter der Grenze, die 0083 fuer `size_bytes` setzt", () => {
    // 1 TiB ist die Grenze der Spalte. Eine Rechnung, die darueber kaeme, muss
    // Teile weglassen und nicht die Spalte sprengen.
    const huge = maxChunkedDumpBytes(256 * 1024 * 1024, MAX_ARTIFACT_PARTS);
    expect(huge).toBeLessThanOrEqual(1_099_511_627_776);
    expect(huge % (256 * 1024 * 1024)).toBe(0);
  });

  it("rechnet Teilezahl und Bytebereiche aus Groesse und Teilegroesse", () => {
    const partPlaintextBytes = 1_024;
    const full = partPlaintextBytes + 28;
    const artifactBytes = CHUNKED_HEADER_BYTES + full * 2 + (28 + 5);
    expect(chunkedPartCount(artifactBytes, partPlaintextBytes)).toBe(3);
    expect(chunkedPartRange({ partNumber: 1, partCount: 3, artifactBytes, partPlaintextBytes }))
      .toEqual({ offset: CHUNKED_HEADER_BYTES, length: full });
    expect(chunkedPartRange({ partNumber: 3, partCount: 3, artifactBytes, partPlaintextBytes }))
      .toEqual({ offset: CHUNKED_HEADER_BYTES + full * 2, length: 33 });
  });
});

describe("Die Runde des Dienstes", () => {
  const scope: ProjectDatabaseBackupScope = {
    organizationId: identity.organizationId,
    projectId: identity.projectId,
    environment: "production",
  };

  function build(options: {
    fail?: boolean; body?: Buffer; chunkBytes?: number; partPlaintextBytes?: number;
    maxParts?: number; cancelled?: { value: boolean };
  } = {}) {
    let now = new Date("2026-10-01T08:00:00.000Z");
    const store = new MemoryBackupStore(scope.organizationId, () => now);
    const objects = new MemoryObjects();
    const target = memoryRestoreTarget();
    const service = new ProjectDatabaseBackupService({
      store, objects, keys: protector, restoreTarget: target,
      dump: dumpPortWithManifest(options),
      workerId: "memory-worker", retentionDays: 30, now: () => now,
      // 1 KiB statt 64 MiB: dieselbe Rechnung, dasselbe Siegeln, dieselbe Kette,
      // nur ohne Gigabytes. Siehe `partPlaintextBytes` im Dienst.
      partPlaintextBytes: options.partPlaintextBytes ?? 1_024,
      maxParts: options.maxParts,
    });
    return {
      store, objects, service, target,
      advance: (ms: number) => { now = new Date(now.getTime() + ms); },
    };
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
    dataKey.fill(0);
    // Die Form ist die stueckweise, und die Zeile nennt beide Zahlen, die ein
    // Leser braucht.
    expect(record.artifactFormat).toBe("chunked");
    expect(record.partCount).toBe(1);
    expect(record.partPlaintextBytes).toBe(1_024);
    const artifact = await objects.get(record.objectKey!);
    expect(artifact.subarray(0, 8).toString("utf8")).toBe("QKBAKC1\n");
    expect(artifact.includes("CREATE TABLE")).toBe(false);
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
    expect(objects.order).toEqual([
      `begin ${record.objectKey}`, `put ${record.objectKey}`, `delete ${record.objectKey}`,
    ]);
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


  it("teilt einen Dump in Teile, laedt sie stueckweise hoch und liest sie wieder zusammen",
    async () => {
      // Ein Dump ueber zwei Teilegroessen, in Haeppchen, die nicht auf die
      // Teilegroesse passen: der Dienst darf nicht davon abhaengen, dass ein
      // Haeppchen des Kindprozesses genau ein Teil ist.
      const body = Buffer.concat([
        Buffer.from("-- dump\n", "utf8"),
        Buffer.alloc(1_024 * 2 + 300, 0x7a),
      ]);
      const { store, objects, service, target } = build({ body, chunkBytes: 333 });
      const job = await service.enqueue(scope, "managed:memory-parts");
      expect(await service.runRound()).toMatchObject({ status: "succeeded" });
      const record = (await store.get(job.id))!;
      expect(record.partCount).toBe(3);
      expect(record.sizeBytes).toBe(CHUNKED_HEADER_BYTES + body.length + 3 * 28);
      expect(objects.objects.get(record.objectKey!)!.length).toBe(record.sizeBytes);

      await service.restoreToNewDatabase({ backupId: job.id });
      expect(target.restored).toHaveLength(1);
      expect(target.restored[0].equals(body)).toBe(true);
    });

  it("bricht ueber der gerechneten Obergrenze mit ARTIFACT_TOO_LARGE ab und laesst kein Objekt liegen",
    async () => {
      // Zwei Teile von 1 KiB sind 2 KiB Obergrenze. Der Dump ist 3 KiB. Die
      // Rechnung ist dieselbe wie im Produkt, nur in Kilobytes.
      const { store, objects, service } = build({
        body: Buffer.alloc(3 * 1_024, 0x41), chunkBytes: 512,
        partPlaintextBytes: 1_024, maxParts: 2,
      });
      expect(service.maxDumpBytes).toBe(2_048);
      const job = await service.enqueue(scope, "managed:memory-toobig");
      expect(await service.runRound())
        .toMatchObject({ status: "failed", errorCode: "ARTIFACT_TOO_LARGE" });
      expect((await store.get(job.id))!.lastErrorCode).toBe("ARTIFACT_TOO_LARGE");
      // Kein Objekt, und der Upload ist abgebrochen: Teile ohne Objekt kosten
      // Platz, ohne je eines zu werden.
      expect(objects.objects.size).toBe(0);
      expect(objects.uploads.size).toBe(0);
      expect(objects.order.filter((entry) => entry.startsWith("abort "))).toHaveLength(1);
    });

  it("beendet den Kindprozess, wenn die Runde aufgibt", async () => {
    const cancelled = { value: false };
    const { service } = build({
      body: Buffer.alloc(3 * 1_024, 0x42), partPlaintextBytes: 1_024, maxParts: 2, cancelled,
    });
    await service.enqueue(scope, "managed:memory-cancel");
    await service.runRound();
    expect(cancelled.value).toBe(true);
  });

  it("merkt zwei vertauschte Teile bei der Wiederherstellung", async () => {
    // Vier Teile, und vertauscht werden zwei **gleich lange** in der Mitte.
    // Damit stimmen alle Versaetze und alle Laengen weiter, und was den Tausch
    // merkt, ist allein die Kette in der AAD -- genau die Zusage, um die es
    // geht. (Teil 1 zu tauschen waere der leichtere Fall: dort steht der Kopf
    // des Artefakts, und der fehlt dann vorn.)
    const { store, objects, service } = build({
      body: Buffer.alloc(1_024 * 3 + 10, 0x43), chunkBytes: 700,
    });
    objects.mangleParts = (parts) => [parts[0], parts[2], parts[1], parts[3]];
    const job = await service.enqueue(scope, "managed:memory-swapped");
    await service.runRound();
    expect((await store.get(job.id))!.partCount).toBe(4);
    await expect(service.restoreToNewDatabase({ backupId: (await store.get(job.id))!.id }))
      .rejects.toMatchObject({ code: "ARTIFACT_IDENTITY_MISMATCH" });
  });

  it("merkt einen weggelassenen Teil, bevor ein Byte Klartext hinausgeht", async () => {
    const { store, objects, service } = build({
      body: Buffer.alloc(1_024 * 2 + 10, 0x44), chunkBytes: 700,
    });
    objects.mangleParts = (parts) => [parts[0], parts[2]];
    const job = await service.enqueue(scope, "managed:memory-dropped");
    await service.runRound();
    // Hier faellt es am **Bytebereich** auf und nicht an der Teilezahl: die
    // Teilezahl rechnet der Leser aus `size_bytes` der Zeile, und die Zeile
    // kennt die Groesse, die das Backup hatte. Ein Objekt, das kuerzer ist als
    // seine Zeile, zeigt das beim Lesen des letzten Teils, und der Code kommt
    // dann aus dem Objektspeicher. Das steht so auch im Dienst.
    await expect(service.restoreToNewDatabase({ backupId: (await store.get(job.id))!.id }))
      .rejects.toMatchObject({ code: "OBJECT_CHECKSUM_MISMATCH" });
  });

  it("liest ein Artefakt im Format von 2.73.0 weiter", async () => {
    // Ein Backup, das vor 2.129 entstand, liegt als **ein** Umschlag da. Ein Weg,
    // der sein eigenes altes Format nicht mehr liest, ist eine Aufbewahrung, die
    // mit dem Release endet.
    const { store, objects, service, target } = build();
    const job = await service.enqueue(scope, "managed:memory-legacy");
    await service.runRound();
    const record = (await store.get(job.id))!;
    const dump = Buffer.from("-- alt\nCREATE TABLE legacy (id integer);\n", "utf8");
    const dataKey = await protector.unwrap({
      wrapped: record.wrappedDataKey!, keyId: record.keyId!, identity: identityOf(record),
    });
    const artifact = sealBackupArtifact({ dump, dataKey, identity: identityOf(record) });
    dataKey.fill(0);
    objects.objects.set(record.objectKey!, artifact);
    store.records.set(record.id, Object.freeze({
      ...record, artifactFormat: "single" as const, partCount: null, partPlaintextBytes: null,
      sizeBytes: artifact.length,
      artifactSha256: createHash("sha256").update(artifact).digest("hex"),
    }));
    await service.restoreToNewDatabase({ backupId: record.id });
    expect(target.restored.at(-1)!.equals(dump)).toBe(true);
  });

  it("weist eine Arbeiterkennung ab, die keine ist", () => {
    const store = new MemoryBackupStore(scope.organizationId, () => new Date());
    expect(() => new ProjectDatabaseBackupService({
      store, objects: new MemoryObjects(), keys: protector,
      restoreTarget: memoryRestoreTarget(),
      dump: dumpPortWithManifest(), workerId: "nicht erlaubt mit Leerzeichen",
    })).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });
});
