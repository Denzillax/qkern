import { recognisedByName } from "@/lib/server/errors/identity";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import type {
  ProjectStorageBucket,
  ProjectStorageLogEntry,
  ProjectStorageObject,
  ProjectStorageObjectStatus,
  ProjectStoragePrincipal,
  ProjectStorageReadPolicy,
  ProjectStorageScope,
  ProjectStorageWritePolicy,
  PublicProjectStorageBucket,
  PublicProjectStorageObject,
} from "@/lib/server/project-storage/model";
import {
  projectStorageLogEntry,
  publicStorageBucket,
  publicStorageObject,
} from "@/lib/server/project-storage/model";
import { DisabledUsageEmitter, type UsageEmitterPort } from "@/lib/server/usage/emitter";
import type { ProjectStorageProvider, ProjectStorageScanner } from "@/lib/server/project-storage/provider";
import { ProjectStorageProviderError } from "@/lib/server/project-storage/provider";
import {
  ProjectStorageConflictError,
  ProjectStorageQuotaError,
  type ProjectStorageLogCursor,
  type ProjectStorageRepository,
} from "@/lib/server/project-storage/repository";

/** `<Millisekunden>.<Uuid>` — der Schluessel der Seitenfolge als ein Wort. */
const LOG_CURSOR = /^(\d{1,15})\.([0-9a-fA-F-]{36})$/;

function objectStatus(value: string): ProjectStorageObjectStatus {
  if (value === "quarantined" || value === "clean" || value === "infected") return value;
  throw new ProjectStorageError("STORAGE_INVALID_INPUT");
}

function encodeObjectLogCursor(object: ProjectStorageObject): string {
  return `${object.createdAt.getTime()}.${object.id}`;
}

function decodeObjectLogCursor(value: string): ProjectStorageLogCursor {
  const match = LOG_CURSOR.exec(value);
  if (!match) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  const createdAt = new Date(Number(match[1]));
  if (Number.isNaN(createdAt.getTime())) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  return { createdAt, id: match[2] };
}

const COMPLETION_TOKEN = /^qk_upload_[A-Za-z0-9_-]{43}$/;
const CHECKSUM_SHA256 = /^[A-Za-z0-9+/]{43}=$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9*][a-z0-9!#$&^_.+*-]{0,126}$/;
const ACTIVE_CONTENT_TYPES = new Set([
  "text/html", "application/xhtml+xml", "image/svg+xml", "application/javascript",
  "text/javascript", "application/xml", "text/xml", "application/x-shockwave-flash",
]);
const SAFE_WILDCARDS = new Set(["image/*", "audio/*", "video/*"]);
const MAX_OBJECT_BYTES = 5 * 1024 ** 3;
const MAX_QUOTA_BYTES = 5 * 1024 ** 4;

export type ProjectStorageErrorCode =
  | "PROJECT_STORAGE_DISABLED"
  | "STORAGE_INVALID_INPUT"
  | "STORAGE_RESOURCE_NOT_FOUND"
  | "STORAGE_ACCESS_DENIED"
  | "STORAGE_CONFLICT"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_INVALID_TOKEN"
  | "STORAGE_OBJECT_NOT_READY"
  | "STORAGE_OBJECT_INFECTED"
  | "STORAGE_PROVIDER_UNAVAILABLE";

export class ProjectStorageError extends Error {
  constructor(readonly code: ProjectStorageErrorCode) {
    super(code);
    this.name = "ProjectStorageError";
  }
}
recognisedByName(ProjectStorageError, "ProjectStorageError");

export type ProjectStorageServiceDependencies = {
  repository: ProjectStorageRepository;
  provider: ProjectStorageProvider;
  scanner: ProjectStorageScanner;
  controlPlane?: Pick<ControlPlaneService, "getProjectEnvironment">;
  /** Ohne Emitter zählt nichts — und nichts ändert sich am Verhalten. */
  usage?: UsageEmitterPort;
  now?: () => Date;
  id?: () => string;
  completionToken?: () => string;
  grantTtlSeconds?: number;
  /** Lebensdauer einer Multipart-Reservierung; Teil-Grants behalten grantTtlSeconds. */
  multipartTtlSeconds?: number;
  /**
   * Mindestalter, ab dem ein Provider-Upload ohne lebende Reservierung als
   * Waise gilt. Standard ist die Reservierungsdauer: Was aelter ist als jede
   * moegliche Reservierung und keiner gehoert, gehoert niemandem.
   */
  multipartOrphanAgeSeconds?: number;
};

export class ProjectStorageService {
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly completionToken: () => string;
  private readonly grantTtlSeconds: number;
  private readonly multipartTtlSeconds: number;
  private readonly multipartOrphanAgeSeconds: number;
  private readonly usage: UsageEmitterPort;

  constructor(private readonly dependencies: ProjectStorageServiceDependencies) {
    this.usage = dependencies.usage ?? new DisabledUsageEmitter();
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? (() => randomUUID());
    this.completionToken = dependencies.completionToken ??
      (() => `qk_upload_${randomBytes(32).toString("base64url")}`);
    this.grantTtlSeconds = dependencies.grantTtlSeconds ?? 300;
    if (!Number.isInteger(this.grantTtlSeconds) || this.grantTtlSeconds < 30 || this.grantTtlSeconds > 900) {
      throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    }
    // Fortsetzbar heisst: laenger als ein einzelner Grant. Ein 5-GiB-Upload
    // ueber eine langsame Leitung ueberlebt keine 300 Sekunden.
    this.multipartTtlSeconds = dependencies.multipartTtlSeconds ?? 21_600;
    if (!Number.isInteger(this.multipartTtlSeconds) ||
        this.multipartTtlSeconds < this.grantTtlSeconds || this.multipartTtlSeconds > 86_400) {
      throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    }
    this.multipartOrphanAgeSeconds = dependencies.multipartOrphanAgeSeconds ?? this.multipartTtlSeconds;
    if (!Number.isInteger(this.multipartOrphanAgeSeconds) ||
        this.multipartOrphanAgeSeconds < 0 || this.multipartOrphanAgeSeconds > 604_800) {
      throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    }
  }

  async listBuckets(principal: ProjectStoragePrincipal, scope: ProjectStorageScope) {
    assertPrincipal(principal, scope);
    const buckets = await this.dependencies.repository.listBuckets(principal, scope);
    return buckets.filter((bucket) => principal.role === "admin" || canRead(bucket, principal, null) ||
      canWrite(bucket, principal, null)).map(publicStorageBucket);
  }

  async createBucket(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, input: {
    name: string;
    readPolicy?: ProjectStorageReadPolicy;
    writePolicy?: ProjectStorageWritePolicy;
    allowedMimeTypes?: string[];
    maxObjectBytes?: number;
    quotaBytes?: number;
    retentionDays?: number | null;
  }): Promise<PublicProjectStorageBucket> {
    await this.assertAdminScope(principal, scope);
    const now = this.now();
    const name = input.name.trim();
    const allowedMimeTypes = validateMimeAllowlist(input.allowedMimeTypes ?? [
      "image/jpeg", "image/png", "image/webp", "application/pdf",
    ]);
    const maxObjectBytes = integer(input.maxObjectBytes ?? 10 * 1024 ** 2, 1, MAX_OBJECT_BYTES);
    const quotaBytes = integer(input.quotaBytes ?? 1024 ** 3, maxObjectBytes, MAX_QUOTA_BYTES);
    const retentionDays = optionalInteger(input.retentionDays ?? null, 1, 3650);
    if (!BUCKET_NAME.test(name)) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    const bucket: ProjectStorageBucket = {
      ...scope,
      id: this.id(),
      name,
      readPolicy: validateReadPolicy(input.readPolicy ?? "private"),
      writePolicy: validateWritePolicy(input.writePolicy ?? "private"),
      allowedMimeTypes,
      maxObjectBytes,
      quotaBytes,
      usedBytes: 0,
      reservedBytes: 0,
      retentionDays,
      createdAt: now,
      updatedAt: now,
    };
    try {
      return publicStorageBucket(await this.dependencies.repository.createBucket(principal, bucket));
    } catch (error) { throw mapStorageError(error); }
  }

  async updateBucket(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketId: string, input: {
    readPolicy: ProjectStorageReadPolicy;
    writePolicy: ProjectStorageWritePolicy;
    allowedMimeTypes: string[];
    maxObjectBytes: number;
    quotaBytes: number;
    retentionDays: number | null;
  }): Promise<PublicProjectStorageBucket> {
    await this.assertAdminScope(principal, scope);
    assertIdentifier(bucketId);
    const patch = {
      readPolicy: validateReadPolicy(input.readPolicy),
      writePolicy: validateWritePolicy(input.writePolicy),
      allowedMimeTypes: validateMimeAllowlist(input.allowedMimeTypes),
      maxObjectBytes: integer(input.maxObjectBytes, 1, MAX_OBJECT_BYTES),
      quotaBytes: integer(input.quotaBytes, 1, MAX_QUOTA_BYTES),
      retentionDays: optionalInteger(input.retentionDays, 1, 3650),
      updatedAt: this.now(),
    };
    if (patch.quotaBytes < patch.maxObjectBytes) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    try {
      const bucket = await this.dependencies.repository.updateBucket(principal, scope, bucketId, patch);
      if (!bucket) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
      return publicStorageBucket(bucket);
    } catch (error) { throw mapStorageError(error); }
  }

  async deleteBucket(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketId: string) {
    await this.assertAdminScope(principal, scope);
    assertIdentifier(bucketId);
    try {
      if (!await this.dependencies.repository.deleteBucket(principal, scope, bucketId)) {
        throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
      }
      return { deleted: true as const };
    } catch (error) { throw mapStorageError(error); }
  }

  async prepareUpload(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketIdOrName: string, input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    checksumSha256: string;
  }) {
    assertPrincipal(principal, scope);
    const bucket = await this.bucket(principal, scope, bucketIdOrName);
    if (!canWrite(bucket, principal, null)) throw new ProjectStorageError("STORAGE_ACCESS_DENIED");
    const key = validateObjectKey(input.key);
    const contentType = validateObjectContentType(input.contentType, bucket.allowedMimeTypes);
    const sizeBytes = integer(input.sizeBytes, 1, Math.min(bucket.maxObjectBytes, MAX_OBJECT_BYTES));
    const checksumSha256 = validateChecksum(input.checksumSha256);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.grantTtlSeconds * 1_000);
    const completionToken = this.completionToken();
    if (!COMPLETION_TOKEN.test(completionToken)) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    const uploadId = this.id();
    const providerKey = storageProviderKey(scope, bucket.id, uploadId, key);
    const upload = {
      ...scope,
      id: uploadId,
      bucketId: bucket.id,
      objectKey: key,
      providerKey,
      ownerSubject: boundedSubject(principal.subject),
      contentType,
      sizeBytes,
      checksumSha256,
      kind: "single" as const,
      providerUploadId: null,
      completionTokenHash: hashStorageToken(completionToken),
      status: "pending" as const,
      createdAt: now,
      expiresAt,
      completedAt: null,
      objectId: null,
    };
    try {
      await this.dependencies.repository.reserveUpload(principal, scope, upload, now);
      try {
        const grant = await this.dependencies.provider.createUploadGrant({
          providerKey, contentType, checksumSha256, sizeBytes, expiresAt,
        });
        return {
          uploadId,
          completionToken,
          key,
          requiredSizeBytes: sizeBytes,
          requiredContentType: contentType,
          requiredChecksumSha256: checksumSha256,
          upload: { ...grant, expiresAt: grant.expiresAt.toISOString() },
        };
      } catch (error) {
        await this.dependencies.repository.cancelUpload(
          principal, scope, uploadId, upload.completionTokenHash, "cancelled", now,
        ).catch(() => undefined);
        throw error;
      }
    } catch (error) { throw mapStorageError(error); }
  }

  /**
   * Fortsetzbarer Upload — Reservierung plus Provider-Upload-Kennung.
   *
   * Die Pruefsumme ist die der **ganzen** Datei. Der Provider prueft je Teil
   * (signierter Header, Release 1.69); die volle Summe rechnet der Scanner
   * beim Abschluss nach, und nur dieser Abgleich macht das Objekt sauber.
   */
  async prepareMultipartUpload(principal: ProjectStoragePrincipal, scope: ProjectStorageScope,
    bucketIdOrName: string, input: {
      key: string;
      contentType: string;
      sizeBytes: number;
      checksumSha256: string;
    }) {
    assertPrincipal(principal, scope);
    const bucket = await this.bucket(principal, scope, bucketIdOrName);
    if (!canWrite(bucket, principal, null)) throw new ProjectStorageError("STORAGE_ACCESS_DENIED");
    const key = validateObjectKey(input.key);
    const contentType = validateObjectContentType(input.contentType, bucket.allowedMimeTypes);
    const sizeBytes = integer(input.sizeBytes, 1, Math.min(bucket.maxObjectBytes, MAX_OBJECT_BYTES));
    const checksumSha256 = validateChecksum(input.checksumSha256);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.multipartTtlSeconds * 1_000);
    const completionToken = this.completionToken();
    if (!COMPLETION_TOKEN.test(completionToken)) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    const uploadId = this.id();
    const providerKey = storageProviderKey(scope, bucket.id, uploadId, key);
    try {
      const created = await this.dependencies.provider.createMultipartUpload({ providerKey, contentType });
      const upload = {
        ...scope,
        id: uploadId,
        bucketId: bucket.id,
        objectKey: key,
        providerKey,
        kind: "multipart" as const,
        providerUploadId: created.uploadId,
        ownerSubject: boundedSubject(principal.subject),
        contentType,
        sizeBytes,
        checksumSha256,
        completionTokenHash: hashStorageToken(completionToken),
        status: "pending" as const,
        createdAt: now,
        expiresAt,
        completedAt: null,
        objectId: null,
      };
      try {
        await this.dependencies.repository.reserveUpload(principal, scope, upload, now);
      } catch (error) {
        // Die Reservierung traegt Schluessel-Eindeutigkeit und Quota. Ohne sie
        // darf beim Provider nichts liegen bleiben.
        await this.dependencies.provider.abortMultipartUpload({
          providerKey, uploadId: created.uploadId,
        }).catch(() => undefined);
        throw error;
      }
      return {
        uploadId,
        completionToken,
        key,
        requiredSizeBytes: sizeBytes,
        requiredContentType: contentType,
        requiredChecksumSha256: checksumSha256,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) { throw mapStorageError(error); }
  }

  /** Eine signierte URL je Teil; die Teil-Pruefsumme steckt in der Signatur. */
  async createPartUploadGrant(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, input: {
    uploadId: string;
    completionToken: string;
    partNumber: number;
    checksumSha256: string;
  }) {
    assertPrincipal(principal, scope);
    const upload = await this.multipartUpload(principal, scope, input.uploadId, input.completionToken);
    const partNumber = integer(input.partNumber, 1, 10_000);
    const checksumSha256 = validateChecksum(input.checksumSha256);
    const now = this.now();
    // Nur eine lebende Reservierung stellt Teil-URLs aus: Ein abgebrochener
    // oder abgeschlossener Upload hat beim Provider nichts mehr, worauf eine
    // Signatur zeigen koennte.
    if (upload.status !== "pending" || upload.expiresAt <= now) {
      throw new ProjectStorageError("STORAGE_INVALID_TOKEN");
    }
    const expiresAt = new Date(Math.min(
      now.getTime() + this.grantTtlSeconds * 1_000, upload.expiresAt.getTime()));
    try {
      const grant = await this.dependencies.provider.createPartUploadGrant({
        providerKey: upload.providerKey,
        uploadId: upload.providerUploadId!,
        partNumber,
        checksumSha256,
        expiresAt,
      });
      return { partNumber, ...grant, expiresAt: grant.expiresAt.toISOString() };
    } catch (error) { throw mapStorageError(error); }
  }

  async completeMultipartUpload(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, input: {
    uploadId: string;
    completionToken: string;
    parts: ReadonlyArray<{ partNumber: number; etag: string }>;
  }): Promise<PublicProjectStorageObject> {
    assertPrincipal(principal, scope);
    const upload = await this.multipartUpload(principal, scope, input.uploadId, input.completionToken);
    const tokenHash = hashStorageToken(input.completionToken);
    if (upload.status === "completed" && upload.objectId) {
      const existing = await this.dependencies.repository.findObject(principal, scope, upload.bucketId, upload.objectId);
      if (existing) return publicStorageObject(existing);
    }
    const now = this.now();
    if (upload.status !== "pending" || upload.expiresAt <= now) {
      if (upload.status === "pending") {
        await this.dependencies.repository.cancelUpload(principal, scope, upload.id, tokenHash, "expired", now);
        await this.dependencies.provider.abortMultipartUpload({
          providerKey: upload.providerKey, uploadId: upload.providerUploadId!,
        }).catch(() => undefined);
      }
      throw new ProjectStorageError("STORAGE_INVALID_TOKEN");
    }
    if (input.parts.length < 1 || input.parts.length > 10_000) {
      throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    }
    try {
      await this.dependencies.provider.completeMultipartUpload({
        providerKey: upload.providerKey,
        uploadId: upload.providerUploadId!,
        parts: input.parts,
      });
    } catch (error) { throw mapStorageError(error); }
    let providerObject;
    try { providerObject = await this.dependencies.provider.headObject(upload.providerKey); }
    catch (error) { throw mapStorageError(error); }
    if (!providerObject) throw new ProjectStorageError("STORAGE_OBJECT_NOT_READY");
    // Groesse und Typ prueft der HEAD exakt. Die Pruefsumme dort ist bei
    // Multipart eine zusammengesetzte je Teil — die **ganze** Datei rechnet
    // der Scanner nach, und ohne diesen Abgleich bleibt das Objekt in
    // Quarantaene. Deshalb fehlt hier absichtlich der Pruefsummenvergleich
    // des einfachen Wegs.
    if (providerObject.sizeBytes !== upload.sizeBytes || providerObject.contentType !== upload.contentType) {
      await this.dependencies.provider.deleteObject(upload.providerKey).catch(() => undefined);
      await this.dependencies.repository.cancelUpload(principal, scope, upload.id, tokenHash, "cancelled", now);
      throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    }
    let verdict;
    try {
      verdict = await this.dependencies.scanner.scan({
        providerKey: upload.providerKey,
        contentType: upload.contentType,
        sizeBytes: upload.sizeBytes,
        checksumSha256: upload.checksumSha256,
      });
    } catch { verdict = "pending" as const; }
    if (verdict === "infected") {
      await this.dependencies.provider.deleteObject(upload.providerKey).catch(() => undefined);
      await this.dependencies.repository.cancelUpload(principal, scope, upload.id, tokenHash, "cancelled", now);
      throw new ProjectStorageError("STORAGE_OBJECT_INFECTED");
    }
    const bucket = await this.bucket(principal, scope, upload.bucketId);
    const object: ProjectStorageObject = {
      ...scope,
      id: this.id(),
      bucketId: upload.bucketId,
      key: upload.objectKey,
      ownerSubject: upload.ownerSubject,
      providerKey: upload.providerKey,
      sizeBytes: upload.sizeBytes,
      contentType: upload.contentType,
      checksumSha256: upload.checksumSha256,
      etag: providerObject.etag,
      status: verdict === "clean" ? "clean" : "quarantined",
      createdAt: now,
      deleteAfter: bucket.retentionDays === null ? null :
        new Date(now.getTime() + bucket.retentionDays * 24 * 60 * 60 * 1_000),
      deletedAt: null,
    };
    try {
      return publicStorageObject(await this.dependencies.repository.completeUpload(
        principal, scope, upload.id, tokenHash, object, now,
      ));
    } catch (error) {
      if (error instanceof ProjectStorageConflictError) {
        await this.dependencies.provider.deleteObject(upload.providerKey).catch(() => undefined);
        await this.dependencies.repository.cancelUpload(
          principal, scope, upload.id, tokenHash, "cancelled", now,
        ).catch(() => undefined);
      }
      throw mapStorageError(error);
    }
  }

  /** Bricht ab und laesst nichts zurueck — weder Teile noch Reservierung. */
  async abortMultipartUpload(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, input: {
    uploadId: string;
    completionToken: string;
  }): Promise<void> {
    assertPrincipal(principal, scope);
    const upload = await this.multipartUpload(principal, scope, input.uploadId, input.completionToken);
    if (upload.status !== "pending") return;
    const tokenHash = hashStorageToken(input.completionToken);
    try {
      await this.dependencies.provider.abortMultipartUpload({
        providerKey: upload.providerKey, uploadId: upload.providerUploadId!,
      });
      await this.dependencies.repository.cancelUpload(
        principal, scope, upload.id, tokenHash, "cancelled", this.now());
    } catch (error) { throw mapStorageError(error); }
  }

  private async multipartUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    completionToken: string,
  ) {
    assertIdentifier(uploadId);
    if (!COMPLETION_TOKEN.test(completionToken)) throw new ProjectStorageError("STORAGE_INVALID_TOKEN");
    const upload = await this.dependencies.repository.findUploadByToken(
      principal, scope, uploadId, hashStorageToken(completionToken));
    if (!upload) throw new ProjectStorageError("STORAGE_INVALID_TOKEN");
    if (upload.kind !== "multipart" || !upload.providerUploadId) {
      throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    }
    return upload;
  }

  async completeUpload(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, input: {
    uploadId: string;
    completionToken: string;
  }): Promise<PublicProjectStorageObject> {
    assertPrincipal(principal, scope);
    assertIdentifier(input.uploadId);
    if (!COMPLETION_TOKEN.test(input.completionToken)) throw new ProjectStorageError("STORAGE_INVALID_TOKEN");
    const tokenHash = hashStorageToken(input.completionToken);
    const upload = await this.dependencies.repository.findUploadByToken(principal, scope, input.uploadId, tokenHash);
    if (!upload) throw new ProjectStorageError("STORAGE_INVALID_TOKEN");
    // Ein fortsetzbarer Upload braucht seine Teileliste; dieser Abschluss
    // wuerde sie verschweigen und der Provider den Abschluss ablehnen — die
    // Abweisung hier macht den Fehler zu einem des Aufrufs, nicht des Providers.
    if (upload.kind !== "single") throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    if (upload.status === "completed" && upload.objectId) {
      const existing = await this.dependencies.repository.findObject(principal, scope, upload.bucketId, upload.objectId);
      if (existing) return publicStorageObject(existing);
    }
    const now = this.now();
    if (upload.status !== "pending" || upload.expiresAt <= now) {
      if (upload.status === "pending") {
        await this.dependencies.repository.cancelUpload(principal, scope, upload.id, tokenHash, "expired", now);
      }
      throw new ProjectStorageError("STORAGE_INVALID_TOKEN");
    }
    let providerObject;
    try { providerObject = await this.dependencies.provider.headObject(upload.providerKey); }
    catch (error) { throw mapStorageError(error); }
    if (!providerObject) throw new ProjectStorageError("STORAGE_OBJECT_NOT_READY");
    if (providerObject.sizeBytes !== upload.sizeBytes || providerObject.contentType !== upload.contentType ||
        providerObject.checksumSha256 !== upload.checksumSha256) {
      await this.dependencies.provider.deleteObject(upload.providerKey).catch(() => undefined);
      await this.dependencies.repository.cancelUpload(principal, scope, upload.id, tokenHash, "cancelled", now);
      throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    }
    let verdict;
    try {
      verdict = await this.dependencies.scanner.scan({
        providerKey: upload.providerKey,
        contentType: upload.contentType,
        sizeBytes: upload.sizeBytes,
        checksumSha256: upload.checksumSha256,
      });
    } catch { verdict = "pending" as const; }
    if (verdict === "infected") {
      await this.dependencies.provider.deleteObject(upload.providerKey).catch(() => undefined);
      await this.dependencies.repository.cancelUpload(principal, scope, upload.id, tokenHash, "cancelled", now);
      throw new ProjectStorageError("STORAGE_OBJECT_INFECTED");
    }
    const bucket = await this.bucket(principal, scope, upload.bucketId);
    const object: ProjectStorageObject = {
      ...scope,
      id: this.id(),
      bucketId: upload.bucketId,
      key: upload.objectKey,
      ownerSubject: upload.ownerSubject,
      providerKey: upload.providerKey,
      sizeBytes: upload.sizeBytes,
      contentType: upload.contentType,
      checksumSha256: upload.checksumSha256,
      etag: providerObject.etag,
      status: verdict === "clean" ? "clean" : "quarantined",
      createdAt: now,
      deleteAfter: bucket.retentionDays === null ? null :
        new Date(now.getTime() + bucket.retentionDays * 24 * 60 * 60 * 1_000),
      deletedAt: null,
    };
    try {
      return publicStorageObject(await this.dependencies.repository.completeUpload(
        principal, scope, upload.id, tokenHash, object, now,
      ));
    } catch (error) {
      if (error instanceof ProjectStorageConflictError) {
        // A grant can expire while provider verification or malware scanning is
        // still running. If the fenced metadata commit then loses the race, the
        // provider object must not be left orphaned and a still-pending
        // reservation must be released. Concurrent successful replay returns the
        // existing object from the repository and never enters this branch.
        await this.dependencies.provider.deleteObject(upload.providerKey).catch(() => undefined);
        await this.dependencies.repository.cancelUpload(
          principal, scope, upload.id, tokenHash, "cancelled", this.now(),
        ).catch(() => undefined);
      }
      throw mapStorageError(error);
    }
  }

  async listObjects(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketIdOrName: string, input: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }) {
    assertPrincipal(principal, scope);
    const bucket = await this.bucket(principal, scope, bucketIdOrName);
    if (!canRead(bucket, principal, null)) throw new ProjectStorageError("STORAGE_ACCESS_DENIED");
    const prefix = input.prefix ? validateObjectPrefix(input.prefix) : "";
    const cursor = input.cursor ? validateObjectKey(input.cursor) : undefined;
    const limit = integer(input.limit ?? 50, 1, 100);
    const candidates = await this.dependencies.repository.listObjects(principal, scope, bucket.id, {
      prefix, cursor, limit: limit + 1,
      includeUnsafe: principal.role === "admin",
      ownerSubject: bucket.readPolicy === "owner" && principal.role !== "admin" ? principal.subject : undefined,
    });
    const visible = candidates.filter((object) => canRead(bucket, principal, object) &&
      (principal.role === "admin" || object.status === "clean"));
    const page = visible.slice(0, limit);
    return {
      objects: page.map(publicStorageObject),
      nextCursor: visible.length > limit ? page.at(-1)?.key ?? null : null,
    };
  }

  /**
   * Der Stand der Objekte einer Umgebung fuer die Console (2.51).
   *
   * Kein Zugriffsprotokoll: QKERN schreibt weder Upload noch Download je
   * Objekt in eine Ereignistabelle. Was es gibt, ist die Zeile in
   * `project_storage_objects` — Bucket, Schluessel, Groesse, Typ, das letzte
   * Urteil des Scanners und drei Zeitpunkte. Genau das liefert diese Lesung,
   * ohne Provider-Schluessel, ohne Pruefsumme und ohne signierte Adresse.
   *
   * Nur Admins. Die anwendungsseitige Sicht auf Objekte bleibt
   * `listObjects`, und dort sieht ein Mandant weiterhin nur saubere.
   */
  async readObjectLog(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, input: {
    bucket?: string;
    status?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    entries: ProjectStorageLogEntry[];
    counts: Record<ProjectStorageObjectStatus, number>;
    nextCursor: string | null;
    buckets: Array<{ id: string; name: string }>;
  }> {
    await this.assertAdminScope(principal, scope);
    const status = input.status === undefined ? undefined : objectStatus(input.status);
    const cursor = input.cursor === undefined ? undefined : decodeObjectLogCursor(input.cursor);
    const limit = integer(input.limit ?? 50, 1, 100);
    const buckets = await this.dependencies.repository.listBuckets(principal, scope);
    const names = new Map(buckets.map((bucket) => [bucket.id, bucket.name] as const));
    let bucketId: string | undefined;
    if (input.bucket !== undefined) {
      const chosen = buckets.find((entry) => entry.id === input.bucket || entry.name === input.bucket);
      if (!chosen) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
      bucketId = chosen.id;
    }
    const rows = await this.dependencies.repository.listObjectLog(principal, scope, {
      bucketId, status, limit: limit + 1, cursor,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      entries: page.map((object) => projectStorageLogEntry(object, names.get(object.bucketId) ?? "")),
      counts: await this.dependencies.repository.countObjectLog(principal, scope, bucketId),
      nextCursor: rows.length > limit && last ? encodeObjectLogCursor(last) : null,
      buckets: buckets.map((bucket) => ({ id: bucket.id, name: bucket.name })),
    };
  }

  async createDownloadGrant(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketIdOrName: string, input: {
    key: string;
    expiresInSeconds?: number;
    downloadName?: string;
  }) {
    assertPrincipal(principal, scope);
    const bucket = await this.bucket(principal, scope, bucketIdOrName);
    const key = validateObjectKey(input.key);
    const object = await this.dependencies.repository.findObject(principal, scope, bucket.id, key);
    if (!object || !canRead(bucket, principal, object)) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
    if (object.status !== "clean") throw new ProjectStorageError("STORAGE_OBJECT_NOT_READY");
    const ttl = integer(input.expiresInSeconds ?? this.grantTtlSeconds, 30, 900);
    try {
      const grant = await this.dependencies.provider.createDownloadGrant({
        providerKey: object.providerKey,
        expiresAt: new Date(this.now().getTime() + ttl * 1_000),
        downloadName: input.downloadName,
      });
      // **Freigegebene**, nicht ausgelieferte Bytes. Die Auslieferung übernimmt
      // der Provider direkt; QKERN sieht sie nie und könnte sie nur schätzen.
      // Eine Freigabe, die niemand einlöst, zählt deshalb mit — das ist die
      // ehrliche Beschreibung dessen, was gemessen wird, und der Grund, warum
      // diese Zahl kein Abrechnungsbeleg ist.
      //
      // Nicht gegated: Die Menge steht erst hier fest, und `enforce` lässt sich
      // für diese Metrik gar nicht setzen.
      if (object.sizeBytes >= 1) {
        await this.usage.admit(scope, {
          metric: "storage_egress_bytes", quantity: object.sizeBytes, reference: this.id(),
        });
      }
      return { ...grant, expiresAt: grant.expiresAt.toISOString() };
    } catch (error) { throw mapStorageError(error); }
  }

  async deleteObject(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketIdOrName: string, key: string) {
    assertPrincipal(principal, scope);
    const bucket = await this.bucket(principal, scope, bucketIdOrName);
    const normalizedKey = validateObjectKey(key);
    const object = await this.dependencies.repository.findObject(principal, scope, bucket.id, normalizedKey);
    if (!object || !canWrite(bucket, principal, object)) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
    try {
      await this.dependencies.provider.deleteObject(object.providerKey);
      const deleted = await this.dependencies.repository.markObjectDeleted(principal, scope, object.id, this.now());
      if (!deleted) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
      return { deleted: true as const, object: publicStorageObject(deleted) };
    } catch (error) { throw mapStorageError(error); }
  }

  async scanObject(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, objectId: string) {
    await this.assertAdminScope(principal, scope);
    assertIdentifier(objectId);
    const buckets = await this.dependencies.repository.listBuckets(principal, scope);
    let object: ProjectStorageObject | null = null;
    for (const bucket of buckets) {
      object = await this.dependencies.repository.findObject(principal, scope, bucket.id, objectId);
      if (object) break;
    }
    if (!object) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
    let verdict;
    try {
      verdict = await this.dependencies.scanner.scan({
        providerKey: object.providerKey,
        contentType: object.contentType,
        sizeBytes: object.sizeBytes,
        checksumSha256: object.checksumSha256,
      });
    } catch { verdict = "pending" as const; }
    if (verdict === "pending") return publicStorageObject(object);
    if (verdict === "infected") await this.dependencies.provider.deleteObject(object.providerKey).catch(() => undefined);
    const updated = await this.dependencies.repository.setObjectStatus(principal, scope, object.id, verdict, this.now());
    if (!updated) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
    return publicStorageObject(updated);
  }

  async expireLifecycle(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, limit = 50) {
    await this.assertAdminScope(principal, scope);
    const now = this.now();
    const expired = await this.dependencies.repository.listExpiredObjects(
      principal, scope, now, integer(limit, 1, 100),
    );
    let deleted = 0;
    for (const object of expired) {
      try {
        await this.dependencies.provider.deleteObject(object.providerKey);
        if (await this.dependencies.repository.markObjectDeleted(principal, scope, object.id, now)) deleted += 1;
      } catch { /* leave metadata for the next bounded retry */ }
    }
    // Verfallene Reservierungen: Quota freigeben und dem Provider Bescheid
    // sagen — bis 1.78 verfielen sie nur lazy beim naechsten reserveUpload,
    // und der begonnene Provider-Upload blieb fuer immer liegen.
    let expiredUploads = 0;
    let orphanedUploadsAborted = 0;
    try {
      const stale = await this.dependencies.repository.expireUploads(
        principal, scope, now, integer(limit, 1, 100),
      );
      expiredUploads = stale.length;
      for (const upload of stale) {
        if (upload.kind !== "multipart" || !upload.providerUploadId) continue;
        await this.dependencies.provider.abortMultipartUpload({
          providerKey: upload.providerKey, uploadId: upload.providerUploadId,
        }).catch(() => undefined); // das Waisen-Netz unten faengt den naechsten Lauf
      }
      // Provider-Waisen: begonnene Multipart-Uploads, die alt genug sind und
      // zu keiner lebenden Reservierung gehoeren. Das faengt jeden
      // Strandungsweg — Absturz vor der Reservierung, lazy verfallene
      // Reservierungen, fehlgeschlagene Abbrueche.
      const pending = await this.dependencies.repository.listPendingMultipartUploads(principal, scope, now);
      const alive = new Set(pending.map((upload) => `${upload.providerKey}\n${upload.providerUploadId}`));
      const started = await this.dependencies.provider.listMultipartUploads({
        keyPrefix: `${scope.organizationId}/${scope.projectId}/${scope.environment}/`,
      });
      for (const candidate of started) {
        if (alive.has(`${candidate.providerKey}\n${candidate.uploadId}`)) continue;
        if (now.getTime() - candidate.initiatedAt.getTime() < this.multipartOrphanAgeSeconds * 1_000) continue;
        try {
          await this.dependencies.provider.abortMultipartUpload({
            providerKey: candidate.providerKey, uploadId: candidate.uploadId,
          });
          orphanedUploadsAborted += 1;
        } catch { /* naechster Lauf */ }
      }
    } catch { /* Objekt-Aufraeumen oben gilt trotzdem; naechster Lauf */ }
    return { examined: expired.length, deleted, expiredUploads, orphanedUploadsAborted };
  }

  private async bucket(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, idOrName: string) {
    if (!idOrName || idOrName.length > 128) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
    const bucket = await this.dependencies.repository.findBucket(principal, scope, idOrName);
    if (!bucket) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
    return bucket;
  }

  private async assertAdminScope(principal: ProjectStoragePrincipal, scope: ProjectStorageScope) {
    assertPrincipal(principal, scope);
    if (principal.role !== "admin") throw new ProjectStorageError("STORAGE_ACCESS_DENIED");
    if (this.dependencies.controlPlane) {
      await this.dependencies.controlPlane.getProjectEnvironment({
        organizationId: scope.organizationId,
        actor: { id: principal.subject, ref: principal.actorRef, type: "user" },
      }, scope.projectId, scope.environment).catch(() => {
        throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
      });
    }
  }
}

export function hashStorageToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function assertPrincipal(principal: ProjectStoragePrincipal, scope: ProjectStorageScope) {
  if (!principal.organizationId || principal.organizationId !== scope.organizationId || !principal.actorRef ||
      !principal.subject || !scope.projectId || !["development", "staging", "production"].includes(scope.environment) ||
      !["admin", "authenticated", "anon", "service_role"].includes(principal.role)) {
    throw new ProjectStorageError("STORAGE_ACCESS_DENIED");
  }
}

function canRead(bucket: ProjectStorageBucket, principal: ProjectStoragePrincipal, object: ProjectStorageObject | null) {
  if (principal.role === "admin") return true;
  switch (bucket.readPolicy) {
    case "public": return true;
    case "authenticated": return principal.role === "authenticated";
    case "owner": return principal.role === "authenticated" && (!object || object.ownerSubject === principal.subject);
    case "service": return principal.role === "service_role";
    case "private": return false;
  }
}

function canWrite(bucket: ProjectStorageBucket, principal: ProjectStoragePrincipal, object: ProjectStorageObject | null) {
  if (principal.role === "admin") return true;
  switch (bucket.writePolicy) {
    case "authenticated": return principal.role === "authenticated";
    case "owner": return principal.role === "authenticated" && (!object || object.ownerSubject === principal.subject);
    case "service": return principal.role === "service_role";
    case "private": return false;
  }
}

function validateReadPolicy(value: string): ProjectStorageReadPolicy {
  if (!["private", "authenticated", "owner", "public", "service"].includes(value)) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  return value as ProjectStorageReadPolicy;
}

function validateWritePolicy(value: string): ProjectStorageWritePolicy {
  if (!["private", "authenticated", "owner", "service"].includes(value)) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  return value as ProjectStorageWritePolicy;
}

function validateMimeAllowlist(values: string[]) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 20) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()))];
  if (normalized.length !== values.length || normalized.some((value) => !MIME_TYPE.test(value) ||
      value === "*/*" || (value.endsWith("/*") && !SAFE_WILDCARDS.has(value)) || ACTIVE_CONTENT_TYPES.has(value))) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  return normalized;
}

function validateObjectContentType(value: string, allowlist: string[]) {
  const contentType = value.trim().toLowerCase();
  if (!MIME_TYPE.test(contentType) || contentType.includes("*") || ACTIVE_CONTENT_TYPES.has(contentType) ||
      !allowlist.some((allowed) => allowed === contentType ||
        (allowed.endsWith("/*") && contentType.startsWith(`${allowed.slice(0, -1)}`)))) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  return contentType;
}

function validateObjectKey(value: string) {
  const key = value.trim();
  if (!OBJECT_KEY.test(key) || key.startsWith("/") || key.endsWith("/") || key.includes("//") ||
      key.split("/").some((segment) => segment === "." || segment === "..") || /[\\\0\r\n]/.test(key)) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  return key;
}

function validateObjectPrefix(value: string) {
  const prefix = value.trim();
  if (!prefix || prefix.length > 1024 || prefix.startsWith("/") || prefix.includes("//") ||
      prefix.split("/").some((segment) => segment === "." || segment === "..") || /[\\\0\r\n]/.test(prefix)) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  return prefix;
}

function validateChecksum(value: string) {
  if (!CHECKSUM_SHA256.test(value) || Buffer.from(value, "base64").length !== 32) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  return value;
}

function storageProviderKey(scope: ProjectStorageScope, bucketId: string, uploadId: string, key: string) {
  return `${scope.organizationId}/${scope.projectId}/${scope.environment}/${bucketId}/${uploadId}/${key}`;
}

function boundedSubject(value: string) {
  const subject = value.trim();
  if (!subject || subject.length > 320 || /[\0\r\n]/.test(subject)) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  return subject;
}

function assertIdentifier(value: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
}

function integer(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  return value;
}

function optionalInteger(value: number | null, min: number, max: number) {
  return value === null ? null : integer(value, min, max);
}

function mapStorageError(error: unknown): ProjectStorageError {
  if (error instanceof ProjectStorageError) return error;
  if (error instanceof ProjectStorageConflictError) return new ProjectStorageError("STORAGE_CONFLICT");
  if (error instanceof ProjectStorageQuotaError) return new ProjectStorageError("STORAGE_QUOTA_EXCEEDED");
  if (error instanceof ProjectStorageProviderError) return new ProjectStorageError("STORAGE_PROVIDER_UNAVAILABLE");
  throw error;
}
