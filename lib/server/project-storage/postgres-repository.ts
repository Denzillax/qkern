import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import { mapPostgresError } from "@/lib/server/db/errors";
import type { SqlQueryable, SqlValue } from "@/lib/server/db/sql";
import type {
  ProjectStorageBucket,
  ProjectStorageObject,
  ProjectStorageObjectStatus,
  ProjectStoragePrincipal,
  ProjectStorageScope,
  ProjectStorageUpload,
} from "@/lib/server/project-storage/model";
import {
  ProjectStorageConflictError,
  ProjectStorageQuotaError,
  type ProjectStorageBucketPatch,
  type ProjectStorageRepository,
} from "@/lib/server/project-storage/repository";

type Row = Record<string, unknown>;
type StorageDatabase = Pick<PostgresControlPlane, "withTenant">;

export class PostgresProjectStorageRepository implements ProjectStorageRepository {
  constructor(private readonly database: StorageDatabase) {}

  listBuckets(principal: ProjectStoragePrincipal, scope: ProjectStorageScope) {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`${BUCKET_SELECT}
        WHERE organization_id = $1 AND project_id = $2 AND environment = $3
        ORDER BY name ASC LIMIT 100`, scopeValues(scope));
      return result.rows.map(bucketFromRow);
    });
  }

  findBucket(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketIdOrName: string,
  ) {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`${BUCKET_SELECT}
        WHERE organization_id = $1 AND project_id = $2 AND environment = $3
          AND (id::text = $4 OR name = $4)
        LIMIT 1`, [...scopeValues(scope), bucketIdOrName]);
      return result.rows[0] ? bucketFromRow(result.rows[0]) : null;
    });
  }

  createBucket(principal: ProjectStoragePrincipal, bucket: ProjectStorageBucket) {
    return this.withTenant(principal, false, async (database, audit) => {
      try {
        const result = await database.query(`INSERT INTO project_storage_buckets
          (id, organization_id, project_id, environment, name, read_policy, write_policy,
           allowed_mime_types, max_object_bytes, quota_bytes, used_bytes, reserved_bytes,
           retention_days, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,$11,$12,$13)
          RETURNING ${BUCKET_COLUMNS}`, [
          bucket.id, bucket.organizationId, bucket.projectId, bucket.environment, bucket.name,
          bucket.readPolicy, bucket.writePolicy, bucket.allowedMimeTypes, bucket.maxObjectBytes,
          bucket.quotaBytes, bucket.retentionDays, bucket.createdAt, bucket.updatedAt,
        ]);
        const created = bucketFromRow(result.rows[0]);
        await audit?.append({
          projectId: bucket.projectId,
          environment: bucket.environment,
          actorType: "user",
          actorRef: principal.actorRef,
          action: "project.storage.bucket.created",
          resourceRef: bucket.id,
          status: "success",
          metadata: { name: bucket.name, readPolicy: bucket.readPolicy, writePolicy: bucket.writePolicy },
        });
        return created;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") throw new ProjectStorageConflictError();
        throw mapPostgresError(error);
      }
    });
  }

  updateBucket(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId: string,
    patch: ProjectStorageBucketPatch,
  ) {
    return this.withTenant(principal, false, async (database, audit) => {
      const locked = await database.query(`${BUCKET_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
        FOR UPDATE`, [...scopeValues(scope), bucketId]);
      const current = locked.rows[0] ? bucketFromRow(locked.rows[0]) : null;
      if (!current) return null;
      if (patch.quotaBytes < current.usedBytes + current.reservedBytes) throw new ProjectStorageQuotaError();
      const result = await database.query(`UPDATE project_storage_buckets SET
        read_policy=$5, write_policy=$6, allowed_mime_types=$7, max_object_bytes=$8,
        quota_bytes=$9, retention_days=$10, updated_at=$11
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
        RETURNING ${BUCKET_COLUMNS}`, [
        ...scopeValues(scope), bucketId, patch.readPolicy, patch.writePolicy,
        patch.allowedMimeTypes, patch.maxObjectBytes, patch.quotaBytes, patch.retentionDays, patch.updatedAt,
      ]);
      const updated = result.rows[0] ? bucketFromRow(result.rows[0]) : null;
      if (updated) await audit?.append({
        projectId: scope.projectId,
        environment: scope.environment,
        actorType: "user",
        actorRef: principal.actorRef,
        action: "project.storage.bucket.updated",
        resourceRef: bucketId,
        status: "success",
        metadata: { readPolicy: updated.readPolicy, writePolicy: updated.writePolicy },
      });
      return updated;
    });
  }

  deleteBucket(principal: ProjectStoragePrincipal, scope: ProjectStorageScope, bucketId: string) {
    return this.withTenant(principal, false, async (database, audit) => {
      const result = await database.query(`DELETE FROM project_storage_buckets AS bucket
        WHERE bucket.organization_id=$1 AND bucket.project_id=$2 AND bucket.environment=$3 AND bucket.id=$4
          AND NOT EXISTS (SELECT 1 FROM project_storage_objects AS object
            WHERE object.organization_id=bucket.organization_id AND object.project_id=bucket.project_id
              AND object.environment=bucket.environment AND object.bucket_id=bucket.id AND object.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM project_storage_uploads AS upload
            WHERE upload.organization_id=bucket.organization_id AND upload.project_id=bucket.project_id
              AND upload.environment=bucket.environment AND upload.bucket_id=bucket.id AND upload.status='pending')
        RETURNING bucket.id`, [...scopeValues(scope), bucketId]);
      if (result.rows[0]) await audit?.append({
        projectId: scope.projectId,
        environment: scope.environment,
        actorType: "user",
        actorRef: principal.actorRef,
        action: "project.storage.bucket.deleted",
        resourceRef: bucketId,
        status: "success",
        metadata: {},
      });
      if (!result.rows[0]) {
        const exists = await database.query(`SELECT 1 FROM project_storage_buckets
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`, [...scopeValues(scope), bucketId]);
        if (exists.rows[0]) throw new ProjectStorageConflictError();
      }
      return Boolean(result.rows[0]);
    });
  }

  reserveUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    upload: ProjectStorageUpload,
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database) => {
      const expired = await database.query<{ size_bytes: unknown }>(`UPDATE project_storage_uploads
        SET status='expired'
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND bucket_id=$4
          AND status='pending' AND expires_at <= $5
        RETURNING size_bytes`, [...scopeValues(scope), upload.bucketId, now]);
      const released = expired.rows.reduce((total, row) => total + safeInteger(row.size_bytes), 0);
      if (released > 0) await database.query(`UPDATE project_storage_buckets
        SET reserved_bytes=greatest(0,reserved_bytes-$5), updated_at=$6
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`,
      [...scopeValues(scope), upload.bucketId, released, now]);
      const bucketResult = await database.query(`${BUCKET_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4 FOR UPDATE`,
      [...scopeValues(scope), upload.bucketId]);
      const bucket = bucketResult.rows[0] ? bucketFromRow(bucketResult.rows[0]) : null;
      if (!bucket) throw new ProjectStorageConflictError();
      if (bucket.usedBytes + bucket.reservedBytes + upload.sizeBytes > bucket.quotaBytes) {
        throw new ProjectStorageQuotaError();
      }
      const duplicate = await database.query(`SELECT 1
        FROM project_storage_objects
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND bucket_id=$4
          AND object_key=$5 AND deleted_at IS NULL
        UNION ALL
        SELECT 1 FROM project_storage_uploads
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND bucket_id=$4
          AND object_key=$5 AND status='pending'
        LIMIT 1`, [...scopeValues(scope), upload.bucketId, upload.objectKey]);
      if (duplicate.rows[0]) throw new ProjectStorageConflictError();
      try {
        const result = await database.query(`INSERT INTO project_storage_uploads
          (id,organization_id,project_id,environment,bucket_id,object_key,provider_key,
           owner_subject,content_type,size_bytes,checksum_sha256,completion_token_hash,status,
           created_at,expires_at,completed_at,object_id,kind,provider_upload_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL,NULL,$16,$17)
          RETURNING ${UPLOAD_COLUMNS}`, uploadValues(upload));
        await database.query(`UPDATE project_storage_buckets
          SET reserved_bytes=reserved_bytes+$5,updated_at=$6
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`,
        [...scopeValues(scope), upload.bucketId, upload.sizeBytes, now]);
        return uploadFromRow(result.rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ProjectStorageConflictError();
        throw mapPostgresError(error);
      }
    });
  }

  findUploadByToken(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
  ) {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`${UPLOAD_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          AND completion_token_hash=$5 LIMIT 1`, [...scopeValues(scope), uploadId, tokenHash]);
      return result.rows[0] ? uploadFromRow(result.rows[0]) : null;
    });
  }

  completeUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    object: ProjectStorageObject,
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database) => {
      const uploadResult = await database.query(`${UPLOAD_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          AND completion_token_hash=$5 FOR UPDATE`, [...scopeValues(scope), uploadId, tokenHash]);
      const upload = uploadResult.rows[0] ? uploadFromRow(uploadResult.rows[0]) : null;
      if (!upload || !sameUploadObject(upload, object)) throw new ProjectStorageConflictError();
      if (upload.status === "completed" && upload.objectId) {
        const existing = await database.query(`${OBJECT_SELECT}
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4 LIMIT 1`,
        [...scopeValues(scope), upload.objectId]);
        if (existing.rows[0]) return objectFromRow(existing.rows[0]);
      }
      if (upload.status !== "pending" || upload.expiresAt <= now) throw new ProjectStorageConflictError();
      await database.query(`${BUCKET_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4 FOR UPDATE`,
      [...scopeValues(scope), object.bucketId]);
      try {
        const inserted = await database.query(`INSERT INTO project_storage_objects
          (id,organization_id,project_id,environment,bucket_id,object_key,owner_subject,provider_key,
           size_bytes,content_type,checksum_sha256,etag,status,created_at,delete_after,deleted_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL)
          RETURNING ${OBJECT_COLUMNS}`, objectValues(object));
        await database.query(`UPDATE project_storage_uploads SET
          status='completed',completed_at=$6,object_id=$7
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4 AND completion_token_hash=$5`,
        [...scopeValues(scope), upload.id, tokenHash, now, object.id]);
        await database.query(`UPDATE project_storage_buckets SET
          reserved_bytes=greatest(0,reserved_bytes-$5),used_bytes=used_bytes+$5,updated_at=$6
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`,
        [...scopeValues(scope), object.bucketId, object.sizeBytes, now]);
        return objectFromRow(inserted.rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ProjectStorageConflictError();
        throw mapPostgresError(error);
      }
    });
  }

  cancelUpload(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    uploadId: string,
    tokenHash: string,
    status: "cancelled" | "expired",
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database) => {
      const result = await database.query(`${UPLOAD_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
          AND completion_token_hash=$5 FOR UPDATE`, [...scopeValues(scope), uploadId, tokenHash]);
      const upload = result.rows[0] ? uploadFromRow(result.rows[0]) : null;
      if (!upload) return false;
      if (upload.status !== "pending") return upload.status === status;
      await database.query(`UPDATE project_storage_uploads SET status=$6
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4 AND completion_token_hash=$5`,
      [...scopeValues(scope), uploadId, tokenHash, status]);
      await database.query(`UPDATE project_storage_buckets SET
        reserved_bytes=greatest(0,reserved_bytes-$5),updated_at=$6
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`,
      [...scopeValues(scope), upload.bucketId, upload.sizeBytes, now]);
      return true;
    });
  }

  listObjects(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId: string,
    input: { prefix: string; limit: number; cursor?: string; includeUnsafe: boolean; ownerSubject?: string },
  ) {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`${OBJECT_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND bucket_id=$4
          AND deleted_at IS NULL AND object_key LIKE $5 ESCAPE '\\'
          AND ($6::text IS NULL OR object_key > $6)
          AND ($7::boolean OR status='clean')
          AND ($8::text IS NULL OR owner_subject=$8)
        ORDER BY object_key ASC LIMIT $9`, [
        ...scopeValues(scope), bucketId, `${escapeLike(input.prefix)}%`, input.cursor ?? null,
        input.includeUnsafe, input.ownerSubject ?? null, input.limit,
      ]);
      return result.rows.map(objectFromRow);
    });
  }

  findObject(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    bucketId: string,
    objectKeyOrId: string,
  ) {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`${OBJECT_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND bucket_id=$4
          AND deleted_at IS NULL AND (id::text=$5 OR object_key=$5) LIMIT 1`,
      [...scopeValues(scope), bucketId, objectKeyOrId]);
      return result.rows[0] ? objectFromRow(result.rows[0]) : null;
    });
  }

  setObjectStatus(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    objectId: string,
    status: ProjectStorageObjectStatus,
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database) => {
      const result = await database.query(`${OBJECT_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4 FOR UPDATE`,
      [...scopeValues(scope), objectId]);
      const object = result.rows[0] ? objectFromRow(result.rows[0]) : null;
      if (!object || object.deletedAt) return null;
      if (status === "infected") {
        await database.query(`UPDATE project_storage_buckets SET
          used_bytes=greatest(0,used_bytes-$5),updated_at=$6
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`,
        [...scopeValues(scope), object.bucketId, object.sizeBytes, now]);
      }
      const updated = await database.query(`UPDATE project_storage_objects SET status=$5,
          deleted_at=CASE WHEN $5='infected' THEN $6 ELSE deleted_at END
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
        RETURNING ${OBJECT_COLUMNS}`, [...scopeValues(scope), objectId, status, now]);
      return updated.rows[0] ? objectFromRow(updated.rows[0]) : null;
    });
  }

  markObjectDeleted(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    objectId: string,
    now: Date,
  ) {
    return this.withTenant(principal, false, async (database) => {
      const result = await database.query(`${OBJECT_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4 FOR UPDATE`,
      [...scopeValues(scope), objectId]);
      const object = result.rows[0] ? objectFromRow(result.rows[0]) : null;
      if (!object) return null;
      if (!object.deletedAt) {
        await database.query(`UPDATE project_storage_buckets SET
          used_bytes=greatest(0,used_bytes-$5),updated_at=$6
          WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4`,
        [...scopeValues(scope), object.bucketId, object.sizeBytes, now]);
      }
      const updated = await database.query(`UPDATE project_storage_objects SET deleted_at=coalesce(deleted_at,$5)
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND id=$4
        RETURNING ${OBJECT_COLUMNS}`, [...scopeValues(scope), objectId, now]);
      return updated.rows[0] ? objectFromRow(updated.rows[0]) : null;
    });
  }

  listExpiredObjects(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    now: Date,
    limit: number,
  ) {
    return this.withTenant(principal, true, async (database) => {
      const result = await database.query(`${OBJECT_SELECT}
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3
          AND deleted_at IS NULL AND delete_after IS NOT NULL AND delete_after <= $4
        ORDER BY delete_after ASC,id ASC LIMIT $5`, [...scopeValues(scope), now, limit]);
      return result.rows.map(objectFromRow);
    });
  }

  private withTenant<T>(
    principal: ProjectStoragePrincipal,
    readOnly: boolean,
    work: (database: SqlQueryable, audit?: { append(input: Record<string, unknown>): Promise<unknown> }) => Promise<T>,
  ): Promise<T> {
    return this.database.withTenant({
      organizationId: principal.organizationId,
      actorRef: principal.actorRef,
      readOnly,
    }, async (repositories) => work(repositories.transaction, repositories.audit as never));
  }
}

const BUCKET_COLUMNS = `id,organization_id,project_id,environment,name,read_policy,write_policy,
  allowed_mime_types,max_object_bytes,quota_bytes,used_bytes,reserved_bytes,retention_days,created_at,updated_at`;
const BUCKET_SELECT = `SELECT ${BUCKET_COLUMNS} FROM project_storage_buckets`;
const UPLOAD_COLUMNS = `id,organization_id,project_id,environment,bucket_id,object_key,provider_key,
  owner_subject,content_type,size_bytes,checksum_sha256,completion_token_hash,status,created_at,
  expires_at,completed_at,object_id,kind,provider_upload_id`;
const UPLOAD_SELECT = `SELECT ${UPLOAD_COLUMNS} FROM project_storage_uploads`;
const OBJECT_COLUMNS = `id,organization_id,project_id,environment,bucket_id,object_key,owner_subject,
  provider_key,size_bytes,content_type,checksum_sha256,etag,status,created_at,delete_after,deleted_at`;
const OBJECT_SELECT = `SELECT ${OBJECT_COLUMNS} FROM project_storage_objects`;

function scopeValues(scope: ProjectStorageScope): SqlValue[] {
  return [scope.organizationId, scope.projectId, scope.environment];
}

function uploadValues(upload: ProjectStorageUpload): SqlValue[] {
  return [upload.id, upload.organizationId, upload.projectId, upload.environment, upload.bucketId,
    upload.objectKey, upload.providerKey, upload.ownerSubject, upload.contentType, upload.sizeBytes,
    upload.checksumSha256, upload.completionTokenHash, upload.status, upload.createdAt, upload.expiresAt,
    upload.kind, upload.providerUploadId];
}

function objectValues(object: ProjectStorageObject): SqlValue[] {
  return [object.id, object.organizationId, object.projectId, object.environment, object.bucketId,
    object.key, object.ownerSubject, object.providerKey, object.sizeBytes, object.contentType,
    object.checksumSha256, object.etag, object.status, object.createdAt, object.deleteAfter];
}

function bucketFromRow(row: Row): ProjectStorageBucket {
  const readPolicy = String(row.read_policy);
  const writePolicy = String(row.write_policy);
  const mimeTypes = stringArray(row.allowed_mime_types);
  if (!["private", "authenticated", "owner", "public", "service"].includes(readPolicy) ||
      !["private", "authenticated", "owner", "service"].includes(writePolicy)) throw new Error("Invalid storage bucket");
  return {
    organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: environment(row.environment), id: String(row.id), name: String(row.name),
    readPolicy: readPolicy as ProjectStorageBucket["readPolicy"],
    writePolicy: writePolicy as ProjectStorageBucket["writePolicy"], allowedMimeTypes: mimeTypes,
    maxObjectBytes: safeInteger(row.max_object_bytes), quotaBytes: safeInteger(row.quota_bytes),
    usedBytes: safeInteger(row.used_bytes), reservedBytes: safeInteger(row.reserved_bytes),
    retentionDays: row.retention_days === null ? null : safeInteger(row.retention_days),
    createdAt: date(row.created_at), updatedAt: date(row.updated_at),
  };
}

function uploadFromRow(row: Row): ProjectStorageUpload {
  const status = String(row.status);
  if (!["pending", "completed", "cancelled", "expired"].includes(status)) throw new Error("Invalid storage upload");
  return {
    organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: environment(row.environment), id: String(row.id), bucketId: String(row.bucket_id),
    objectKey: String(row.object_key), providerKey: String(row.provider_key), ownerSubject: String(row.owner_subject),
    contentType: String(row.content_type), sizeBytes: safeInteger(row.size_bytes),
    checksumSha256: String(row.checksum_sha256), completionTokenHash: String(row.completion_token_hash),
    status: status as ProjectStorageUpload["status"], createdAt: date(row.created_at),
    expiresAt: date(row.expires_at), completedAt: nullableDate(row.completed_at),
    objectId: row.object_id === null ? null : String(row.object_id),
    kind: String(row.kind) === "multipart" ? "multipart" : "single",
    providerUploadId: row.provider_upload_id === null || row.provider_upload_id === undefined
      ? null : String(row.provider_upload_id),
  };
}

function objectFromRow(row: Row): ProjectStorageObject {
  const status = String(row.status);
  if (!["quarantined", "clean", "infected"].includes(status)) throw new Error("Invalid storage object");
  return {
    organizationId: String(row.organization_id), projectId: String(row.project_id),
    environment: environment(row.environment), id: String(row.id), bucketId: String(row.bucket_id),
    key: String(row.object_key), ownerSubject: row.owner_subject === null ? null : String(row.owner_subject),
    providerKey: String(row.provider_key), sizeBytes: safeInteger(row.size_bytes),
    contentType: String(row.content_type), checksumSha256: String(row.checksum_sha256),
    etag: row.etag === null ? null : String(row.etag), status: status as ProjectStorageObjectStatus,
    createdAt: date(row.created_at), deleteAfter: nullableDate(row.delete_after), deletedAt: nullableDate(row.deleted_at),
  };
}

function environment(value: unknown): ProjectStorageScope["environment"] {
  if (!["development", "staging", "production"].includes(String(value))) throw new Error("Invalid storage environment");
  return String(value) as ProjectStorageScope["environment"];
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return [...value];
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) return parsed;
  }
  throw new Error("Invalid storage MIME allowlist");
}

function safeInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid storage integer");
  return parsed;
}

function date(value: unknown) {
  const parsed = value instanceof Date ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid storage timestamp");
  return parsed;
}

function nullableDate(value: unknown) { return value === null ? null : date(value); }

function sameUploadObject(upload: ProjectStorageUpload, object: ProjectStorageObject) {
  return upload.organizationId === object.organizationId && upload.projectId === object.projectId &&
    upload.environment === object.environment && upload.bucketId === object.bucketId &&
    upload.objectKey === object.key && upload.providerKey === object.providerKey &&
    upload.ownerSubject === object.ownerSubject && upload.contentType === object.contentType &&
    upload.sizeBytes === object.sizeBytes && upload.checksumSha256 === object.checksumSha256;
}

function escapeLike(value: string) { return value.replace(/[\\%_]/g, (match) => `\\${match}`); }
