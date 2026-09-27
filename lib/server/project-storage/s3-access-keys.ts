import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PostgresControlPlane } from "@/lib/server/db/repositories";
import type {
  ProjectStoragePrincipal,
  ProjectStorageScope,
} from "@/lib/server/project-storage/model";
import type { ProjectStorageRepository } from "@/lib/server/project-storage/repository";
import { ProjectStorageError } from "@/lib/server/project-storage/service";
import type { Environment } from "@/lib/types";

/**
 * S3-Zugang (2.78): Schluesselpaare je Projektumgebung und Bucket-Satz.
 *
 * ## Welcher Weg gebaut ist, und warum der andere nicht
 *
 * Ein Paar beim Objektspeicher selbst anzulegen ginge mit diesem Provider
 * nicht. `ProjectStorageProvider` kennt keine Operation, die Zugangsdaten
 * anlegt, und der Dienst legt alle Objekte aller Mandanten in genau einen
 * Provider-Bucket und trennt nur ueber das Schluesselpraefix. Ein Paar beim
 * Provider waere darum ein Zugang zum Speicher aller Mandanten, nicht zu einem
 * Bucket.
 *
 * Ein Paar gegen QKERN selbst zu pruefen ginge kryptografisch nicht mit der
 * Zusage dieses Moduls. Eine SigV4-Signatur wird nachgerechnet, und die
 * Rechnung ist eine HMAC-Kette aus dem Geheimnis; aus dem hier gespeicherten
 * SHA-256-Hash laesst sich kein HMAC rechnen. Wer prueft, muss das Geheimnis
 * behalten. Dieses Modul behaelt es nicht, also prueft es nicht.
 *
 * Was dieses Modul deshalb ist: die Ausgabe und die Verwaltung. Ein Paar sagt,
 * wer auf welche Buckets welcher Umgebung duerfen soll und bis wann, es wird
 * genau einmal gezeigt und ist widerrufbar. Es gibt heute keinen Endpunkt, der
 * ein solches Paar annimmt, und die Console sagt genau diesen Satz.
 */

const SECRET = /^[A-Za-z0-9_-]{43}$/;
const ACCESS_KEY_ID = /^QKERNS3[A-Z2-7]{16}$/;
const MIN_TTL_MS = 5 * 60 * 1_000;
const MAX_TTL_MS = 366 * 24 * 60 * 60 * 1_000;
const MAX_BUCKETS_PER_KEY = 20;
const MAX_KEYS_PER_SCOPE = 100;

export type ProjectStorageS3AccessKey = ProjectStorageScope & {
  id: string;
  name: string;
  accessKeyId: string;
  /** Der Satz Buckets, fuer den das Paar gelten soll; aufsteigend sortiert. */
  bucketIds: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

/**
 * Die gespeicherte Zeile. Sie traegt den Hash, und genau darum verlaesst sie
 * die Dienstgrenze nie: Nach aussen geht `PublicProjectStorageS3AccessKey`.
 */
export type StoredProjectStorageS3AccessKey = ProjectStorageS3AccessKey & {
  secretHash: string;
  createdBy: string;
};

export type PublicProjectStorageS3AccessKey =
  Omit<ProjectStorageS3AccessKey, "organizationId" | "expiresAt" | "revokedAt" | "createdAt"> & {
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
  };

export type CreateProjectStorageS3AccessKeyInput = {
  name: string;
  bucketIds: string[];
  expiresAt: string;
};

export interface ProjectStorageS3AccessKeyStore {
  list(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
  ): Promise<StoredProjectStorageS3AccessKey[]>;
  create(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    input: StoredProjectStorageS3AccessKey,
  ): Promise<StoredProjectStorageS3AccessKey>;
  revoke(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    keyId: string,
  ): Promise<StoredProjectStorageS3AccessKey>;
}

export type ProjectStorageS3AccessKeyDependencies = {
  store: ProjectStorageS3AccessKeyStore;
  /** Nur `listBuckets` wird gebraucht: der Bucket-Satz muss in die Umgebung passen. */
  buckets: Pick<ProjectStorageRepository, "listBuckets">;
  now?: () => Date;
  id?: () => string;
  accessKeyId?: () => string;
  secret?: () => string;
};

export class ProjectStorageS3AccessKeyService {
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly accessKeyId: () => string;
  private readonly secret: () => string;

  constructor(private readonly dependencies: ProjectStorageS3AccessKeyDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? (() => randomUUID());
    this.accessKeyId = dependencies.accessKeyId ?? s3AccessKeyId;
    this.secret = dependencies.secret ?? s3AccessKeySecret;
  }

  async list(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
  ): Promise<PublicProjectStorageS3AccessKey[]> {
    assertScope(principal, scope);
    const records = await this.dependencies.store.list(principal, scope);
    return records.map(publicS3AccessKey);
  }

  /**
   * Legt ein Paar an und gibt das Geheimnis genau einmal zurueck. Danach
   * existiert nur noch sein Hash, und kein Weg dieses Moduls gibt es wieder
   * heraus.
   */
  async create(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    input: CreateProjectStorageS3AccessKeyInput,
  ): Promise<{ key: PublicProjectStorageS3AccessKey; secret: string }> {
    assertScope(principal, scope);
    const name = input.name.trim();
    const expiresAt = new Date(input.expiresAt);
    const now = this.now();
    const ttl = expiresAt.getTime() - now.getTime();
    if (!name || name.length > 80 || /[\0\r\n]/.test(name) ||
        !Number.isFinite(expiresAt.getTime()) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) {
      throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    }
    const bucketIds = uniqueBucketIds(input.bucketIds);
    // Der Bucket-Satz muss in diese Umgebung passen. Der Fremdschluessel der
    // Kopplungstabelle prueft dasselbe noch einmal in der Datenbank; hier
    // geprueft wird, damit ein fremder Bucket eine 404 bekommt und keine
    // Constraint-Meldung.
    const known = new Set(
      (await this.dependencies.buckets.listBuckets(principal, scope)).map((bucket) => bucket.id),
    );
    if (bucketIds.some((bucketId) => !known.has(bucketId))) {
      throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
    }
    const secret = this.secret();
    const accessKeyId = this.accessKeyId();
    if (!SECRET.test(secret) || !ACCESS_KEY_ID.test(accessKeyId)) {
      throw new ProjectStorageError("STORAGE_INVALID_INPUT");
    }
    const stored: StoredProjectStorageS3AccessKey = {
      ...scope,
      id: this.id(),
      name,
      accessKeyId,
      bucketIds,
      secretHash: hashS3AccessKeySecret(secret),
      expiresAt,
      revokedAt: null,
      createdBy: principal.subject,
      createdAt: now,
    };
    const created = await this.dependencies.store.create(principal, scope, stored);
    return { key: publicS3AccessKey(created), secret };
  }

  /**
   * Widerruf wirkt sofort und ist nicht loeschen: Die Zeile bleibt mit ihrem
   * Zeitpunkt stehen, und ein zweiter Widerruf verschiebt ihn nicht.
   */
  async revoke(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    keyId: string,
  ): Promise<PublicProjectStorageS3AccessKey> {
    assertScope(principal, scope);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(keyId)) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
    return publicS3AccessKey(await this.dependencies.store.revoke(principal, scope, keyId));
  }
}

/**
 * Die eine Stelle, an der der Hash von der Zeile getrennt wird. Sie ist der
 * Grund, warum weder die Liste noch der Widerruf je etwas ueber das Geheimnis
 * verraten, und der Zertifizierungsfall (2.78) faellt, wenn sie es tut.
 */
export function publicS3AccessKey(
  record: StoredProjectStorageS3AccessKey,
): PublicProjectStorageS3AccessKey {
  return {
    id: record.id,
    projectId: record.projectId,
    environment: record.environment,
    name: record.name,
    accessKeyId: record.accessKeyId,
    bucketIds: [...record.bucketIds],
    expiresAt: record.expiresAt.toISOString(),
    revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

export function hashS3AccessKeySecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("base64url");
}

export function s3AccessKeySecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Der oeffentliche Teil traegt QKERNs eigenes Praefix. Ein Paar in der Form
 * eines Provider-Schluessels waere die Unehrlichkeit, die dieser Slice
 * vermeidet: Es sieht nicht aus wie ein Zugang, der es nicht ist.
 */
export function s3AccessKeyId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = randomBytes(16);
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `QKERNS3${suffix}`;
}

export class MemoryProjectStorageS3AccessKeyStore implements ProjectStorageS3AccessKeyStore {
  private readonly records = new Map<string, StoredProjectStorageS3AccessKey>();

  async list(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
  ): Promise<StoredProjectStorageS3AccessKey[]> {
    return [...this.records.values()]
      .filter((record) => inScope(record, principal, scope))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((record) => ({ ...record, bucketIds: [...record.bucketIds] }));
  }

  async create(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    input: StoredProjectStorageS3AccessKey,
  ): Promise<StoredProjectStorageS3AccessKey> {
    if (principal.organizationId !== scope.organizationId || this.records.has(input.id) ||
        [...this.records.values()].some((record) =>
          record.secretHash === input.secretHash || record.accessKeyId === input.accessKeyId)) {
      throw new ProjectStorageError("STORAGE_CONFLICT");
    }
    if ([...this.records.values()].filter((record) => inScope(record, principal, scope)).length >= MAX_KEYS_PER_SCOPE) {
      throw new ProjectStorageError("STORAGE_CONFLICT");
    }
    this.records.set(input.id, { ...input, bucketIds: [...input.bucketIds] });
    return { ...input, bucketIds: [...input.bucketIds] };
  }

  async revoke(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    keyId: string,
  ): Promise<StoredProjectStorageS3AccessKey> {
    const record = this.records.get(keyId);
    if (!record || !inScope(record, principal, scope)) {
      throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
    }
    record.revokedAt ??= new Date();
    return { ...record, bucketIds: [...record.bucketIds] };
  }
}

const KEY_COLUMNS = `id, organization_id, project_id, environment, name, access_key_id,
                     secret_hash, expires_at, revoked_at, created_by, created_at`;

export class PostgresProjectStorageS3AccessKeyStore implements ProjectStorageS3AccessKeyStore {
  constructor(private readonly database: Pick<PostgresControlPlane, "withTenant">) {}

  list(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
  ): Promise<StoredProjectStorageS3AccessKey[]> {
    return this.database.withTenant({
      organizationId: principal.organizationId,
      actorRef: principal.actorRef,
      readOnly: true,
    }, async (repositories) => {
      const result = await repositories.transaction.query(
        `SELECT ${KEY_COLUMNS},
                coalesce((SELECT array_agg(coupling.bucket_id ORDER BY coupling.bucket_id)
                            FROM project_storage_s3_access_key_buckets AS coupling
                           WHERE coupling.organization_id = access_key.organization_id
                             AND coupling.project_id = access_key.project_id
                             AND coupling.environment = access_key.environment
                             AND coupling.key_id = access_key.id), '{}') AS bucket_ids
           FROM project_storage_s3_access_keys AS access_key
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3
          ORDER BY created_at DESC, id DESC
          LIMIT ${MAX_KEYS_PER_SCOPE}`,
        [scope.organizationId, scope.projectId, scope.environment],
      );
      return result.rows.map(s3AccessKeyFromRow);
    });
  }

  create(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    input: StoredProjectStorageS3AccessKey,
  ): Promise<StoredProjectStorageS3AccessKey> {
    return this.database.withTenant({
      organizationId: principal.organizationId,
      actorRef: principal.actorRef,
    }, async (repositories) => {
      const existing = await repositories.transaction.query(
        `SELECT count(*)::int AS total FROM project_storage_s3_access_keys
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3`,
        [scope.organizationId, scope.projectId, scope.environment],
      );
      if (Number(existing.rows[0]?.total ?? 0) >= MAX_KEYS_PER_SCOPE) {
        throw new ProjectStorageError("STORAGE_CONFLICT");
      }
      let inserted;
      try {
        inserted = await repositories.transaction.query(
          `INSERT INTO project_storage_s3_access_keys
             (id, organization_id, project_id, environment, name, access_key_id,
              secret_hash, expires_at, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING ${KEY_COLUMNS}`,
          [input.id, scope.organizationId, scope.projectId, scope.environment, input.name,
            input.accessKeyId, input.secretHash, input.expiresAt, input.createdBy, input.createdAt],
        );
        for (const bucketId of input.bucketIds) {
          await repositories.transaction.query(
            `INSERT INTO project_storage_s3_access_key_buckets
               (organization_id, project_id, environment, key_id, bucket_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [scope.organizationId, scope.projectId, scope.environment, input.id, bucketId],
          );
        }
      } catch (error) {
        throw mapS3AccessKeyWriteError(error);
      }
      const created = s3AccessKeyFromRow({
        ...inserted.rows[0],
        bucket_ids: [...input.bucketIds],
      });
      // Der Audit-Eintrag traegt den oeffentlichen Teil, den Bucket-Satz und den
      // Ablauf. Er traegt weder das Geheimnis noch seinen Hash: `redactSensitive`
      // in lib/security.ts greift ueber den Feldnamen, und ein Feld mit dem Wert
      // gibt es hier gar nicht.
      await repositories.audit.append({
        projectId: scope.projectId,
        environment: scope.environment,
        actorType: "user",
        actorRef: principal.actorRef,
        action: "project.storage.s3_access_key.created",
        resourceRef: created.id,
        status: "success",
        metadata: {
          accessKeyId: created.accessKeyId,
          buckets: created.bucketIds.length,
          expiresAt: created.expiresAt.toISOString(),
        },
      });
      return created;
    });
  }

  revoke(
    principal: ProjectStoragePrincipal,
    scope: ProjectStorageScope,
    keyId: string,
  ): Promise<StoredProjectStorageS3AccessKey> {
    return this.database.withTenant({
      organizationId: principal.organizationId,
      actorRef: principal.actorRef,
    }, async (repositories) => {
      const result = await repositories.transaction.query(
        `UPDATE project_storage_s3_access_keys
            SET revoked_at = coalesce(revoked_at, now())
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND id = $4
          RETURNING ${KEY_COLUMNS}`,
        [scope.organizationId, scope.projectId, scope.environment, keyId],
      );
      if (!result.rows[0]) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
      const buckets = await repositories.transaction.query(
        `SELECT bucket_id FROM project_storage_s3_access_key_buckets
          WHERE organization_id = $1 AND project_id = $2 AND environment = $3 AND key_id = $4
          ORDER BY bucket_id`,
        [scope.organizationId, scope.projectId, scope.environment, keyId],
      );
      const revoked = s3AccessKeyFromRow({
        ...result.rows[0],
        bucket_ids: buckets.rows.map((row) => String(row.bucket_id)),
      });
      await repositories.audit.append({
        projectId: scope.projectId,
        environment: scope.environment,
        actorType: "user",
        actorRef: principal.actorRef,
        action: "project.storage.s3_access_key.revoked",
        resourceRef: revoked.id,
        status: "success",
        metadata: {
          accessKeyId: revoked.accessKeyId,
          revokedAt: revoked.revokedAt?.toISOString() ?? null,
        },
      });
      return revoked;
    });
  }
}

function s3AccessKeyFromRow(row: Record<string, unknown>): StoredProjectStorageS3AccessKey {
  if (!row) throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: row.environment as Environment,
    name: String(row.name),
    accessKeyId: String(row.access_key_id),
    bucketIds: (Array.isArray(row.bucket_ids) ? row.bucket_ids : []).map((value) => String(value)),
    secretHash: String(row.secret_hash),
    expiresAt: new Date(row.expires_at as string | Date),
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string | Date) : null,
    createdBy: String(row.created_by),
    createdAt: new Date(row.created_at as string | Date),
  };
}

/**
 * Ein doppelter oeffentlicher Teil ist ein Konflikt, ein unbekannter Bucket
 * eine 404. Die Meldung der Datenbank wird dabei nicht weitergetragen: Sie
 * nennt Tabellen und Werte, und beides gehoert nicht in eine Antwort.
 */
function mapS3AccessKeyWriteError(error: unknown): ProjectStorageError {
  if (error instanceof ProjectStorageError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "23505") return new ProjectStorageError("STORAGE_CONFLICT");
  if (code === "23503") return new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
  throw error;
}

function inScope(
  record: StoredProjectStorageS3AccessKey,
  principal: ProjectStoragePrincipal,
  scope: ProjectStorageScope,
): boolean {
  return record.organizationId === principal.organizationId &&
    record.organizationId === scope.organizationId &&
    record.projectId === scope.projectId &&
    record.environment === scope.environment;
}

function uniqueBucketIds(values: string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_BUCKETS_PER_KEY) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  const unique = [...new Set(values.map((value) => value.trim()))].sort();
  if (unique.length !== values.length ||
      unique.some((value) => !/^[0-9a-fA-F-]{36}$/.test(value))) {
    throw new ProjectStorageError("STORAGE_INVALID_INPUT");
  }
  return unique;
}

function assertScope(principal: ProjectStoragePrincipal, scope: ProjectStorageScope): void {
  if (!principal.organizationId || !principal.actorRef || !principal.subject ||
      principal.role !== "admin" || principal.organizationId !== scope.organizationId ||
      !scope.projectId || scope.projectId.length > 128 ||
      !["development", "staging", "production"].includes(scope.environment)) {
    throw new ProjectStorageError("STORAGE_RESOURCE_NOT_FOUND");
  }
}
