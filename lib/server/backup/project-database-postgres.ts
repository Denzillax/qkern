import { RepositoryError, mapPostgresError } from "@/lib/server/db/errors";
import type { SqlPool, SqlValue } from "@/lib/server/db/sql";
import { withTenantTransaction, type TenantTransaction } from "@/lib/server/db/transaction";
import type { Environment } from "@/lib/types";
import {
  PROJECT_DATABASE_BACKUP_ARTIFACT_FORMATS,
  PROJECT_DATABASE_BACKUP_ERROR_CODES,
  PROJECT_DATABASE_BACKUP_STATUSES,
  PROJECT_DATABASE_RESTORE_ERROR_CODES,
  PROJECT_DATABASE_RESTORE_STATUSES,
  type ProjectDatabaseBackupArtifactFormat,
  type ProjectDatabaseBackupClaim,
  type ProjectDatabaseBackupEnqueueResult,
  type ProjectDatabaseBackupErrorCode,
  type ProjectDatabaseBackupRecord,
  type ProjectDatabaseBackupScope,
  type ProjectDatabaseBackupStatus,
  type ProjectDatabaseBackupStore,
  type ProjectDatabaseRestoreClaim,
  type ProjectDatabaseRestoreErrorCode,
} from "@/lib/server/backup/project-database";
import type {
  ProjectDatabaseBackupSchedule,
  ProjectDatabaseBackupScheduleStore,
} from "@/lib/server/backup/project-database-schedule";

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
  artifact_format, part_count, part_plaintext_bytes,
  restore_status, restore_requested_at, restore_requested_by, restore_database_name,
  restore_completed_at, restore_error_code,
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
  ): Promise<ProjectDatabaseBackupEnqueueResult> {
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
      if (existing.rows[0]) {
        return Object.freeze({ record: recordFrom(existing.rows[0]), created: false });
      }
      const inserted = await transaction.query(
        `INSERT INTO project_database_backups
           (organization_id, project_id, environment, database_instance_ref, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING ${COLUMNS}`,
        [this.organizationId, scope.projectId, scope.environment, databaseInstanceRef],
      );
      return Object.freeze({ record: recordFrom(expectRow(inserted.rows[0])), created: true });
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
             artifact_format = $10, part_count = $11, part_plaintext_bytes = $12,
             snapshot_at = $13, completed_at = $14, expires_at = $15,
             claimed_by = NULL, lease_token = NULL, lease_expires_at = NULL,
             last_error_code = NULL
         WHERE id = $1 AND lease_token = $2 AND status = 'running'
         RETURNING ${COLUMNS}`,
        [
          claim.record.id, claim.leaseToken,
          result.objectKey, result.artifactSha256, result.sizeBytes,
          result.wrappedDataKey, result.keyId, result.manifestSha256, [...result.includes],
          result.artifactFormat, result.partCount, result.partPlaintextBytes,
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
             key_id = NULL, artifact_sha256 = NULL, size_bytes = NULL,
             part_count = NULL, part_plaintext_bytes = NULL
         WHERE id = $1 AND status = 'available'`,
        [backupId],
      );
    });
  }

  /**
   * Der Verweis auf die Datenbankinstanz dieser Umgebung (2.129).
   *
   * Er steht hier, weil eine Route einen Auftrag einstellen muss und den Verweis
   * nicht aus der Anfrage nehmen darf: eine Route, die ihn annimmt, waere eine
   * Route, mit der jemand ein Backup einer fremden Datenbank bestellt. Die Policy
   * wuerde ihm die Zeile verweigern, aber der Provisioner haette den Dump schon
   * gezogen.
   *
   * **Gelesen wird `project_environments` und nicht `project_database_bindings`,
   * und das ist der Punkt.** Die Bindung traegt Host, Port, die Vault-Rolle und
   * den Blatt-Pin des Zertifikats; 0020 hat `qkern_runtime` darauf bewusst kein
   * `SELECT` gegeben, und dieser Weg aendert das nicht. Was die Route braucht,
   * ist der Verweis allein, und der steht seit 0020 auch in der Umgebung (der
   * Provisioner schreibt ihn beim Binden in dieselbe Zeile). Eine zweite Rolle
   * mit Leserecht auf dem Verbindungskatalog waere ein deutlich hoeherer Preis
   * fuer dieselbe Angabe.
   *
   * Eine Umgebung ohne bereitgestellte Datenbank traegt einen Verweis mit
   * `pending:`, und der faellt hier durch die Formpruefung: der Aufrufer bekommt
   * `null` und daraus ein 404. Das ist die richtige Antwort, denn eine Umgebung
   * ohne Datenbank hat auch kein Backup.
   *
   * Die Anweisung traegt wieder keinen Organisationsfilter; die Policy aus 0002
   * haelt.
   */
  databaseInstanceRefFor(
    scope: Readonly<{ projectId: string; environment: Environment }>,
  ): Promise<string | null> {
    if (!UUID.test(scope.projectId)) return Promise.resolve(null);
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `SELECT database_instance_ref FROM project_environments
         WHERE project_id = $1 AND environment = $2`,
        [scope.projectId, scope.environment],
      );
      const reference = String(result.rows[0]?.database_instance_ref ?? "");
      return REFERENCE.test(reference) ? reference : null;
    });
  }

  /**
   * Bestellt eine Wiederherstellung (2.129).
   *
   * Die Bedingung steht in der **Anweisung** und nicht nur im Dienst: nur ein
   * `available`-Backup, und nur eines, auf dem nicht schon eine
   * Wiederherstellung laeuft. Ein Dienst, der das vorher prueft und dann
   * schreibt, hat zwischen Pruefung und Schreiben eine Luecke, in der ein
   * zweiter Aufrufer dasselbe tut.
   *
   * Geschrieben werden genau die vier Spalten, auf die `qkern_runtime` in 0084
   * ein Recht hat. Das ist kein Zufall: dieselbe Anweisung lauft unter der Rolle
   * der Console und unter der des Provisioners, und sie soll unter beiden
   * dasselbe duerfen.
   */
  requestRestore(input: Readonly<{
    backupId: string; databaseName: string; requestedBy: string; at: Date;
  }>): Promise<ProjectDatabaseBackupRecord | null> {
    if (!UUID.test(input.backupId) || !/^[a-z_][a-z0-9_]{0,62}$/.test(input.databaseName) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.requestedBy)) {
      throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
    }
    return this.withTenant(async (transaction) => {
      const updated = await transaction.query(
        `UPDATE project_database_backups
         SET restore_status = 'requested', restore_requested_at = $2,
             restore_requested_by = $3, restore_database_name = $4,
             -- Der Ausgang der vorigen Wiederherstellung wird mitgeraeumt. Ohne
             -- das traegt eine wartende Bestellung den Fehlercode der vorigen,
             -- und project_database_backups_restore_failure_shape weist die
             -- Zeile ab; das ist der Befund des ersten Laufs von (2.130).
             restore_error_code = NULL, restore_completed_at = NULL
         WHERE id = $1 AND status = 'available'
           AND (restore_status IS NULL OR restore_status IN ('succeeded', 'failed'))
         RETURNING ${COLUMNS}`,
        [input.backupId, input.at, input.requestedBy, input.databaseName],
      );
      return updated.rows[0] ? recordFrom(updated.rows[0]) : null;
    });
  }

  claimNextRestore(leaseDurationMs: number): Promise<ProjectDatabaseRestoreClaim | null> {
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `UPDATE project_database_backups AS backup
         SET restore_status = 'running',
             restore_lease_token = gen_random_uuid(),
             restore_lease_expires_at = now() + make_interval(secs => $1::double precision / 1000)
         WHERE backup.id = (
           SELECT candidate.id FROM project_database_backups AS candidate
           WHERE candidate.restore_status = 'requested'
           ORDER BY candidate.restore_requested_at, candidate.id
           FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING ${COLUMNS}, restore_lease_token`,
        [leaseDurationMs],
      );
      const row = result.rows[0];
      if (!row) return null;
      const leaseToken = String(row.restore_lease_token ?? "");
      const databaseName = String(row.restore_database_name ?? "");
      if (!UUID.test(leaseToken) || !/^[a-z_][a-z0-9_]{0,62}$/.test(databaseName)) {
        throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
      }
      return Object.freeze({ record: recordFrom(row), databaseName, leaseToken });
    });
  }

  completeRestore(claim: ProjectDatabaseRestoreClaim, completedAt: Date): Promise<void> {
    return this.withTenant(async (transaction) => {
      const updated = await transaction.query(
        `UPDATE project_database_backups
         SET restore_status = 'succeeded', restore_completed_at = $3,
             restore_error_code = NULL,
             restore_lease_token = NULL, restore_lease_expires_at = NULL
         WHERE id = $1 AND restore_lease_token = $2 AND restore_status = 'running'
         RETURNING id`,
        [claim.record.id, claim.leaseToken, completedAt],
      );
      if (!updated.rows[0]) {
        throw new RepositoryError("PROJECT_PROVISIONING_LEASE_LOST", "The project database restore lease was lost.");
      }
    });
  }

  failRestore(
    claim: ProjectDatabaseRestoreClaim,
    errorCode: ProjectDatabaseRestoreErrorCode,
    completedAt: Date,
  ): Promise<void> {
    if (!(PROJECT_DATABASE_RESTORE_ERROR_CODES as readonly string[]).includes(errorCode)) {
      throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
    }
    return this.withTenant(async (transaction) => {
      await transaction.query(
        `UPDATE project_database_backups
         SET restore_status = 'failed', restore_completed_at = $4, restore_error_code = $3,
             restore_lease_token = NULL, restore_lease_expires_at = NULL
         WHERE id = $1 AND restore_lease_token = $2 AND restore_status = 'running'`,
        [claim.record.id, claim.leaseToken, errorCode, completedAt],
      );
    });
  }

  /**
   * Eine Wiederherstellung mit abgelaufener Lease wird `failed` und **nicht**
   * wieder `requested`. Der Wirt ist mitten darin gestorben; was er hinterlassen
   * hat, ist eine halb gebaute Datenbank, und ein zweiter Versuch wuerde an
   * `CREATE DATABASE` mit demselben Namen scheitern. Wer es wieder versuchen
   * will, bestellt neu -- dann gibt es einen neuen Namen, weil die alte Datenbank
   * noch dasteht und ein Mensch sie ansehen soll.
   */
  failExpiredRestoreLeases(): Promise<readonly ProjectDatabaseBackupRecord[]> {
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `UPDATE project_database_backups
         SET restore_status = 'failed', restore_error_code = 'RESTORE_FAILED',
             restore_completed_at = now(),
             restore_lease_token = NULL, restore_lease_expires_at = NULL
         WHERE restore_status = 'running' AND restore_lease_expires_at < now()
         RETURNING ${COLUMNS}`,
      );
      return result.rows.map(recordFrom);
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
    artifactFormat: artifactFormatOf(row.artifact_format),
    partCount: row.part_count === null || row.part_count === undefined ? null : Number(row.part_count),
    partPlaintextBytes: row.part_plaintext_bytes === null || row.part_plaintext_bytes === undefined
      ? null
      : Number(row.part_plaintext_bytes),
    restoreStatus: oneOf(row.restore_status, PROJECT_DATABASE_RESTORE_STATUSES),
    restoreRequestedAt: date(row.restore_requested_at),
    restoreRequestedBy: text(row.restore_requested_by),
    restoreDatabaseName: text(row.restore_database_name),
    restoreCompletedAt: date(row.restore_completed_at),
    restoreErrorCode: oneOf(row.restore_error_code, PROJECT_DATABASE_RESTORE_ERROR_CODES),
    snapshotAt: date(row.snapshot_at),
    completedAt: date(row.completed_at),
    expiresAt: date(row.expires_at),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    lastErrorCode: errorCode as ProjectDatabaseBackupErrorCode | null,
    createdAt: date(row.created_at) ?? new Date(0),
  });
}

/**
 * Ein Wert aus einem festen Satz, oder `null`. Was nicht im Satz steht, ist eine
 * kaputte Zeile und nicht "vermutlich das Naechstliegende".
 */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
  }
  return text as T;
}

function artifactFormatOf(value: unknown): ProjectDatabaseBackupArtifactFormat {
  // Eine Zeile aus 2.73.0 traegt `single` aus der Voreinstellung von 0084. Eine
  // Zeile mit etwas anderem gibt es nicht, und wenn doch, ist sie kaputt und
  // nicht "vermutlich chunked".
  const format = value === null || value === undefined ? "single" : String(value);
  if (!(PROJECT_DATABASE_BACKUP_ARTIFACT_FORMATS as readonly string[]).includes(format)) {
    throw new RepositoryError("INVALID_RECORD", "The project database backup record is invalid.");
  }
  return format as ProjectDatabaseBackupArtifactFormat;
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

/**
 * Der Zeitplan auf PostgreSQL (0084, 2.129).
 *
 * Dieselbe Mandantengrenze wie oben: eine Organisation im Konstruktor, jede
 * Abfrage in `withTenantTransaction`, **kein** `WHERE organization_id` in einer
 * Anweisung. Was haelt, ist die Policy aus 0084.
 */
export class PostgresProjectDatabaseBackupScheduleStore
implements ProjectDatabaseBackupScheduleStore {
  constructor(
    private readonly pool: SqlPool,
    private readonly organizationId: string,
    private readonly actorRef = "project-database-backup",
  ) {
    if (!UUID.test(organizationId)) throw new RepositoryError("INVALID_RECORD", "The project database backup schedule is invalid.");
  }

  /**
   * Faellige Zeitplaene holen **und** fortschreiben, in **einer** Anweisung.
   *
   * Zwei Anweisungen waeren hier ein Fehler mit zwei Wirten: beide lesen
   * dieselbe faellige Zeile und beide stellen einen Auftrag ein. Ein `UPDATE …
   * RETURNING` ueber eine Unterabfrage mit `FOR UPDATE SKIP LOCKED` kann das
   * nicht: der zweite Wirt sieht die Zeile nicht mehr als faellig, weil der erste
   * sie in derselben Anweisung fortgeschrieben hat.
   *
   * `now()` kommt als Parameter und nicht aus der Datenbank, weil die
   * einspeisbare Uhr des Dienstes auch hier gelten muss -- sonst waere ein Takt
   * von 24 Stunden erst in 24 Stunden pruefbar. Die **Lease** eines Auftrags
   * laeuft dagegen an der Serveruhr ab (siehe `releaseExpiredLeases`), und das
   * bleibt so: zwei Wirte mit zwei Uhren duerfen sich nicht gegenseitig
   * Auftraege wegnehmen.
   */
  claimDue(now: Date, limit: number): Promise<readonly ProjectDatabaseBackupSchedule[]> {
    const bounded = Number.isSafeInteger(limit) && limit >= 1 && limit <= 200 ? limit : 10;
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `UPDATE project_database_backup_schedules AS schedule
         SET next_due_at = $1::timestamptz + make_interval(hours => schedule.interval_hours)
         WHERE (schedule.project_id, schedule.environment) IN (
           SELECT candidate.project_id, candidate.environment
           FROM project_database_backup_schedules AS candidate
           WHERE candidate.enabled AND candidate.next_due_at <= $1
           ORDER BY candidate.next_due_at, candidate.project_id, candidate.environment
           FOR UPDATE SKIP LOCKED LIMIT $2)
         RETURNING schedule.organization_id, schedule.project_id, schedule.environment,
                   schedule.enabled, schedule.interval_hours, schedule.retention_days,
                   schedule.next_due_at, schedule.last_enqueued_at, schedule.last_backup_id,
                   schedule.busy_count,
                   (SELECT environment.database_instance_ref
                    FROM project_environments AS environment
                    WHERE environment.project_id = schedule.project_id
                      AND environment.environment = schedule.environment) AS database_instance_ref`,
        [now, bounded],
      );
      // Eine Zeile ohne Bindung gibt es nach 0084 nicht (Fremdschluessel), und
      // doch wird sie hier weggelassen statt angenommen: ein `null` in einen
      // `pg_dump` zu geben ist schlechter als ein Takt, der nichts tut.
      return result.rows
        .filter((row) => REFERENCE.test(String(row.database_instance_ref ?? "")))
        .map(scheduleFrom);
    });
  }

  recordTick(
    key: Readonly<{ projectId: string; environment: Environment }>,
    outcome: Readonly<{ backupId: string; busy: boolean; at: Date }>,
  ): Promise<void> {
    if (!UUID.test(key.projectId) || !UUID.test(outcome.backupId)) {
      throw new RepositoryError("INVALID_RECORD", "The project database backup schedule is invalid.");
    }
    return this.withTenant(async (transaction) => {
      await transaction.query(
        `UPDATE project_database_backup_schedules
         SET last_enqueued_at = $3, last_backup_id = $4,
             busy_count = CASE WHEN $5::boolean THEN busy_count + 1 ELSE busy_count END
         WHERE project_id = $1 AND environment = $2`,
        [key.projectId, key.environment, outcome.at, outcome.backupId, outcome.busy],
      );
    });
  }

  get(key: Readonly<{ projectId: string; environment: Environment }>):
  Promise<ProjectDatabaseBackupSchedule | null> {
    if (!UUID.test(key.projectId)) return Promise.resolve(null);
    return this.withTenant(async (transaction) => {
      const result = await transaction.query(
        `SELECT schedule.organization_id, schedule.project_id, schedule.environment,
                schedule.enabled, schedule.interval_hours, schedule.retention_days,
                schedule.next_due_at, schedule.last_enqueued_at, schedule.last_backup_id,
                schedule.busy_count, environment.database_instance_ref
         FROM project_database_backup_schedules AS schedule
         JOIN project_environments AS environment
           ON environment.project_id = schedule.project_id
          AND environment.environment = schedule.environment
         WHERE schedule.project_id = $1 AND schedule.environment = $2`,
        [key.projectId, key.environment],
      );
      return result.rows[0] ? scheduleFrom(result.rows[0]) : null;
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

function scheduleFrom(row: Record<string, unknown>): ProjectDatabaseBackupSchedule {
  const nextDueAt = date(row.next_due_at);
  if (!nextDueAt) throw new RepositoryError("INVALID_RECORD", "The project database backup schedule is invalid.");
  return Object.freeze({
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    environment: String(row.environment) as Environment,
    enabled: row.enabled === true,
    intervalHours: Number(row.interval_hours),
    retentionDays: Number(row.retention_days),
    nextDueAt,
    lastEnqueuedAt: date(row.last_enqueued_at),
    lastBackupId: text(row.last_backup_id),
    busyCount: Number(row.busy_count),
    databaseInstanceRef: String(row.database_instance_ref),
  });
}
