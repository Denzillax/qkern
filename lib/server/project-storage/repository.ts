import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  ProjectStorageBucket,
  ProjectStorageObject,
  ProjectStorageObjectStatus,
  ProjectStoragePrincipal,
  ProjectStorageScope,
  ProjectStorageUpload,
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
  /** Lebende Multipart-Reservierungen — die Schutzliste des Waisen-Aufraeumers. */
  listPendingMultipartUploads(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    now: Date,
  ): Promise<ProjectStorageUpload[]>;
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
    return stale.map(cloneUpload);
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
