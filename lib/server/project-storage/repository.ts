import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  ProjectStorageBucket,
  ProjectStorageObject,
  ProjectStorageObjectStatus,
  ProjectStoragePrincipal,
  ProjectStorageScope,
  ProjectStorageUpload,
  ProjectStorageUploadPart,
} from "@/lib/server/project-storage/model";

export class ProjectStorageConflictError extends Error {
  readonly code = "STORAGE_CONFLICT";
  constructor() { super("STORAGE_CONFLICT"); this.name = "ProjectStorageConflictError"; }
}
recognisedByName(ProjectStorageConflictError, "ProjectStorageConflictError");

export class ProjectStorageQuotaError extends Error {
  readonly code = "STORAGE_QUOTA_EXCEEDED";
  constructor() { super("STORAGE_QUOTA_EXCEEDED"); this.name = "ProjectStorageQuotaError"; }
}
recognisedByName(ProjectStorageQuotaError, "ProjectStorageQuotaError");

export type ProjectStorageBucketPatch = Pick<ProjectStorageBucket,
  "readPolicy" | "writePolicy" | "allowedMimeTypes" | "maxObjectBytes" |
  "quotaBytes" | "retentionDays" | "updatedAt">;

export interface ProjectStorageRepository {
  listBuckets(principal: ProjectStoragePrincipal, scope: ProjectStorageScope): Promise<ProjectStorageBucket[]>;
  findBucket(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketIdOrName: string): Promise<ProjectStorageBucket | null>;
  createBucket(principal: ProjectStoragePrincipal, bucket: ProjectStorageBucket): Promise<ProjectStorageBucket>;
  updateBucket(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId: string,
    patch: ProjectStorageBucketPatch,
  ): Promise<ProjectStorageBucket | null>;
  deleteBucket(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketId: string): Promise<boolean>;

  reserveUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    upload: ProjectStorageUpload,
    now: Date,
  ): Promise<ProjectStorageUpload>;
  findUploadByToken(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
  ): Promise<ProjectStorageUpload | null>;
  completeUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    object: ProjectStorageObject,
    now: Date,
  ): Promise<ProjectStorageObject>;
  cancelUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    status: "cancelled" | "expired",
    now: Date,
  ): Promise<boolean>;

  listObjects(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId: string,
    input: { prefix: string; limit: number; cursor?: string; includeUnsafe: boolean; ownerSubject?: string },
  ): Promise<ProjectStorageObject[]>;
  findObject(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId: string,
    objectKeyOrId: string,
  ): Promise<ProjectStorageObject | null>;
  setObjectStatus(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    objectId: string,
    status: ProjectStorageObjectStatus,
    now: Date,
  ): Promise<ProjectStorageObject | null>;
  markObjectDeleted(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    objectId: string,
    now: Date,
  ): Promise<ProjectStorageObject | null>;
  listExpiredObjects(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    now: Date,
    limit: number,
  ): Promise<ProjectStorageObject[]>;
  /**
   * Markiert verfallene `pending`-Reservierungen als `expired`, gibt ihre
   * Quota frei und liefert sie zurueck — mit `providerUploadId`, damit der
   * Aufrufer den Provider-Upload abbrechen kann. Bisher verfielen
   * Reservierungen nur lazy beim naechsten `reserveUpload` desselben Buckets,
   * und niemand sagte dem Provider Bescheid.
   */
  expireUploads(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    now: Date,
    limit: number,
  ): Promise<ProjectStorageUpload[]>;
  /**
   * Eine Multipart-Reservierung ueber ihre Kennung, ohne Abschluss-Token
   * (2.101). Der S3-Endpunkt hat keinen: Seine Vollmacht ist die
   * SigV4-Signatur, und der Geltungsbereich steht im Aufruf.
   */
  findMultipartUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
  ): Promise<ProjectStorageUpload | null>;
  /**
   * Nimmt ein Teil eines S3-Multipart-Uploads an (2.101).
   *
   * Die Reservierung dieser Sorte beginnt bei null Bytes, also traegt jedes
   * Teil seine eigenen. Die Quota wird hier geprueft, nicht erst beim
   * Abschluss: Ein Teil, das den Bucket ueber die Grenze braechte, wird
   * abgelehnt, bevor seine Bytes beim Provider liegen. Ein zweites Teil
   * derselben Nummer ersetzt das erste und gibt dessen Bytes frei, so wie S3
   * ein Teil ueberschreiben laesst.
   */
  recordUploadPart(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    part: { partNumber: number; sizeBytes: number; checksumSha256: string },
    now: Date,
  ): Promise<ProjectStorageUploadPart>;
  /** Traegt die Kennung des Providers nach, sobald die Bytes des Teils liegen. */
  confirmUploadPart(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    partNumber: number,
    etag: string,
  ): Promise<ProjectStorageUploadPart | null>;
  /** Die angenommenen Teile einer Reservierung, aufsteigend nach Nummer. */
  listUploadParts(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
  ): Promise<ProjectStorageUploadPart[]>;
  /**
   * Traegt die Pruefsumme der ganzen Datei an einer Reservierung nach, deren
   * Groesse mit den Teilen kam. Ohne sie hat der Scanner nichts
   * nachzurechnen, und `completeUpload` nimmt das Objekt nicht an.
   */
  declareUploadChecksum(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    checksumSha256: string,
  ): Promise<boolean>;
  /** Lebende Multipart-Reservierungen — die Schutzliste des Waisen-Aufraeumers. */
  listPendingMultipartUploads(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    now: Date,
  ): Promise<ProjectStorageUpload[]>;
  /**
   * Verfallene und abgebrochene Uploads, deren Datei beim Anbieter noch nicht
   * freigegeben ist (2.178), aelteste zuerst. Die Lifecycle-Runde loescht die
   * Datei oder bricht den Upload ab und setzt dann `markUploadReleased`.
   */
  listUnreleasedUploads(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    limit: number,
  ): Promise<ProjectStorageUpload[]>;
  /** Setzt den Vermerk einmal; `false`, wenn er schon stand oder der Upload nicht passt. */
  markUploadReleased(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    now: Date,
  ): Promise<boolean>;
  /**
   * Der Stand der Objekte einer Umgebung, neueste zuerst (2.51) — ueber alle
   * Buckets oder ueber einen, wahlweise auf ein Urteil eingeschraenkt.
   *
   * Anders als `listObjects` blendet diese Abfrage geloeschte Objekte **nicht**
   * aus. Ein befallenes Objekt bekommt beim Urteil sofort ein `deleted_at`;
   * wer nur die lebenden Zeilen liest, sieht kein einziges `infected` und
   * haelt das fuer eine saubere Umgebung.
   */
  listObjectLog(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    input: ProjectStorageLogQuery,
  ): Promise<ProjectStorageObject[]>;
  /** Wie viele Objekte je Urteil, im selben Ausschnitt wie `listObjectLog`. */
  countObjectLog(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId?: string,
  ): Promise<Record<ProjectStorageObjectStatus, number>>;
}

/** Schluessel der Seitenfolge: Anlagezeitpunkt und Id, beide absteigend. */
export type ProjectStorageLogCursor = { createdAt: Date; id: string };

export type ProjectStorageLogQuery = {
  bucketId?: string;
  status?: ProjectStorageObjectStatus;
  limit: number;
  cursor?: ProjectStorageLogCursor;
};

/** Ein Zaehler je Urteil, mit Null vorbelegt — eine Null ist eine Auskunft. */
export function emptyObjectLogCounts(): Record<ProjectStorageObjectStatus, number> {
  return { quarantined: 0, clean: 0, infected: 0 };
}

/** Neueste zuerst: absteigend nach Anlagezeitpunkt, bei Gleichstand nach Id. */
export function compareObjectLogOrder(a: ProjectStorageObject, b: ProjectStorageObject): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
}

function afterObjectLogCursor(object: ProjectStorageObject, cursor: ProjectStorageLogCursor): boolean {
  const created = object.createdAt.getTime();
  const pivot = cursor.createdAt.getTime();
  return created < pivot || (created === pivot && object.id.localeCompare(cursor.id) < 0);
}

export class MemoryProjectStorageRepository implements ProjectStorageRepository {
  private readonly buckets = new Map<string, ProjectStorageBucket>();
  private readonly uploads = new Map<string, ProjectStorageUpload>();
  private readonly parts = new Map<string, ProjectStorageUploadPart[]>();
  private readonly objects = new Map<string, ProjectStorageObject>();

  async listBuckets(principal: ProjectStoragePrincipal, scope: ProjectStorageScope) {
    return [...this.buckets.values()].filter((bucket) => sameScope(bucket, scope) &&
      bucket.organizationId === principal.organizationId).sort((a, b) => a.name.localeCompare(b.name)).map(cloneBucket);
  }

  async findBucket(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketIdOrName: string) {
    const found = [...this.buckets.values()].find((bucket) => sameScope(bucket, scope) &&
      bucket.organizationId === principal.organizationId && (bucket.id === bucketIdOrName || bucket.name === bucketIdOrName));
    return found ? cloneBucket(found) : null;
  }

  async createBucket(principal: ProjectStoragePrincipal, bucket: ProjectStorageBucket) {
    if (bucket.organizationId !== principal.organizationId || this.buckets.has(bucket.id) ||
        [...this.buckets.values()].some((candidate) => sameScope(candidate, bucket) && candidate.name === bucket.name)) {
      throw new ProjectStorageConflictError();
    }
    this.buckets.set(bucket.id, cloneBucket(bucket));
    return cloneBucket(bucket);
  }

  async updateBucket(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId: string,
    patch: ProjectStorageBucketPatch,
  ) {
    const bucket = await this.findBucket(principal, scope, bucketId);
    if (!bucket) return null;
    if (patch.quotaBytes < bucket.usedBytes + bucket.reservedBytes) throw new ProjectStorageQuotaError();
    const updated = { ...bucket, ...patch, allowedMimeTypes: [...patch.allowedMimeTypes] };
    this.buckets.set(bucket.id, updated);
    return cloneBucket(updated);
  }

  async deleteBucket(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketId: string) {
    const bucket = await this.findBucket(principal, scope, bucketId);
    if (!bucket) return false;
    const hasContent = [...this.objects.values()].some((object) => sameScope(object, scope) &&
      object.bucketId === bucketId && !object.deletedAt) || [...this.uploads.values()].some((upload) =>
      sameScope(upload, scope) && upload.bucketId === bucketId && upload.status === "pending");
    if (hasContent) throw new ProjectStorageConflictError();
    return this.buckets.delete(bucketId);
  }

  async reserveUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    upload: ProjectStorageUpload,
    now: Date,
  ) {
    // No await before this critical section: concurrent in-process reservations
    // must observe and update the same stored counters atomically.
    const bucket = [...this.buckets.values()].find((candidate) => candidate.id === upload.bucketId &&
      candidate.organizationId === principal.organizationId && sameScope(candidate, scope));
    if (!bucket || !sameScope(upload, scope)) throw new ProjectStorageConflictError();
    this.releaseExpiredReservations(bucket, now);
    const duplicate = [...this.objects.values()].some((object) => sameScope(object, scope) &&
      object.bucketId === bucket.id && object.key === upload.objectKey && !object.deletedAt) ||
      [...this.uploads.values()].some((candidate) => sameScope(candidate, scope) &&
        candidate.bucketId === bucket.id && candidate.objectKey === upload.objectKey && candidate.status === "pending");
    if (duplicate || this.uploads.has(upload.id)) throw new ProjectStorageConflictError();
    if (bucket.usedBytes + bucket.reservedBytes + upload.sizeBytes > bucket.quotaBytes) {
      throw new ProjectStorageQuotaError();
    }
    bucket.reservedBytes += upload.sizeBytes;
    bucket.updatedAt = new Date(now);
    this.buckets.set(bucket.id, bucket);
    this.uploads.set(upload.id, cloneUpload(upload));
    return cloneUpload(upload);
  }

  async findUploadByToken(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
  ) {
    const upload = this.uploads.get(uploadId);
    return upload && upload.organizationId === principal.organizationId && sameScope(upload, scope) &&
      upload.completionTokenHash === tokenHash ? cloneUpload(upload) : null;
  }

  async completeUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    object: ProjectStorageObject,
    now: Date,
  ) {
    const upload = this.uploads.get(uploadId);
    const bucket = this.buckets.get(object.bucketId);
    if (!upload || !bucket || upload.organizationId !== principal.organizationId || !sameScope(upload, scope) ||
        upload.completionTokenHash !== tokenHash || !sameUploadObject(upload, object)) {
      throw new ProjectStorageConflictError();
    }
    if (upload.status === "completed" && upload.objectId) {
      const existing = this.objects.get(upload.objectId);
      if (existing) return cloneObject(existing);
    }
    if (upload.status !== "pending" || upload.expiresAt <= now || this.objects.has(object.id)) {
      throw new ProjectStorageConflictError();
    }
    bucket.reservedBytes = Math.max(0, bucket.reservedBytes - upload.sizeBytes);
    bucket.usedBytes += object.sizeBytes;
    bucket.updatedAt = new Date(now);
    upload.status = "completed";
    upload.completedAt = new Date(now);
    upload.objectId = object.id;
    this.buckets.set(bucket.id, bucket);
    this.uploads.set(upload.id, upload);
    this.objects.set(object.id, cloneObject(object));
    this.parts.delete(upload.id);
    return cloneObject(object);
  }

  async cancelUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    status: "cancelled" | "expired",
    now: Date,
  ) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.organizationId !== principal.organizationId || !sameScope(upload, scope) ||
        upload.completionTokenHash !== tokenHash) return false;
    if (upload.status !== "pending") return upload.status === status;
    const bucket = this.buckets.get(upload.bucketId);
    if (bucket) {
      bucket.reservedBytes = Math.max(0, bucket.reservedBytes - upload.sizeBytes);
      bucket.updatedAt = new Date(now);
    }
    upload.status = status;
    this.uploads.set(upload.id, upload);
    this.parts.delete(upload.id);
    return true;
  }

  async findMultipartUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
  ) {
    const upload = this.uploads.get(uploadId);
    return upload && upload.organizationId === principal.organizationId && sameScope(upload, scope) &&
      upload.kind === "multipart" ? cloneUpload(upload) : null;
  }

  async recordUploadPart(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    part: { partNumber: number; sizeBytes: number; checksumSha256: string },
    now: Date,
  ) {
    // No await before this critical section: the quota counters and the part
    // list must move together, exactly as in reserveUpload.
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.organizationId !== principal.organizationId || !sameScope(upload, scope) ||
        upload.completionTokenHash !== tokenHash || !upload.partsDeclared) {
      throw new ProjectStorageConflictError();
    }
    if (upload.status !== "pending" || upload.expiresAt <= now) throw new ProjectStorageConflictError();
    const bucket = this.buckets.get(upload.bucketId);
    if (!bucket) throw new ProjectStorageConflictError();
    const existing = (this.parts.get(uploadId) ?? []).find((candidate) => candidate.partNumber === part.partNumber);
    const delta = part.sizeBytes - (existing?.sizeBytes ?? 0);
    if (bucket.usedBytes + bucket.reservedBytes + delta > bucket.quotaBytes) throw new ProjectStorageQuotaError();
    if (upload.sizeBytes + delta > bucket.maxObjectBytes) throw new ProjectStorageQuotaError();
    bucket.reservedBytes = Math.max(0, bucket.reservedBytes + delta);
    bucket.updatedAt = new Date(now);
    this.buckets.set(bucket.id, bucket);
    upload.sizeBytes += delta;
    this.uploads.set(upload.id, upload);
    const stored: ProjectStorageUploadPart = {
      organizationId: upload.organizationId,
      projectId: upload.projectId,
      environment: upload.environment,
      uploadId,
      partNumber: part.partNumber,
      sizeBytes: part.sizeBytes,
      checksumSha256: part.checksumSha256,
      etag: null,
      createdAt: new Date(now),
    };
    const list = (this.parts.get(uploadId) ?? []).filter((candidate) => candidate.partNumber !== part.partNumber);
    list.push(stored);
    list.sort((a, b) => a.partNumber - b.partNumber);
    this.parts.set(uploadId, list);
    return { ...stored };
  }

  async confirmUploadPart(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    partNumber: number,
    etag: string,
  ) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.organizationId !== principal.organizationId || !sameScope(upload, scope) ||
        upload.completionTokenHash !== tokenHash) return null;
    const part = (this.parts.get(uploadId) ?? []).find((candidate) => candidate.partNumber === partNumber);
    if (!part) return null;
    part.etag = etag;
    return { ...part };
  }

  async listUploadParts(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
  ) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.organizationId !== principal.organizationId || !sameScope(upload, scope) ||
        upload.completionTokenHash !== tokenHash) return [];
    return (this.parts.get(uploadId) ?? []).map((part) => ({ ...part }));
  }

  async declareUploadChecksum(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    checksumSha256: string,
  ) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.organizationId !== principal.organizationId || !sameScope(upload, scope) ||
        upload.completionTokenHash !== tokenHash || !upload.partsDeclared || upload.status !== "pending") return false;
    upload.checksumSha256 = checksumSha256;
    this.uploads.set(upload.id, upload);
    return true;
  }

  async listObjects(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId: string,
    input: { prefix: string; limit: number; cursor?: string; includeUnsafe: boolean; ownerSubject?: string },
  ) {
    return [...this.objects.values()].filter((object) => object.organizationId === principal.organizationId &&
      sameScope(object, scope) && object.bucketId === bucketId && !object.deletedAt &&
      object.key.startsWith(input.prefix) && (!input.cursor || object.key > input.cursor) &&
      (!input.ownerSubject || object.ownerSubject === input.ownerSubject) &&
      (input.includeUnsafe || object.status === "clean"))
      .sort((a, b) => a.key.localeCompare(b.key)).slice(0, input.limit).map(cloneObject);
  }

  async findObject(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId: string,
    objectKeyOrId: string,
  ) {
    const object = [...this.objects.values()].find((candidate) => candidate.organizationId === principal.organizationId &&
      sameScope(candidate, scope) && candidate.bucketId === bucketId && !candidate.deletedAt &&
      (candidate.id === objectKeyOrId || candidate.key === objectKeyOrId));
    return object ? cloneObject(object) : null;
  }

  async setObjectStatus(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    objectId: string,
    status: ProjectStorageObjectStatus,
    now: Date,
  ) {
    const object = [...this.objects.values()].find((candidate) => candidate.id === objectId &&
      candidate.organizationId === principal.organizationId && sameScope(candidate, scope) && !candidate.deletedAt);
    if (!object) return null;
    object.status = status;
    if (status === "infected" && !object.deletedAt) {
      this.releaseObjectUsage(object, now);
      object.deletedAt = new Date(now);
    }
    this.objects.set(object.id, object);
    return cloneObject(object);
  }

  async markObjectDeleted(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    objectId: string,
    now: Date,
  ) {
    const object = [...this.objects.values()].find((candidate) => candidate.id === objectId &&
      candidate.organizationId === principal.organizationId && sameScope(candidate, scope));
    if (!object) return null;
    if (!object.deletedAt) this.releaseObjectUsage(object, now);
    object.deletedAt ??= new Date(now);
    this.objects.set(object.id, object);
    return cloneObject(object);
  }

  async listExpiredObjects(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    now: Date,
    limit: number,
  ) {
    return [...this.objects.values()].filter((object) => object.organizationId === principal.organizationId &&
      sameScope(object, scope) && !object.deletedAt && object.deleteAfter !== null && object.deleteAfter <= now)
      .sort((a, b) => a.deleteAfter!.getTime() - b.deleteAfter!.getTime()).slice(0, limit).map(cloneObject);
  }

  async expireUploads(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    now: Date,
    limit: number,
  ) {
    const stale = [...this.uploads.values()].filter((upload) =>
      upload.organizationId === principal.organizationId && sameScope(upload, scope) &&
      upload.status === "pending" && upload.expiresAt <= now)
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, limit);
    for (const upload of stale) {
      upload.status = "expired";
      const bucket = this.buckets.get(upload.bucketId);
      if (bucket) {
        bucket.reservedBytes = Math.max(0, bucket.reservedBytes - upload.sizeBytes);
        bucket.updatedAt = new Date(now);
      }
    }
    for (const upload of stale) this.parts.delete(upload.id);
    return stale.map(cloneUpload);
  }

  /** Die freigegebenen Uploads (2.178); im Speicherbetrieb neben der Zeile gefuehrt. */
  private readonly releasedUploads = new Set<string>();

  async listUnreleasedUploads(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    limit: number,
  ) {
    return [...this.uploads.values()].filter((upload) =>
      upload.organizationId === principal.organizationId && sameScope(upload, scope) &&
      (upload.status === "expired" || upload.status === "cancelled") && !this.releasedUploads.has(upload.id))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit).map(cloneUpload);
  }

  async markUploadReleased(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
  ) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.organizationId !== principal.organizationId || !sameScope(upload, scope) ||
        (upload.status !== "expired" && upload.status !== "cancelled") || this.releasedUploads.has(uploadId)) {
      return false;
    }
    this.releasedUploads.add(uploadId);
    return true;
  }

  async listPendingMultipartUploads(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    now: Date,
  ) {
    return [...this.uploads.values()].filter((upload) =>
      upload.organizationId === principal.organizationId && sameScope(upload, scope) &&
      upload.kind === "multipart" && upload.status === "pending" && upload.expiresAt > now)
      .map(cloneUpload);
  }

  async listObjectLog(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    input: ProjectStorageLogQuery,
  ) {
    return this.objectLogRows(principal, scope, input.bucketId)
      .filter((object) => (!input.status || object.status === input.status) &&
        (!input.cursor || afterObjectLogCursor(object, input.cursor)))
      .sort(compareObjectLogOrder).slice(0, input.limit).map(cloneObject);
  }

  async countObjectLog(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId?: string,
  ) {
    const counts = emptyObjectLogCounts();
    for (const object of this.objectLogRows(principal, scope, bucketId)) counts[object.status] += 1;
    return counts;
  }

  private objectLogRows(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId?: string,
  ): ProjectStorageObject[] {
    return [...this.objects.values()].filter((object) =>
      object.organizationId === principal.organizationId && sameScope(object, scope) &&
      (!bucketId || object.bucketId === bucketId));
  }

  private releaseExpiredReservations(bucket: ProjectStorageBucket, now: Date) {
    let changed = false;
    for (const upload of this.uploads.values()) {
      if (upload.bucketId === bucket.id && upload.status === "pending" && upload.expiresAt <= now) {
        upload.status = "expired";
        bucket.reservedBytes = Math.max(0, bucket.reservedBytes - upload.sizeBytes);
        changed = true;
      }
    }
    if (changed) bucket.updatedAt = new Date(now);
  }

  private releaseObjectUsage(object: ProjectStorageObject, now: Date) {
    const bucket = this.buckets.get(object.bucketId);
    if (bucket) {
      bucket.usedBytes = Math.max(0, bucket.usedBytes - object.sizeBytes);
      bucket.updatedAt = new Date(now);
    }
  }
}

function sameScope(left: ProjectStorageScope, right: ProjectStorageScope): boolean {
  return left.organizationId === right.organizationId && left.projectId === right.projectId &&
    left.environment === right.environment;
}

function sameUploadObject(upload: ProjectStorageUpload, object: ProjectStorageObject): boolean {
  return sameScope(upload, object) && upload.bucketId === object.bucketId && upload.objectKey === object.key &&
    upload.providerKey === object.providerKey && upload.ownerSubject === object.ownerSubject &&
    upload.contentType === object.contentType && upload.sizeBytes === object.sizeBytes &&
    upload.checksumSha256 === object.checksumSha256;
}

function cloneBucket(bucket: ProjectStorageBucket): ProjectStorageBucket {
  return { ...bucket, allowedMimeTypes: [...bucket.allowedMimeTypes], createdAt: new Date(bucket.createdAt), updatedAt: new Date(bucket.updatedAt) };
}

function cloneUpload(upload: ProjectStorageUpload): ProjectStorageUpload {
  return { ...upload, createdAt: new Date(upload.createdAt), expiresAt: new Date(upload.expiresAt), completedAt: upload.completedAt ? new Date(upload.completedAt) : null };
}

function cloneObject(object: ProjectStorageObject): ProjectStorageObject {
  return { ...object, createdAt: new Date(object.createdAt), deleteAfter: object.deleteAfter ? new Date(object.deleteAfter) : null, deletedAt: object.deletedAt ? new Date(object.deletedAt) : null };
}

type GlobalMemoryBuckets = typeof globalThis & {
  __qkernMemoryProjectStorageBuckets?: MemoryProjectStorageRepository;
};

/**
 * Die eine Bucket-Ablage des Modus `memory`.
 *
 * **Der Befund, der dahinter steht (2.127).** `createProjectStorageServiceFromEnv`
 * und `createProjectStorageS3AccessKeyService` bauten sich im Modus `memory` je
 * eine eigene `MemoryProjectStorageRepository`. Die Maps liegen in der Instanz
 * und nicht im Modul, also sah der Schluesseldienst von einem Bucket, den der
 * Storage-Dienst angelegt hatte, nichts: `listBuckets` gab eine leere Liste, und
 * ein Paar fuer diesen Bucket fiel mit `STORAGE_RESOURCE_NOT_FOUND`. Der
 * S3-Endpunkt war im Modus `memory` damit gar nicht benutzbar, und das ist der
 * Modus der Entwicklungsumgebung.
 *
 * Im Modus `postgres` stellt sich die Frage nicht: Dort teilen beide Dienste die
 * Datenbank, und zwei Repository-Instanzen lesen dieselben Zeilen.
 *
 * Am `globalThis` und nicht als Modulvariable, aus demselben Grund wie bei den
 * Dienst-Zwischenspeichern daneben: Next laedt ein Modul je Bundle neu, und zwei
 * Kopien derselben Datei haetten wieder zwei Ablagen.
 */
export function getMemoryProjectStorageRepository(): MemoryProjectStorageRepository {
  const runtime = globalThis as GlobalMemoryBuckets;
  runtime.__qkernMemoryProjectStorageBuckets ??= new MemoryProjectStorageRepository();
  return runtime.__qkernMemoryProjectStorageBuckets;
}
