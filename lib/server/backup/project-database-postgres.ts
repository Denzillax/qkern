import { RepositoryError, mapPostgresError } from "@/lib/server/db/errors";
import type { SqlPool, SqlValue } from "@/lib/server/db/sql";
import { withTenantTransaction, type TenantTransaction } from "@/lib/server/db/transaction";
import type { Environment } from "@/lib/types";
import {
  PROJECT_DATABASE_BACKUP_ERROR_CODES,
  PROJECT_DATABASE_BACKUP_STATUSES,
  type ProjectDatabaseBackupClaim,
  type ProjectDatabaseBackupErrorCode,
  type ProjectDatabaseBackupRecord,
  type ProjectDatabaseBackupScope,
  type ProjectDatabaseBackupStatus,
  type ProjectDatabaseBackupStore,
} from "@/lib/server/backup/project-database";

/**
 * Der Katalog der Projektdatenbank-Backups auf PostgreSQL (2.126).
 *
 * ## Die Mandantengrenze, und wo sie liegt
 *
 * Diese Klasse bekommt **eine** Organisation im Konstruktor und keine zweite,
 * genau wie `PostgresProjectDatabaseProvisioningPort` aus dem Provisioner-Weg.
 * Jede Abfrage lauft in `withTenantTransaction`, also mit gesetztem
 * `qkern.organization_id`, und die Zeilensicherheit aus 0083 (mit `FORCE`)
 * entscheidet. **Keine Abfrage in dieser Datei traegt ein `WHERE
 * organization_id = ...`**, und das ist Absicht: ein Filter im Dienst ist eine
 * Grenze, die ein Tippfehler aufmacht; eine Policy ist eine, die auch dann
 * haelt, wenn der Filter fehlt. Der Fall zur Mandantengrenze prueft genau das,
 * indem er mit der Organisation A liest und das Backup von B nicht bekommt.
 *
 * ## Warum die Tabelle auch die Queue ist
 *
 * Siehe `project-database.ts`, Abschnitt "Wer das Backup fahrt". Der Claim ist
 * ein `UPDATE` auf die Zeile, die ein `SELECT ... FOR UPDATE SKIP LOCKED`
 * gefunden hat -- dieselbe Form wie in 0020 und 0026. `SKIP LOCKED` ist der
 * Grund, warum zwei Wirte sich nicht in die Quere kommen, ohne dass einer
 * wartet.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE = /^managed:[a-z0-9][a-z0-9._:-]{0,119}$/;

const COLUMNS = `id, organization_id, project_id, environment, database_instance_ref, status,
  object_key, artifact_sha256, size_bytes, wrapped_data_key, key_id, manifest_sha256, includes,
  snapshot_at, completed_at, expires_at, attempt_count, max_attempts, last_error_code, created_at`;

export class PostgresProjectDatabaseBackupStore implements ProjectDatabaseBackupStore {
  constructor(
    private readonly pool: SqlPool,
    private readonly organizationId: string,
    private readonly actorRef = "project-database-backup",
  ) {
    if (!UUID.test(organizationId)) throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
  }

  enqueue(
    scope: ProjectDatabaseBackupScope,
    databaseInstanceRef: string,
  ): Promise<ProjectDatabaseBackupRecord> {
    if (!UUID.test(scope.projectId) || !REFERENCE.test(databaseInstanceRef)) {
      throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
    }
    return this.withTenant(async (transaction) => {
      // Ein wartender oder laufender Auftrag je Umgebung reicht. Zwei Auftraege
      // nebeneinander ergeben zwei Dumps derselben Datenbank zur selben Zeit,
      // und das ist Last ohne Nutzen. Die Zeile kommt mit `FOR UPDATE` zurueck,
      // damit zwei Aufrufer nicht beide "keiner da" sehen.
      const existing = await transaction.query(
        `SELECT ${COLUMNS} FROM project_database_backups
         WHERE project_id = $1 AND environment = $2 AND status IN ('pending', 'running')
         ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [scope.projectId, scope.environment],
      );
      if (existing.rows[0]) return recordFrom(existing.rows[0]);
      const inserted = await transaction.query(
        `INSERT INTO project_database_backups
           (organization_id, project_id, environment, database_instance_ref, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING ${COLUMNS}`,
        [this.organizationId, scope.projectId, scope.environment, databaseInstanceRef],
      );
      return recordFrom(expectRow(inserted.rows[0]));
    });
  }

  claimNext(workerId: string, leaseDurationMs: number): Promise<ProjectDatabaseBackupClaim | null> {
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `UPDATE project_database_backups AS backup
         SET status = 'running',
             claimed_by = $1,
             lease_token = gen_random_uuid(),
             lease_expires_at = now() + make_interval(secs => $2::double precision / 1000),
             attempt_count = backup.attempt_count + 1,
             last_error_code = NULL
         WHERE backup.id = (
           SELECT candidate.id FROM project_database_backups AS candidate
           WHERE candidate.status = 'pending'
           ORDER BY candidate.created_at, candidate.id
           FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING ${COLUMNS}, lease_token`,
        [workerId, leaseDurationMs],
      );
      const row = result.rows[0];
      if (!row) return null;
      const leaseToken = String(row.lease_token ?? "");
      if (!UUID.test(leaseToken)) throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
      return Object.freeze({ record: recordFrom(row), leaseToken });
    });
  }

  releaseExpiredLeases(): Promise<readonly ProjectDatabaseBackupRecord[]> {
    return this.withTenant(async (transaction) => {
      // Eine Lease laeuft an der Uhr des **Servers** ab und nicht an der des
      // Dienstes. Zwei Wirte mit zwei Uhren wuerden sonst zwei verschiedene
      // Antworten auf "ist sie abgelaufen" geben, und einer von beiden nimmt
      // einen Auftrag weg, der noch lauft. Die einspeisbare Uhr des Dienstes
      // gilt fuer die Aufbewahrung, nicht fuer die Lease.
      const result = await transaction.query(
        `UPDATE project_database_backups
         SET status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
             last_error_code = 'LEASE_EXPIRED',
             claimed_by = NULL, lease_token = NULL, lease_expires_at = NULL
         WHERE status = 'running' AND lease_expires_at < now()
         RETURNING ${COLUMNS}`,
      );
      return result.rows.map(recordFrom);
    });
  }

  complete(
    claim: ProjectDatabaseBackupClaim,
    result: Parameters<ProjectDatabaseBackupStore["complete"]>[1],
  ): Promise<ProjectDatabaseBackupRecord> {
    return this.withTenant(async (transaction) => {
      const updated = await transaction.query(
        `UPDATE project_database_backups
         SET status = 'available',
             object_key = $3, artifact_sha256 = $4, size_bytes = $5,
             wrapped_data_key = $6, key_id = $7, manifest_sha256 = $8, includes = $9,
             snapshot_at = $10, completed_at = $11, expires_at = $12,
             claimed_by = NULL, lease_token = NULL, lease_expires_at = NULL,
             last_error_code = NULL
         WHERE id = $1 AND lease_token = $2 AND status = 'running'
         RETURNING ${COLUMNS}`,
        [
          claim.record.id, claim.leaseToken,
          result.objectKey, result.artifactSha256, result.sizeBytes,
          result.wrappedDataKey, result.keyId, result.manifestSha256, [...result.includes],
          result.snapshotAt, result.completedAt, result.expiresAt,
        ] as SqlValue[],
      );
      // Keine Zeile heisst: die Lease ist weg. Das ist kein Schreibfehler,
      // sondern ein verlorener Auftrag, und der Aufrufer muss es unterscheiden
      // koennen.
      if (!updated.rows[0]) throw new RepositoryError("PROJECT_PROVISIONING_LEASE_LOST", "The project database backup lease was lost.");
      return recordFrom(updated.rows[0]);
    });
  }

  recordFailure(
    claim: ProjectDatabaseBackupClaim,
    errorCode: ProjectDatabaseBackupErrorCode,
  ): Promise<ProjectDatabaseBackupRecord> {
    if (!(PROJECT_DATABASE_BACKUP_ERROR_CODES as readonly string[]).includes(errorCode)) {
      throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
    }
    return this.withTenant(async (transaction) => {
      const updated = await transaction.query(
        `UPDATE project_database_backups
         SET status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
             last_error_code = $3,
             claimed_by = NULL, lease_token = NULL, lease_expires_at = NULL
         WHERE id = $1 AND lease_token = $2 AND status = 'running'
         RETURNING ${COLUMNS}`,
        [claim.record.id, claim.leaseToken, errorCode],
      );
      if (!updated.rows[0]) throw new RepositoryError("PROJECT_PROVISIONING_LEASE_LOST", "The project database backup lease was lost.");
      return recordFrom(updated.rows[0]);
    });
  }

  get(backupId: string): Promise<ProjectDatabaseBackupRecord | null> {
    if (!UUID.test(backupId)) return Promise.resolve(null);
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `SELECT ${COLUMNS} FROM project_database_backups WHERE id = $1`,
        [backupId],
      );
      return result.rows[0] ? recordFrom(result.rows[0]) : null;
    });
  }

  list(scope: ProjectDatabaseBackupScope, limit: number): Promise<readonly ProjectDatabaseBackupRecord[]> {
    if (!UUID.test(scope.projectId)) throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `SELECT ${COLUMNS} FROM project_database_backups
         WHERE project_id = $1 AND environment = $2
         ORDER BY created_at DESC, id LIMIT $3`,
        [scope.projectId, scope.environment, limit],
      );
      return result.rows.map(recordFrom);
    });
  }

  /**
   * Alles, was aufzaehlbar ist, ohne Projekt und Umgebung zu nennen. Diese
   * Methode ist der Beleg dafuer, dass die Grenze nicht am Filter haengt: sie
   * hat keinen, und sie gibt trotzdem nur die Backups dieser Organisation.
   */
  listAll(limit: number): Promise<readonly ProjectDatabaseBackupRecord[]> {
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `SELECT ${COLUMNS} FROM project_database_backups ORDER BY created_at DESC, id LIMIT $1`,
        [limit],
      );
      return result.rows.map(recordFrom);
    });
  }

  findExpired(expiredBefore: Date, limit: number): Promise<readonly ProjectDatabaseBackupRecord[]> {
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `SELECT ${COLUMNS} FROM project_database_backups
         WHERE status = 'available' AND expires_at < $1
         ORDER BY expires_at, id LIMIT $2`,
        [expiredBefore, limit],
      );
      return result.rows.map(recordFrom);
    });
  }

  /**
   * Ein abgelaufenes Backup verliert Objektverweis und eingewickelten
   * Schluessel, bleibt aber als Zeile stehen. Die Zeile ist dann die Antwort auf
   * "hat es am 3. Mai ein Backup gegeben" -- ohne sie waere die Aufbewahrung
   * auch eine Loeschung der Tatsache. Was weg ist, ist das, was lesen laesst.
   */
  forget(backupId: string): Promise<void> {
    if (!UUID.test(backupId)) throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
    return this.withTenant(async (transaction) => {
      await transaction.query(
        `UPDATE project_database_backups
         SET status = 'expired', object_key = NULL, wrapped_data_key = NULL,
             key_id = NULL, artifact_sha256 = NULL, size_bytes = NULL
         WHERE id = $1 AND status = 'available'`,
        [backupId],
      );
    });
  }

  private withTenant<T>(operation: (transaction: TenantTransaction) => Promise<T>): Promise<T> {
    return withTenantTransaction(
      this.pool,
      { organizationId: this.organizationId, actorRef: this.actorRef, statementTimeoutMs: 20_000 },
      async (transaction) => {
        try {
          return await operation(transaction);
        } catch (error) {
          if (error instanceof RepositoryError) throw error;
          throw mapPostgresError(error);
        }
      },
    );
  }
}

function expectRow(row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!row) throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
  return row;
}

function recordFrom(row: Record<string, unknown>): ProjectDatabaseBackupRecord {
  const status = String(row.status);
  if (!(PROJECT_DATABASE_BACKUP_STATUSES as readonly string[]).includes(status)) {
    throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
  }
  const errorCode = row.last_error_code === null || row.last_error_code === undefined
    ? null
    : String(row.last_error_code);
  if (errorCode !== null && !(PROJECT_DATABASE_BACKUP_ERROR_CODES as readonly string[]).includes(errorCode)) {
    throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
  }
  return Object.freeze({
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: String(row.environment) as Environment,
    databaseInstanceRef: String(row.database_instance_ref),
    status: status as ProjectDatabaseBackupStatus,
    objectKey: text(row.object_key),
    artifactSha256: text(row.artifact_sha256),
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    wrappedDataKey: text(row.wrapped_data_key),
    keyId: text(row.key_id),
    manifestSha256: text(row.manifest_sha256),
    includes: Object.freeze(Array.isArray(row.includes) ? row.includes.map(String) : []),
    snapshotAt: date(row.snapshot_at),
    completedAt: date(row.completed_at),
    expiresAt: date(row.expires_at),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    lastErrorCode: errorCode as ProjectDatabaseBackupErrorCode | null,
    createdAt: date(row.created_at) ?? new Date(0),
  });
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function date(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
  return parsed;
}
