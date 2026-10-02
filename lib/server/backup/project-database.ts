import { createHash, randomUUID } from "node:crypto";
import { recognisedByName } from "@/lib/server/errors/identity";
import type { Environment } from "@/lib/types";
import type { SqlQueryable } from "@/lib/server/db/sql";
import {
  CHUNKED_HEADER_BYTES,
  DEFAULT_PART_PLAINTEXT_BYTES,
  MAX_ARTIFACT_PARTS,
  NO_PREVIOUS_TAG,
  ProjectDatabaseBackupArtifactError,
  artifactSha256,
  chunkedArtifactHeader,
  chunkedPartCount,
  chunkedPartRange,
  maxChunkedDumpBytes,
  newBackupDataKey,
  openBackupArtifact,
  openBackupPart,
  readChunkedArtifactHeader,
  sameDigest,
  sealBackupPart,
  type ProjectDatabaseBackupArtifactIdentity,
} from "@/lib/server/backup/project-database-artifact";
import {
  firstDifferingManifestPart,
  readProjectDatabaseManifest,
  type ProjectDatabaseManifest,
} from "@/lib/server/backup/project-database-manifest";

/**
 * Backup und Wiederherstellung einer **Projektdatenbank** (2.126).
 *
 * Seit 2.29 belegt QKERN ein Backup der Steuerungsdatenbank mit
 * Wiederherstellung bis zu einem Zeitpunkt. Die Datenbank eines Mandanten war
 * nie gesichert und nie wiederhergestellt. Diese Datei ist dieser Weg, und die
 * Entscheidungen darin stehen hier, nicht in einem Dokument daneben.
 *
 * ## Wer das Backup fahrt: der vorhandene Provisioner-Prozess
 *
 * QKERN hat acht belegte Prozesse. Ein neunter braucht eine Begruendung, und es
 * gibt keine: was ein Backup braucht, hat der Provisioner schon, und zwar als
 * einziger.
 *
 * 1. Er haelt bereits einen privilegierten, Vault-gestuetzten Weg zu einer
 *    Projektdatenbank. Jeder andere Prozess hat entweder keinen (Compute,
 *    Billing, die Publisher) oder einen ausdruecklich unprivilegierten
 *    (Realtime liest mit `qkern_project_api_app` unter Zeilensicherheit,
 *    Migrationen schreiben mit der Migrationsrolle ohne Leserecht auf
 *    Mandantendaten).
 * 2. Das Ziel einer Wiederherstellung ist eine **neue Datenbank**, und eine
 *    Datenbank anlegen darf in QKERN genau der Weg, der Projektdatenbanken
 *    bereitstellt. Ein zweiter Prozess mit `CREATEDB` waere eine zweite Stelle
 *    mit dem schaerfsten Recht im Cluster.
 * 3. Ein Backup ist ein Schritt im Leben einer Projektdatenbank, wie das
 *    Anlegen und das Binden. Es in einen fremden Prozess zu legen hiesse, den
 *    Lebenslauf einer Datenbank auf zwei Prozesse zu verteilen.
 *
 * **Und doch ein Auftrag in einer Queue.** Ein Backup dauert, ein Provisioner
 * soll antworten. Darum ist der Auftrag eine Zeile in
 * `project_database_backups` (0083) im Zustand `pending`, mit Lease, Versuchen
 * und festem Fehlercode -- dieselbe Form wie die Provisioning-Jobs aus 0020.
 * Der Prozess nimmt ihn in seiner **Leerlaufrunde**, also genau dann, wenn
 * sonst nichts zu tun ist; ein wartender Projektauftrag geht immer vor. Die
 * Queue ist dabei die Katalogtabelle selbst und keine zweite Tabelle daneben:
 * ein Auftrag und sein Ergebnis sind derselbe Gegenstand.
 *
 * ## Mit welcher Rolle
 *
 * Ein Backup liest **alles**, also ist die Rolle der Data API falsch:
 * `qkern_project_api_app` steht unter Zeilensicherheit und sieht je Anfrage,
 * was ein Nutzer sehen darf. Ein Backup, das mit ihr lauft, sichert die
 * Schnittmenge der Sichtbarkeiten und ist damit kein Backup.
 *
 * Gelesen wird mit einer eigenen Rolle, `qkern_project_backup`:
 * anmeldefaehig, `NOSUPERUSER`, **`BYPASSRLS`** (sonst sieht sie die Zeilen
 * nicht, die sie sichern soll), `NOCREATEDB`, `NOCREATEROLE`, und mit
 * `SELECT` auf die Mandantenschemata. Sie schreibt nicht; ein Backup, dessen
 * Rolle schreiben darf, ist ein Weg, eine Projektdatenbank aus dem
 * Backup-Pfad heraus zu aendern.
 *
 * Ihr Zugangsdatum steht **nicht** im Quelltext und **nicht** im Log: es kommt
 * aus derselben Vault-Static-Role, aus der auch der Migrations- und der
 * Realtime-Prozess ihre Zugangsdaten holen
 * (`lib/server/migrations/connection-catalog-vault.ts`). Es gibt dafuer keinen
 * zweiten Weg und keine Umgebungsvariable mit einem Passwort darin.
 *
 * Der eine Unterschied zum Katalogweg ist begruendet und steht hier, damit ihn
 * niemand fuer eine Luecke haelt: `pg_dump` ist ein **Kindprozess** und kann
 * keinen Verbindungspool benutzen. Es bekommt das Passwort darum ueber
 * `PGPASSWORD` in seiner Umgebung -- nie in `argv` (dort stuende es in
 * `ps`), nie in einer Datei und nie in einer Meldung. Siehe
 * `project-database-dump.ts`.
 *
 * ## Was ein Backup umfasst
 *
 * Ein **logischer** Dump genau dieser Datenbank, und zwar mit Schema, Zeilen,
 * Policies, Erweiterungen, Sequenzen (mit ihrem Stand) und Rechten. Warum
 * logisch und nicht physisch, steht in 0083: ein Basisbackup zieht den Cluster
 * und damit fremde Mandanten mit.
 *
 * **Ausgelassen, mit Grund:**
 *
 * - **Cluster-Rollen.** `CREATE ROLE` ist clusterweit, nicht Teil einer
 *   Datenbank. Ein Dump einer Datenbank kann sie nicht tragen, und sie in ein
 *   Mandantenartefakt zu schreiben hiesse, die Rollen aller Mandanten in das
 *   Backup eines Mandanten zu legen. Die Rollen entstehen beim Bereitstellen
 *   (`db/docker/998-project-database.sh` und der Provisioner-Weg); eine
 *   Wiederherstellung setzt voraus, dass sie da sind, und sagt das.
 * - **Zeitpunkt zwischen zwei Backups.** Ein logischer Dump ist ein
 *   Zeitpunkt, kein Fenster. Es gibt hier kein WAL-Archiv je Projektdatenbank
 *   und damit keine Wiederherstellung auf eine beliebige Sekunde. Das bleibt
 *   die Zusage des Control-Plane-Weges aus 2.29 und wird fuer Projektdaten
 *   **nicht** behauptet.
 *
 * ## Wohin die Bytes gehen, und in welcher Form
 *
 * **Stueckweise, als Strom** (2.129). 2.73.0 trug den Dump in einem Stueck durch
 * den Speicher und hatte darum eine Grenze von 256 MiB, die fuer eine echte
 * Mandantendatenbank zu klein ist. Jetzt geht die Ausgabe von `pg_dump` als
 * Strom durch die Verschluesselung in die Teile eines Multipart-Uploads; die
 * Entscheidungen dazu -- Strom statt Datei, ein Siegel je Teil, und was die AAD
 * eines Teils bindet -- stehen in `project-database-artifact.ts` und nicht hier,
 * weil sie den Umschlag betreffen.
 *
 * Die Obergrenze ist seither **gerechnet**: Nutzbytes je Teil mal Teilegrenze
 * des S3-Protokolls, also mit den Voreinstellungen `64 MiB * 10 000 = 625 GiB`
 * (`ProjectDatabaseBackupService.maxDumpBytes`). Was darueber kommt, bricht mit
 * `ARTIFACT_TOO_LARGE`, und zwar beim Teil, der die Grenze reisst, und nicht
 * nach dem ganzen Dump.
 *
 * In den Objektspeicher, den QKERN schon hat (`lib/server/project-storage`),
 * ueber einen eigenen, engen Port (`ProjectDatabaseBackupObjectStore`). Nicht
 * auf die Platte des Dienstes: ein Prozess, der Backups neben sich ablegt,
 * verliert sie mit sich. Der Weg aus 2.29 loest das **nicht** -- er legt das
 * verschluesselte Basisbackup in ein Arbeitsverzeichnis des Drill-Containers,
 * und das ist fuer einen Wegwerfstack richtig und fuer ein Produkt nicht.
 *
 * Der Objektschluessel wird **aus der Zeile abgeleitet** und nie aus einer
 * Anfrage: `project-database-backups/<organisation>/<projekt>/<umgebung>/<id>.qkbak`.
 * 0083 prueft die Form noch einmal in der Datenbank.
 *
 * ## Verschluesselung, Schluessel und wer lesen kann
 *
 * Siehe `project-database-artifact.ts`. Kurz: Datenschluessel je Backup,
 * eingewickelt in einen Mandanten-Schluessel aus dem Vault, beide Ebenen binden
 * Organisation, Projekt, Umgebung und Backup-Id als AAD. **Der Betreiber kann
 * ein Backup lesen.** Das steht dort ausgeschrieben und im Backup-Dokument.
 *
 * ## Wohin wiederhergestellt wird
 *
 * Nie ueber die lebende Datenbank. Immer in eine **neue** Datenbank, angelegt
 * vom Provisioner-Weg (`ProjectDatabaseRestoreTargetPort`), benannt nach der
 * Backup-Id. Der Betreiber sieht danach zwei Datenbanken und entscheidet selbst
 * ueber den Umschwung; QKERN tut es nicht fuer ihn. Ein `DROP DATABASE` auf
 * eine Projektdatenbank gibt es in diesem Weg nicht, und das ist eine fehlende
 * Methode, keine Absicht im Code.
 *
 * ## Mandantengrenze
 *
 * Drei Riegel, keiner davon ein Filter in einer Anfrage:
 *
 * 1. **Zeilensicherheit** in 0083 mit `FORCE`. Der Dienst lauft je Organisation
 *    (wie der Provisioner-Port), und ein `SELECT` ohne `WHERE` gibt nur die
 *    eigenen Backups.
 * 2. **Der Objektschluessel** beginnt mit der Organisation und wird aus der
 *    Zeile abgeleitet.
 * 3. **Die AAD des Umschlags.** Selbst wenn jemand fremde Bytes und beide
 *    Schluessel haette, geht der Umschlag unter einer fremden Kennung nicht auf.
 */

export const PROJECT_DATABASE_BACKUP_STATUSES = [
  "pending", "running", "available", "failed", "expired",
] as const;
export type ProjectDatabaseBackupStatus = (typeof PROJECT_DATABASE_BACKUP_STATUSES)[number];

export const PROJECT_DATABASE_BACKUP_ERROR_CODES = [
  "DUMP_FAILED", "OBJECT_STORE_UNAVAILABLE", "KEY_UNAVAILABLE",
  "CONNECTION_UNAVAILABLE", "ARTIFACT_TOO_LARGE", "LEASE_EXPIRED",
] as const;
export type ProjectDatabaseBackupErrorCode = (typeof PROJECT_DATABASE_BACKUP_ERROR_CODES)[number];

export const PROJECT_DATABASE_BACKUP_INCLUDES = [
  "schema", "rows", "policies", "extensions", "sequences", "grants",
] as const;

/**
 * In welcher Form das Artefakt liegt (0084).
 *
 * `single` ist der Weg aus 2.73.0: ein Umschlag ueber das ganze Artefakt, bis
 * 256 MiB, in einem `PUT`. Es entsteht kein neues Backup mehr in dieser Form,
 * und doch steht sie hier: Backups aus 2.73.0 liegen noch im Objektspeicher und
 * muessen sich wiederherstellen lassen. Ein Weg, der sein eigenes altes Format
 * nicht mehr liest, ist eine Aufbewahrung, die mit dem Release endet.
 *
 * `chunked` ist der stueckweise Weg aus 2.129. Siehe
 * `project-database-artifact.ts` fuer den Aufbau und die Begruendungen.
 */
export const PROJECT_DATABASE_BACKUP_ARTIFACT_FORMATS = ["single", "chunked"] as const;
export type ProjectDatabaseBackupArtifactFormat =
  (typeof PROJECT_DATABASE_BACKUP_ARTIFACT_FORMATS)[number];

/**
 * Eine bestellte Wiederherstellung (0084, 2.129).
 *
 * Sie ist ein **Auftrag** und keine Antwort auf eine Anfrage: eine
 * Wiederherstellung legt eine neue Datenbank an, und `CREATEDB` hat genau der
 * Provisioner. Die Route bestellt, der Provisioner fahrt. Es gibt **kein**
 * `attempt_count`: eine gescheiterte Wiederherstellung wird nicht wiederholt,
 * weil davor eine halb gebaute Datenbank liegt und ein zweiter Versuch an
 * `CREATE DATABASE` mit demselben Namen scheitern wuerde.
 */
export const PROJECT_DATABASE_RESTORE_STATUSES = [
  "requested", "running", "succeeded", "failed",
] as const;
export type ProjectDatabaseRestoreStatus = (typeof PROJECT_DATABASE_RESTORE_STATUSES)[number];

export const PROJECT_DATABASE_RESTORE_ERROR_CODES = [
  "BACKUP_NOT_AVAILABLE", "BACKUP_ARTIFACT_MISMATCH", "RESTORE_MANIFEST_MISMATCH",
  "OBJECT_STORE_UNAVAILABLE", "KEY_UNAVAILABLE", "CONNECTION_UNAVAILABLE", "RESTORE_FAILED",
] as const;
export type ProjectDatabaseRestoreErrorCode =
  (typeof PROJECT_DATABASE_RESTORE_ERROR_CODES)[number];

/** Die Rolle, mit der ein Backup liest. Siehe den Abschnitt "Mit welcher Rolle". */
export const PROJECT_DATABASE_BACKUP_ROLE = "qkern_project_backup";

export type ProjectDatabaseBackupScope = Readonly<{
  organizationId: string;
  projectId: string;
  environment: Environment;
}>;

export type ProjectDatabaseBackupRecord = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  environment: Environment;
  databaseInstanceRef: string;
  status: ProjectDatabaseBackupStatus;
  objectKey: string | null;
  artifactSha256: string | null;
  sizeBytes: number | null;
  wrappedDataKey: string | null;
  keyId: string | null;
  manifestSha256: string | null;
  includes: readonly string[];
  /** Die Form des Artefakts (0084). Alte Zeilen tragen `single`. */
  artifactFormat: ProjectDatabaseBackupArtifactFormat;
  /** Zahl der Teile, nur bei `chunked`. Der Leser rechnet daraus die Bytebereiche. */
  partCount: number | null;
  /** Nutzbytes je Teil, nur bei `chunked`. */
  partPlaintextBytes: number | null;
  /** Der Zustand einer bestellten Wiederherstellung (0084), oder `null`. */
  restoreStatus: ProjectDatabaseRestoreStatus | null;
  restoreRequestedAt: Date | null;
  restoreRequestedBy: string | null;
  restoreDatabaseName: string | null;
  restoreCompletedAt: Date | null;
  restoreErrorCode: ProjectDatabaseRestoreErrorCode | null;
  snapshotAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: ProjectDatabaseBackupErrorCode | null;
  createdAt: Date;
}>;

export type ProjectDatabaseBackupClaim = Readonly<{
  record: ProjectDatabaseBackupRecord;
  leaseToken: string;
}>;

export type ProjectDatabaseBackupEnqueueResult = Readonly<{
  record: ProjectDatabaseBackupRecord;
  /** `false` heisst: es wartete oder lief schon einer, und das ist er. */
  created: boolean;
}>;

export type ProjectDatabaseRestoreClaim = Readonly<{
  record: ProjectDatabaseBackupRecord;
  databaseName: string;
  leaseToken: string;
}>;

/**
 * Die Control-Plane-Seite. Jede Methode lauft in **einer** Transaktion mit
 * gesetztem `qkern.organization_id`; die Implementierung dazu steht in
 * `project-database-postgres.ts` und benutzt `withTenantTransaction`.
 */
export interface ProjectDatabaseBackupStore {
  /**
   * Legt einen Auftrag an. Mehr als ein wartender Auftrag je Umgebung ist
   * keiner, also gibt die Methode den vorhandenen zurueck, statt einen zweiten
   * anzulegen.
   *
   * **`created` sagt, ob sie wirklich eingefuegt hat**, und das ist der Befund
   * des ersten Stacklaufs von (2.129): Vorher riet der Zeitplan es aus
   * Zeitstempeln und aus dem Zustand, und ein Auftrag, den eine Route zwischen
   * zwei Takten einstellt, trug keines der Anzeichen -- er ist neuer als der
   * letzte Takt, er wartet noch, und seine Id kennt der Takt nicht. Der Takt
   * zaehlte ihn als neu, und `busy_count` blieb 0. Wer eingefuegt hat, weiss es;
   * also sagt es der, der es weiss.
   */
  enqueue(
    scope: ProjectDatabaseBackupScope,
    databaseInstanceRef: string,
  ): Promise<ProjectDatabaseBackupEnqueueResult>;
  /** Nimmt den aeltesten wartenden Auftrag mit einer Lease, oder nichts. */
  claimNext(workerId: string, leaseDurationMs: number): Promise<ProjectDatabaseBackupClaim | null>;
  /** Gibt Auftraege zurueck, deren Lease abgelaufen ist, und zaehlt ihren Versuch. */
  releaseExpiredLeases(): Promise<readonly ProjectDatabaseBackupRecord[]>;
  complete(claim: ProjectDatabaseBackupClaim, result: Readonly<{
    objectKey: string;
    artifactSha256: string;
    sizeBytes: number;
    wrappedDataKey: string;
    keyId: string;
    manifestSha256: string;
    includes: readonly string[];
    artifactFormat: ProjectDatabaseBackupArtifactFormat;
    partCount: number;
    partPlaintextBytes: number;
    snapshotAt: Date;
    completedAt: Date;
    expiresAt: Date;
  }>): Promise<ProjectDatabaseBackupRecord>;
  recordFailure(
    claim: ProjectDatabaseBackupClaim,
    errorCode: ProjectDatabaseBackupErrorCode,
  ): Promise<ProjectDatabaseBackupRecord>;
  get(backupId: string): Promise<ProjectDatabaseBackupRecord | null>;
  list(scope: ProjectDatabaseBackupScope, limit: number): Promise<readonly ProjectDatabaseBackupRecord[]>;
  /** Hoechstens `limit` abgelaufene Backups, aelteste zuerst. */
  findExpired(expiredBefore: Date, limit: number): Promise<readonly ProjectDatabaseBackupRecord[]>;
  /**
   * Bestellt eine Wiederherstellung (2.129). `null` heisst: das Backup ist nicht
   * da, nicht verfuegbar, oder es laeuft schon eine -- und die Unterscheidung
   * trifft der Aufrufer anhand des Datensatzes, den er vorher gelesen hat. Die
   * Anweisung selbst nennt keinen Grund, weil sie keinen kennt: sie hat eine
   * Zeile nicht getroffen.
   */
  requestRestore(input: Readonly<{
    backupId: string; databaseName: string; requestedBy: string; at: Date;
  }>): Promise<ProjectDatabaseBackupRecord | null>;
  /** Nimmt die aelteste bestellte Wiederherstellung mit einer Lease, oder nichts. */
  claimNextRestore(leaseDurationMs: number): Promise<ProjectDatabaseRestoreClaim | null>;
  completeRestore(claim: ProjectDatabaseRestoreClaim, completedAt: Date): Promise<void>;
  failRestore(
    claim: ProjectDatabaseRestoreClaim,
    errorCode: ProjectDatabaseRestoreErrorCode,
    completedAt: Date,
  ): Promise<void>;
  /**
   * Erklaert Wiederherstellungen mit abgelaufener Lease fuer gescheitert. Nicht
   * "wieder bestellt": eine Wiederherstellung wird nicht wiederholt, und ein
   * Wirt, der mitten darin gestorben ist, hat eine halbe Datenbank
   * hinterlassen.
   */
  failExpiredRestoreLeases(): Promise<readonly ProjectDatabaseBackupRecord[]>;
  /** Setzt ein abgelaufenes Backup auf `expired` und nimmt ihm Schluessel und Objektverweis. */
  forget(backupId: string): Promise<void>;
}

/**
 * Der Dump. Siehe `project-database-dump.ts`: warum ein Kindprozess und wie das
 * Passwort dorthin kommt.
 *
 * `dumpStream` gibt einen **Strom** und keinen Puffer (2.129). Der Puffer war
 * die Grenze von 256 MiB; der Strom ist der Weg darueber hinaus. Wer den Strom
 * schliesst, beendet den Kindprozess -- das ist die Zusage dieser
 * Schnittstelle, denn sonst laeuft ein `pg_dump` ueber eine fremde Datenbank
 * weiter, nachdem der Dienst aufgegeben hat.
 */
export interface ProjectDatabaseDumpPort {
  dumpStream(
    input: Readonly<{ databaseInstanceRef: string }>,
    signal?: AbortSignal,
  ): Promise<ProjectDatabaseDumpStream>;
  /** Eine Verbindung zum Lesen des Manifests, mit derselben Rolle wie der Dump. */
  withReader<T>(
    input: Readonly<{ databaseInstanceRef: string }>,
    operation: (database: SqlQueryable) => Promise<T>,
  ): Promise<T>;
}

export type ProjectDatabaseDumpStream = Readonly<{
  chunks: AsyncIterable<Buffer>;
  /** Bricht den Kindprozess ab. Darf mehrmals gerufen werden und wirft nicht. */
  cancel(): void;
}>;

/** Das Ziel einer Wiederherstellung: eine neue, leere Datenbank, und der Weg, einen Dump hineinzuspielen. */
export interface ProjectDatabaseRestoreTargetPort {
  createDatabase(
    input: Readonly<{ databaseInstanceRef: string; databaseName: string }>,
    signal?: AbortSignal,
  ): Promise<void>;
  /**
   * Der Dump kommt als **Strom** in `stdin` von `psql` (2.129). Ein Puffer
   * hiesse, das ganze Artefakt vor dem ersten Byte im Speicher zu haben, und
   * damit waere die Grenze auf der Leseseite wieder da, wo sie auf der
   * Schreibseite gerade weg ist.
   */
  restore(
    input: Readonly<{
      databaseInstanceRef: string;
      databaseName: string;
      dump: AsyncIterable<Buffer>;
    }>,
    signal?: AbortSignal,
  ): Promise<void>;
  withReader<T>(
    input: Readonly<{ databaseInstanceRef: string; databaseName: string }>,
    operation: (database: SqlQueryable) => Promise<T>,
  ): Promise<T>;
}

export type ProjectDatabaseBackupUploadedPart = Readonly<{ partNumber: number; etag: string }>;

/**
 * Der Objektspeicher. **Kein `put`** (2.129): es gab im Produkt keinen Aufrufer
 * mehr, nachdem der Weg stueckweise wurde, und eine Methode ohne Aufrufer ist
 * genau das Muster, das 2.73.0 an drei Stellen gefunden hat.
 */
export interface ProjectDatabaseBackupObjectStore {
  beginMultipart(key: string, signal?: AbortSignal): Promise<string>;
  putPart(input: Readonly<{
    key: string; uploadId: string; partNumber: number; bytes: Buffer;
  }>, signal?: AbortSignal): Promise<ProjectDatabaseBackupUploadedPart>;
  completeMultipart(input: Readonly<{
    key: string; uploadId: string; parts: readonly ProjectDatabaseBackupUploadedPart[];
  }>, signal?: AbortSignal): Promise<void>;
  abortMultipart(key: string, uploadId: string, signal?: AbortSignal): Promise<void>;
  getRange(key: string, offset: number, length: number, signal?: AbortSignal): Promise<Buffer>;
  /** Ganz, und nur noch fuer Artefakte im Format `single` aus 2.73.0. */
  get(key: string, signal?: AbortSignal): Promise<Buffer>;
  delete(key: string, signal?: AbortSignal): Promise<void>;
}

/**
 * Der Mandanten-Schluessel bleibt **innerhalb** dieser Schnittstelle. Sie gibt
 * ihn nicht heraus; sie wickelt ein und aus. Eine Schnittstelle, die den
 * Schluessel selbst liefert, haette fuer jeden Aufrufer eine Stelle, an der er
 * in einem Log landen kann.
 */
export interface ProjectDatabaseBackupDataKeyProtector {
  wrap(input: Readonly<{
    dataKey: Buffer;
    identity: ProjectDatabaseBackupArtifactIdentity;
  }>): Promise<Readonly<{ keyId: string; wrapped: string }>>;
  unwrap(input: Readonly<{
    wrapped: string;
    keyId: string;
    identity: ProjectDatabaseBackupArtifactIdentity;
  }>): Promise<Buffer>;
}

export type ProjectDatabaseBackupLogEvent = Readonly<{
  event:
    | "project_database_backup.claimed"
    | "project_database_backup.succeeded"
    | "project_database_backup.failed"
    | "project_database_backup.lease_released"
    | "project_database_backup.restored"
    | "project_database_backup.restore_claimed"
    | "project_database_backup.restore_failed"
    | "project_database_backup.pruned"
    | "project_database_backup.round_failed"
    /** Der Zeitplan hat einen Auftrag eingestellt (2.129). */
    | "project_database_backup.scheduled"
    /** Faellig, aber der vorige Lauf war noch nicht fertig (2.129). */
    | "project_database_backup.schedule_busy"
    | "project_database_backup.schedule_failed";
  /** Eine Backup-Id, kein Objektschluessel, kein Schluessel-Name, keine Groesse in Bytes eines Mandanten. */
  backupId?: string;
  projectId?: string;
  environment?: Environment;
  attempt?: number;
  errorCode?: ProjectDatabaseBackupErrorCode | ProjectDatabaseRestoreErrorCode;
  /**
   * Welcher Schritt des Dumps gescheitert ist, wenn es einer war. Ein
   * Fehlschlag, der nur sich selbst meldet, laesst zwischen Vault,
   * Verbindungszeile und Kindprozess raten; der erste Lauf dieses Falls hat das
   * vorgefuehrt.
   */
  step?: string;
  /** Nur die Fehlerklasse, nie eine Meldung (dieselbe Regel wie im Provisioner-Log). */
  reason?: string;
  removed?: number;
}>;

export type ProjectDatabaseBackupRoundResult =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "succeeded"; backupId: string }>
  | Readonly<{ status: "failed"; backupId: string; errorCode: ProjectDatabaseBackupErrorCode }>
  | Readonly<{ status: "restored"; backupId: string }>
  | Readonly<{
    status: "restore_failed"; backupId: string; errorCode: ProjectDatabaseRestoreErrorCode;
  }>
  | Readonly<{ status: "aborted" }>
  | Readonly<{ status: "round_failed" }>;

export type ProjectDatabaseRestoreResult = Readonly<{
  backupId: string;
  databaseName: string;
  /** Das Manifest des gesicherten Standes, wie es im Backup steht. */
  expectedManifestSha256: string;
  /** Das Manifest der wiederhergestellten Datenbank. */
  restoredManifestSha256: string;
  restoredManifest: ProjectDatabaseManifest;
}>;

export type ProjectDatabaseBackupServiceErrorCode =
  | "BACKUP_NOT_FOUND"
  | "BACKUP_NOT_AVAILABLE"
  | "BACKUP_ARTIFACT_MISMATCH"
  | "RESTORE_MANIFEST_MISMATCH"
  | "RESTORE_ALREADY_REQUESTED"
  | "INVALID_CONFIGURATION";

export class ProjectDatabaseBackupServiceError extends Error {
  readonly code: ProjectDatabaseBackupServiceErrorCode;
  /** Beim Manifestfehler: der erste Teil, der abweicht. Ein Name, kein Inhalt. */
  readonly differingPart?: string;
  constructor(code: ProjectDatabaseBackupServiceErrorCode, differingPart?: string) {
    super(serviceMessageFor(code));
    this.name = "ProjectDatabaseBackupServiceError";
    this.code = code;
    if (differingPart) this.differingPart = differingPart;
  }
}
recognisedByName(ProjectDatabaseBackupServiceError, "ProjectDatabaseBackupServiceError");

export type ProjectDatabaseBackupServiceOptions = Readonly<{
  store: ProjectDatabaseBackupStore;
  dump: ProjectDatabaseDumpPort;
  objects: ProjectDatabaseBackupObjectStore;
  keys: ProjectDatabaseBackupDataKeyProtector;
  restoreTarget: ProjectDatabaseRestoreTargetPort;
  workerId: string;
  /** Aufbewahrung in Tagen. Siehe `retentionDays` weiter unten: warum 30 und warum eine Obergrenze. */
  retentionDays?: number;
  leaseDurationMs?: number;
  /** Einspeisbare Uhr. Ohne sie waere eine Frist von 30 Tagen nur in 30 Tagen pruefbar. */
  now?: () => Date;
  logger?: { log(event: ProjectDatabaseBackupLogEvent): void };
  /**
   * Nutzbytes je Teil. Voreinstellung ist der Produktwert
   * (`DEFAULT_PART_PLAINTEXT_BYTES`, 64 MiB).
   *
   * **Warum einspeisbar.** Die Obergrenze eines Dumps ist nicht gesetzt, sie ist
   * gerechnet: Teilegroesse mal Teilezahl. Ein Fall, der die Grenze pruefen
   * will, muesste bei den Produktwerten 625 GiB schreiben. Mit kleineren Werten
   * prueft er **dieselbe** Rechnung, dasselbe Siegeln, dieselbe Kette, denselben
   * Multipart-Upload und dieselben Bytebereiche -- der Produktweg ist derselbe
   * Code, nur mit anderen zwei Zahlen. Was ein Fall damit **nicht** belegt, ist
   * dass 625 GiB durchgehen; das steht so in `docs/RELEASE_*` und im
   * Backup-Dokument.
   *
   * Unter `MIN_S3_PART_BYTES` (5 MiB) weist S3 den Abschluss eines Uploads mit
   * mehr als einem Teil ab. Das prueft der Dienst **nicht** weg: er laesst
   * kleinere Werte zu und sagt im Log nichts dazu, weil ein Stack mit versitygw
   * sie nimmt und ein Betreiber, der sie in Produktion setzt, einen Fehlschlag
   * des Objektspeichers bekommt und keinen stillen Datenverlust. Eine Zusage,
   * die der Anbieter schon haelt, hier ein zweites Mal zu halten, waere zwei
   * Antworten auf dieselbe Frage.
   */
  partPlaintextBytes?: number;
  /** Teilegrenze. Voreinstellung ist die des S3-Protokolls (10 000). */
  maxParts?: number;
  /** Der Zeitplan (2.129). Ohne ihn stellt niemand von sich aus Auftraege ein. */
  schedule?: ProjectDatabaseBackupScheduleDuty;
}>;

/**
 * Der Zeitplan, aus der Sicht der Runde.
 *
 * Er ist eine **Pflicht in derselben Runde** und kein zweiter Scheduler; die
 * Begruendung steht in `project-database-schedule.ts`.
 */
export interface ProjectDatabaseBackupScheduleDuty {
  tick(signal?: AbortSignal): Promise<unknown>;
  /**
   * Die Aufbewahrungsfrist **dieser Umgebung**, oder `null`, wenn es keine
   * Zeitplanzeile gibt.
   *
   * Sie steht hier und nicht in den Optionen des Dienstes, weil sie je Umgebung
   * gilt: `QKERN_PROJECT_BACKUP_RETENTION_DAYS` galt fuer alle Projekte und alle
   * Umgebungen eines Prozesses gleich, und ein Betreiber, der Produktion 30 Tage
   * und Staging 7 Tage halten will, brauchte dafuer zwei Prozesse. Die Variable
   * bleibt als Vorgabe; was die Zeile sagt, gewinnt.
   */
  retentionDaysFor(
    scope: Readonly<{ projectId: string; environment: Environment }>,
  ): Promise<number | null>;
}

/**
 * Die Aufbewahrung.
 *
 * **30 Tage**, und die Zahl ist nicht gewuerfelt: Supabase gibt auf den
 * bezahlten Stufen sieben bis 28 Tage taegliche Backups, und wer von dort
 * kommt, erwartet mindestens einen Monat. Kuerzer waere eine Zusage unter dem
 * Vergleichsprodukt; laenger ist keine Aufbewahrung mehr, sondern eine Archiv-
 * zusage, und die braucht eine Aussage ueber Ort und Kosten, die QKERN heute
 * nicht hat.
 *
 * Die Obergrenze von **730 Tagen** ist dieselbe wie bei der Erklaerung zum
 * WAL-Archiv (`point-in-time.ts`): zwei Wege, die beide ueber Aufbewahrung
 * reden, sollen nicht zwei Obergrenzen haben.
 */
export const DEFAULT_BACKUP_RETENTION_DAYS = 30;
export const MAX_BACKUP_RETENTION_DAYS = 730;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Zeilen je Runde des Aufraeumers. Siehe `pruneExpired`. */
export const DEFAULT_PRUNE_BATCH_SIZE = 25;
export const MAX_PRUNE_BATCHES = 20;

const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class ProjectDatabaseBackupService {
  private readonly store: ProjectDatabaseBackupStore;
  private readonly dumpPort: ProjectDatabaseDumpPort;
  private readonly objects: ProjectDatabaseBackupObjectStore;
  private readonly keys: ProjectDatabaseBackupDataKeyProtector;
  private readonly restoreTarget: ProjectDatabaseRestoreTargetPort;
  private readonly workerId: string;
  private readonly retentionDays: number;
  private readonly leaseDurationMs: number;
  private readonly now: () => Date;
  private readonly logger: { log(event: ProjectDatabaseBackupLogEvent): void };
  private readonly partPlaintextBytes: number;
  private readonly maxParts: number;
  private schedule?: ProjectDatabaseBackupScheduleDuty;

  constructor(options: ProjectDatabaseBackupServiceOptions) {
    if (!options || typeof options.workerId !== "string" || !WORKER_ID.test(options.workerId)) {
      throw new ProjectDatabaseBackupServiceError("INVALID_CONFIGURATION");
    }
    this.store = options.store;
    this.dumpPort = options.dump;
    this.objects = options.objects;
    this.keys = options.keys;
    this.restoreTarget = options.restoreTarget;
    this.workerId = options.workerId;
    this.retentionDays = bounded(options.retentionDays ?? DEFAULT_BACKUP_RETENTION_DAYS, 1, MAX_BACKUP_RETENTION_DAYS);
    this.leaseDurationMs = bounded(options.leaseDurationMs ?? 600_000, 10_000, 3_600_000);
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? { log: () => undefined };
    this.partPlaintextBytes = bounded(
      options.partPlaintextBytes ?? DEFAULT_PART_PLAINTEXT_BYTES, 1_024, 256 * 1024 * 1024,
    );
    this.maxParts = bounded(options.maxParts ?? MAX_ARTIFACT_PARTS, 1, MAX_ARTIFACT_PARTS);
    this.schedule = options.schedule;
  }

  /**
   * Haengt den Zeitplan an. Er kommt nachtraeglich und nicht ueber den
   * Konstruktor, weil er den Dienst selbst braucht: er stellt Auftraege ueber
   * `enqueue` ein und raeumt ueber `pruneExpired` auf. Eine Fabrik im
   * Konstruktor haette dasselbe geleistet und niemandem mehr gezeigt, wer wen
   * ruft.
   */
  useSchedule(schedule: ProjectDatabaseBackupScheduleDuty): void {
    this.schedule = schedule;
  }

  /**
   * Die Obergrenze eines Dumps auf diesem Dienst, in Bytes Klartext. Sie wird
   * gerechnet und nicht gehalten; wer sie wissen will, fragt hier und liest
   * keine Konstante ab.
   */
  get maxDumpBytes(): number {
    return maxChunkedDumpBytes(this.partPlaintextBytes, this.maxParts);
  }

  /**
   * Bestellt ein Backup. Gibt den Auftrag zurueck -- ob er neu ist, fragt wer es
   * braucht ueber `enqueueBackup`.
   */
  async enqueue(
    scope: ProjectDatabaseBackupScope,
    databaseInstanceRef: string,
  ): Promise<ProjectDatabaseBackupRecord> {
    return (await this.store.enqueue(scope, databaseInstanceRef)).record;
  }

  /** Wie `enqueue`, und sagt dazu, ob wirklich einer entstanden ist. */
  enqueueBackup(
    scope: ProjectDatabaseBackupScope,
    databaseInstanceRef: string,
  ): Promise<ProjectDatabaseBackupEnqueueResult> {
    return this.store.enqueue(scope, databaseInstanceRef);
  }

  list(scope: ProjectDatabaseBackupScope, limit = 50): Promise<readonly ProjectDatabaseBackupRecord[]> {
    return this.store.list(scope, bounded(limit, 1, 200));
  }

  /**
   * Eine Runde: abgelaufene Leases zurueckgeben, einen Auftrag nehmen, ihn
   * fahren. Eine Runde macht **ein** Backup und nicht alle: ein Prozess, der in
   * einer Runde alles abarbeitet, ist einer, den ein Stopp mitten in der Arbeit
   * trifft, und dessen Leerlauf nie eintritt.
   */
  async runRound(signal?: AbortSignal): Promise<ProjectDatabaseBackupRoundResult> {
    if (signal?.aborted) return { status: "aborted" };
    // Der Zeitplan laeuft **vor** dem Claim und in derselben Runde (2.129). Was
    // er einstellt, nimmt dieselbe Runde noch mit, also braucht ein faelliges
    // Backup nicht zwei Runden. Ein Fehlschlag des Zeitplans kippt die Runde
    // nicht: er loggt selbst, und ein Auftrag, der schon wartet, soll nicht
    // daran haengen, dass eine Fristzeile kaputt ist.
    if (this.schedule) {
      try { await this.schedule.tick(signal); } catch { /* der Zeitplan loggt selbst */ }
      if (signal?.aborted) return { status: "aborted" };
    }
    try {
      for (const released of await this.store.releaseExpiredLeases()) {
        this.log({
          event: "project_database_backup.lease_released",
          backupId: released.id,
          projectId: released.projectId,
          environment: released.environment,
          attempt: released.attemptCount,
          errorCode: "LEASE_EXPIRED",
        });
      }
    } catch (error) {
      this.log({ event: "project_database_backup.round_failed", reason: reasonOf(error) });
      return { status: "round_failed" };
    }

    // Eine bestellte Wiederherstellung geht **vor** einem Backup, und zwar aus
    // demselben Grund, aus dem ein Projektauftrag vor dem Backup geht: dort
    // wartet jemand. Eine Wiederherstellung bestellt ein Mensch, der gerade
    // Daten verloren hat; ein Backup bestellt eine Uhr.
    const restored = await this.runRestoreRound(signal);
    if (restored) return restored;

    let claim: ProjectDatabaseBackupClaim | null;
    try {
      claim = await this.store.claimNext(this.workerId, this.leaseDurationMs);
    } catch (error) {
      this.log({ event: "project_database_backup.round_failed", reason: reasonOf(error) });
      return { status: "round_failed" };
    }
    if (!claim) return { status: "idle" };
    this.log({
      event: "project_database_backup.claimed",
      backupId: claim.record.id,
      projectId: claim.record.projectId,
      environment: claim.record.environment,
      attempt: claim.record.attemptCount,
    });

    let outcome: Awaited<ReturnType<ProjectDatabaseBackupService["produce"]>>;
    try {
      outcome = await this.produce(claim, signal);
    } catch (error) {
      const errorCode = backupErrorCode(error);
      try {
        const failed = await this.store.recordFailure(claim, errorCode);
        this.log({
          event: "project_database_backup.failed",
          backupId: failed.id,
          projectId: failed.projectId,
          environment: failed.environment,
          attempt: failed.attemptCount,
          errorCode,
          ...(dumpStep(error) ? { step: dumpStep(error) } : {}),
        });
      } catch (storeError) {
        this.log({ event: "project_database_backup.round_failed", reason: reasonOf(storeError) });
      }
      return { status: "failed", backupId: claim.record.id, errorCode };
    }

    try {
      const completed = await this.store.complete(claim, outcome);
      this.log({
        event: "project_database_backup.succeeded",
        backupId: completed.id,
        projectId: completed.projectId,
        environment: completed.environment,
        attempt: completed.attemptCount,
      });
      return { status: "succeeded", backupId: completed.id };
    } catch (error) {
      // Die Bytes liegen, die Zeile nicht. Das Artefakt wird weggeraeumt: ein
      // Objekt, auf das keine Zeile zeigt, kann niemand mehr finden und niemand
      // mehr entschluesseln -- der Datenschluessel lag nur in der Zeile, die
      // nicht zustande kam. Scheitert auch das Wegraeumen, bleibt ein Objekt
      // liegen; es ist dann unlesbarer Muell, und der Aufraeumer des
      // Objektspeichers findet es ueber das Praefix.
      await this.objects.delete(outcome.objectKey).catch(() => undefined);
      this.log({ event: "project_database_backup.round_failed", reason: reasonOf(error) });
      return { status: "round_failed" };
    }
  }

  /**
   * Die bestellte Wiederherstellung dieser Runde, oder `null`, wenn keine
   * bestellt ist (2.129).
   *
   * Sie steht als eigene Methode da und nicht im Rumpf von `runRound`, weil sie
   * eine eigene Lease, einen eigenen Fehlersatz und ein eigenes "nicht
   * wiederholen" hat. Was sie mit dem Backup teilt, ist die Runde und sonst
   * nichts.
   */
  private async runRestoreRound(
    signal?: AbortSignal,
  ): Promise<ProjectDatabaseBackupRoundResult | null> {
    let claim: ProjectDatabaseRestoreClaim | null;
    try {
      for (const stuck of await this.store.failExpiredRestoreLeases()) {
        this.log({
          event: "project_database_backup.restore_failed",
          backupId: stuck.id,
          projectId: stuck.projectId,
          environment: stuck.environment,
          errorCode: "RESTORE_FAILED",
        });
      }
      claim = await this.store.claimNextRestore(this.leaseDurationMs);
    } catch (error) {
      this.log({ event: "project_database_backup.round_failed", reason: reasonOf(error) });
      return { status: "round_failed" };
    }
    if (!claim) return null;
    this.log({
      event: "project_database_backup.restore_claimed",
      backupId: claim.record.id,
      projectId: claim.record.projectId,
      environment: claim.record.environment,
    });
    try {
      await this.restoreToNewDatabase(
        { backupId: claim.record.id, databaseName: claim.databaseName }, signal,
      );
    } catch (error) {
      const errorCode = restoreErrorCode(error);
      try {
        await this.store.failRestore(claim, errorCode, this.now());
      } catch (storeError) {
        this.log({ event: "project_database_backup.round_failed", reason: reasonOf(storeError) });
        return { status: "round_failed" };
      }
      this.log({
        event: "project_database_backup.restore_failed",
        backupId: claim.record.id,
        projectId: claim.record.projectId,
        environment: claim.record.environment,
        errorCode,
      });
      return { status: "restore_failed", backupId: claim.record.id, errorCode };
    }
    try {
      await this.store.completeRestore(claim, this.now());
    } catch (error) {
      // Die Datenbank steht, die Zeile nicht. Hier wird **nichts** weggeraeumt:
      // eine wiederhergestellte Datenbank zu loeschen, weil eine Zeile nicht
      // zustande kam, waere das Loeschen genau der Daten, die jemand gerade
      // zurueckhaben wollte. Die Lease laeuft ab, die Zeile wird `failed`, und
      // der Betreiber findet eine Datenbank, die mehr ist als die Zeile sagt.
      this.log({ event: "project_database_backup.round_failed", reason: reasonOf(error) });
      return { status: "round_failed" };
    }
    return { status: "restored", backupId: claim.record.id };
  }

  /**
   * Bestellt eine Wiederherstellung (2.129). Der Name der Zieldatenbank kommt
   * aus der Backup-Id und nie aus einer Anfrage.
   */
  async requestRestore(input: Readonly<{
    backupId: string; requestedBy: string;
  }>): Promise<ProjectDatabaseBackupRecord> {
    const record = await this.store.get(input.backupId);
    if (!record) throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_FOUND");
    if (record.status !== "available") {
      throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_AVAILABLE");
    }
    // Eine zweite Bestellung, waehrend die erste laeuft, ist keine zweite
    // Wiederherstellung: beide zielten auf denselben Datenbanknamen, und die
    // zweite wuerde an `CREATE DATABASE` scheitern.
    if (record.restoreStatus === "requested" || record.restoreStatus === "running") {
      throw new ProjectDatabaseBackupServiceError("RESTORE_ALREADY_REQUESTED");
    }
    const databaseName = restoreDatabaseName(record.id);
    assertDatabaseName(databaseName);
    const requested = await this.store.requestRestore({
      backupId: record.id, databaseName, requestedBy: input.requestedBy, at: this.now(),
    });
    if (!requested) throw new ProjectDatabaseBackupServiceError("RESTORE_ALREADY_REQUESTED");
    return requested;
  }

  /**
   * Wiederherstellung in eine **neue** Datenbank, und zwar mit Nachweis in
   * derselben Runde: das Manifest der wiederhergestellten Datenbank muss dem
   * Manifest entsprechen, das zum Zeitpunkt des Backups gemessen wurde. Stimmt
   * es nicht, ist das Ergebnis ein Fehler und keine Datenbank, die jemand fuer
   * wiederhergestellt haelt.
   */
  async restoreToNewDatabase(
    input: Readonly<{ backupId: string; databaseName?: string }>,
    signal?: AbortSignal,
  ): Promise<ProjectDatabaseRestoreResult> {
    const record = await this.store.get(input.backupId);
    if (!record) throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_FOUND");
    if (record.status !== "available" || !record.objectKey || !record.wrappedDataKey ||
        !record.keyId || !record.artifactSha256 || !record.manifestSha256) {
      throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_AVAILABLE");
    }
    const identity = identityOf(record);
    const dataKey = await this.keys.unwrap({
      wrapped: record.wrappedDataKey,
      keyId: record.keyId,
      identity,
    });
    const dump = record.artifactFormat === "chunked"
      ? this.chunkedDump(record, identity, dataKey, signal)
      : await this.singleDump(record, identity, dataKey, signal);

    const databaseName = input.databaseName ?? restoreDatabaseName(record.id);
    assertDatabaseName(databaseName);
    await this.restoreTarget.createDatabase({
      databaseInstanceRef: record.databaseInstanceRef,
      databaseName,
    }, signal);
    await this.restoreTarget.restore({
      databaseInstanceRef: record.databaseInstanceRef,
      databaseName,
      dump,
    }, signal);

    // Zweimal genullt ist harmlos; nie genullt ist es nicht. Die Generatoren
    // nullen am Ende ihres Laufs, und dieser Aufruf fasst den Fall, dass einer
    // vorher abgebrochen wurde.
    dataKey.fill(0);

    const restoredManifest = await this.restoreTarget.withReader(
      { databaseInstanceRef: record.databaseInstanceRef, databaseName },
      (database) => readProjectDatabaseManifest(database),
    );
    this.log({
      event: "project_database_backup.restored",
      backupId: record.id,
      projectId: record.projectId,
      environment: record.environment,
    });
    return Object.freeze({
      backupId: record.id,
      databaseName,
      expectedManifestSha256: record.manifestSha256,
      restoredManifestSha256: restoredManifest.sha256,
      restoredManifest,
    });
  }

  /**
   * Ein Artefakt im Format von 2.73.0: ganz holen, Pruefsumme vor dem
   * Schluessel, einmal aufmachen. Das ist der alte Weg, und er bleibt genau
   * dafuer: Backups, die vor 2.129 entstanden sind, liegen so da.
   *
   * Hier gilt die Grenze von 2.73.0 weiter, und sie muss es: ein Artefakt in
   * dieser Form geht in einem Stueck durch den Speicher, und daran aendert ein
   * stueckweiser Schreibweg nichts.
   */
  private async *singleDump(
    record: ProjectDatabaseBackupRecord,
    identity: ProjectDatabaseBackupArtifactIdentity,
    dataKey: Buffer,
    signal?: AbortSignal,
  ): AsyncGenerator<Buffer> {
    try {
      const artifact = await this.objects.get(record.objectKey!, signal);
      // Die Pruefsumme vor dem Schluessel: ein Artefakt, das unterwegs
      // verstuemmelt wurde, soll das sagen und nicht wie ein Schluesselfehler
      // aussehen.
      if (!sameDigest(artifactSha256(artifact), record.artifactSha256!)) {
        throw new ProjectDatabaseBackupServiceError("BACKUP_ARTIFACT_MISMATCH");
      }
      yield openBackupArtifact({ artifact, dataKey, identity });
    } finally {
      dataKey.fill(0);
    }
  }

  /**
   * Ein stueckweises Artefakt lesen, **ohne** das Ganze in den Speicher zu
   * nehmen (2.129).
   *
   * Je Teil ein Bytebereich, je Teil ein Siegel, und die Kette in der
   * Reihenfolge erzwungen. Was dabei geprueft wird, und in welcher Reihenfolge:
   *
   * 1. **Die Teilezahl wird gerechnet** (aus Groesse und Teilegroesse) und
   *    gegen die Zeile gehalten. Weichen sie ab, ist das Artefakt nicht das, von
   *    dem die Zeile spricht, und zwar **vor** dem ersten Byte Klartext.
   * 2. **Der Kopf wird gelesen** und seine Teilegroesse gegen die der Zeile
   *    gehalten. Er steht ausserdem in jeder AAD, also bricht eine Aenderung
   *    daran ohnehin jedes Siegel; diese Pruefung sagt nur, **was** kaputt ist.
   * 3. **Je Teil das Tag**, mit Nummer, `final`-Zeichen und Tag des Vorgaengers
   *    in der AAD. Ein Teil, der nicht passt, bricht den Lauf, bevor sein
   *    Klartext hinausgeht.
   * 4. **Am Ende der SHA-256 des ganzen Artefakts**, laufend mitgerechnet, gegen
   *    die Zeile.
   *
   * Punkt 4 ist nicht mehr der Riegel **vor** dem Lesen, der er in 2.73.0 war,
   * und das ist der Preis des stueckweisen Weges: wer streamt, kennt die Summe
   * des Ganzen erst am Ende. Was an seine Stelle tritt, ist stark genug: das
   * GCM-Tag je Teil ist eine **geschluesselte** Pruefung und damit scharfer als
   * ein SHA-256, und es wird vor jedem Teil geprueft. Der SHA-256 bleibt als die
   * Aussage "dieses Objekt ist das, das die Zeile vermerkt hat", und er faellt
   * am Ende.
   *
   * **Ein Objekt, das kuerzer ist als seine Zeile**, faellt nicht an Punkt 1
   * auf: die Teilezahl wird aus `size_bytes` der **Zeile** gerechnet, und die
   * Zeile kennt die Groesse, die das Backup beim Schreiben hatte. Es faellt am
   * Bytebereich auf, und zwar mit dem Code des Objektspeichers
   * (`OBJECT_CHECKSUM_MISMATCH`). Das ist bewusst so gelassen: eine zusaetzliche
   * `HEAD`-Anfrage je Wiederherstellung, nur um denselben Fehlschlag frueher und
   * mit einem anderen Code zu melden, waere ein Rundgang mehr fuer dieselbe
   * Aussage. Was nicht passiert, ist ein stilles Durchgehen.
   *
   * Was das kostet, steht hier und nicht in einem Dokument: ein Fehlschlag am
   * Ende trifft eine Wiederherstellung, in die `psql` schon Teile gespielt hat.
   * Das ist tragbar, **weil** die Wiederherstellung in eine **neue** Datenbank
   * geht. Was zurueckbleibt, ist eine halbe neue Datenbank und ein Fehler, nicht
   * eine beschaedigte lebende Datenbank.
   */
  private async *chunkedDump(
    record: ProjectDatabaseBackupRecord,
    identity: ProjectDatabaseBackupArtifactIdentity,
    dataKey: Buffer,
    signal?: AbortSignal,
  ): AsyncGenerator<Buffer> {
    try {
      const objectKey = record.objectKey!;
      const artifactBytes = record.sizeBytes ?? 0;
      const partPlaintextBytes = record.partPlaintextBytes ?? 0;
      const expectedParts = record.partCount ?? 0;
      if (partPlaintextBytes < 1 || expectedParts < 1) {
        throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_AVAILABLE");
      }
      if (chunkedPartCount(artifactBytes, partPlaintextBytes) !== expectedParts) {
        throw new ProjectDatabaseBackupServiceError("BACKUP_ARTIFACT_MISMATCH");
      }
      const digest = createHash("sha256");
      let previousTagHex = NO_PREVIOUS_TAG;
      for (let partNumber = 1; partNumber <= expectedParts; partNumber += 1) {
        if (signal?.aborted) throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_AVAILABLE");
        const range = chunkedPartRange({
          partNumber, partCount: expectedParts, artifactBytes, partPlaintextBytes,
        });
        const fetchOffset = partNumber === 1 ? 0 : range.offset;
        const fetchLength = partNumber === 1 ? CHUNKED_HEADER_BYTES + range.length : range.length;
        const bytes = await this.objects.getRange(objectKey, fetchOffset, fetchLength, signal);
        let part = bytes;
        if (partNumber === 1) {
          if (readChunkedArtifactHeader(bytes) !== partPlaintextBytes) {
            throw new ProjectDatabaseBackupServiceError("BACKUP_ARTIFACT_MISMATCH");
          }
          digest.update(bytes.subarray(0, CHUNKED_HEADER_BYTES));
          part = bytes.subarray(CHUNKED_HEADER_BYTES);
        }
        digest.update(part);
        const opened = openBackupPart({
          part, dataKey, identity, partPlaintextBytes, partNumber,
          final: partNumber === expectedParts, previousTagHex,
        });
        previousTagHex = opened.tagHex;
        yield opened.chunk;
      }
      if (!sameDigest(digest.digest("hex"), record.artifactSha256!)) {
        throw new ProjectDatabaseBackupServiceError("BACKUP_ARTIFACT_MISMATCH");
      }
    } finally {
      dataKey.fill(0);
    }
  }

  /**
   * Der Aufraeumer. Portionsweise, mit Obergrenze, mit einspeisbarer Uhr --
   * dasselbe Muster wie `ProjectAuthExpiryRetention` und aus denselben Gruenden:
   * eine Runde darf keine Tabelle laenger halten als eine Portion dauert, und
   * eine Frist von 30 Tagen muss sich pruefen lassen, ohne 30 Tage zu warten.
   *
   * Die Reihenfolge ist nicht beliebig: **erst das Objekt, dann die Zeile.**
   * Umgekehrt waere eine Zeile weg, deren Objekt noch liegt, und dann kennt
   * niemand mehr den Schluessel, unter dem es liegt. Scheitert das Loeschen des
   * Objekts, bleibt die Zeile stehen und die naechste Runde versucht es wieder.
   */
  async pruneExpired(
    options: Readonly<{ batchSize?: number; maxBatches?: number }> = {},
    signal?: AbortSignal,
  ): Promise<number> {
    const batchSize = bounded(options.batchSize ?? DEFAULT_PRUNE_BATCH_SIZE, 1, 500);
    const maxBatches = bounded(options.maxBatches ?? MAX_PRUNE_BATCHES, 1, 1_000);
    let removed = 0;
    for (let round = 0; round < maxBatches; round += 1) {
      if (signal?.aborted) break;
      const expired = await this.store.findExpired(this.now(), batchSize);
      if (expired.length === 0) break;
      for (const record of expired) {
        if (record.objectKey) await this.objects.delete(record.objectKey, signal);
        await this.store.forget(record.id);
        removed += 1;
      }
      if (expired.length < batchSize) break;
    }
    if (removed > 0) this.log({ event: "project_database_backup.pruned", removed });
    return removed;
  }

  /**
   * Ein Backup, stueckweise (2.129).
   *
   * Die Reihenfolge ist nicht beliebig, und zwei Stellen darin sind Befunde aus
   * dem Weg von 2.73.0:
   *
   * 1. **Der Upload wird eroeffnet, bevor das erste Byte kommt.** Ein
   *    Multipart-Upload, der erst nach dem Dump eroeffnet wird, haette den
   *    ganzen Dump irgendwo -- also genau das Problem.
   * 2. **Der Datenschluessel wird eingewickelt, bevor der Upload abgeschlossen
   *    wird.** Umgekehrt laege ein fertiges Objekt da, dessen Schluessel sich
   *    nicht einwickeln liess, und dann ist es unlesbarer Muell mit einer
   *    Zeile, die ihn verspricht. Scheitert das Einwickeln jetzt, wird der
   *    Upload abgebrochen und es gibt kein Objekt.
   */
  private async produce(
    claim: ProjectDatabaseBackupClaim,
    signal?: AbortSignal,
  ): Promise<{
    objectKey: string;
    artifactSha256: string;
    sizeBytes: number;
    wrappedDataKey: string;
    keyId: string;
    manifestSha256: string;
    includes: readonly string[];
    artifactFormat: ProjectDatabaseBackupArtifactFormat;
    partCount: number;
    partPlaintextBytes: number;
    snapshotAt: Date;
    completedAt: Date;
    expiresAt: Date;
  }> {
    const record = claim.record;
    const identity = identityOf(record);
    const snapshotAt = this.now();
    const partPlaintextBytes = this.partPlaintextBytes;
    const maxDumpBytes = this.maxDumpBytes;
    const objectKey = backupObjectKey(record);
    const dataKey = newBackupDataKey();
    let uploadId: string | null = null;
    let stream: ProjectDatabaseDumpStream | null = null;
    try {
      stream = await this.dumpPort.dumpStream(
        { databaseInstanceRef: record.databaseInstanceRef }, signal,
      );
      uploadId = await this.objects.beginMultipart(objectKey, signal);

      const digest = createHash("sha256");
      const header = chunkedArtifactHeader(partPlaintextBytes);
      digest.update(header);
      let artifactBytes = header.length;
      let plaintextBytes = 0;
      let partNumber = 0;
      let previousTagHex = NO_PREVIOUS_TAG;
      const uploaded: ProjectDatabaseBackupUploadedPart[] = [];
      // Der Puffer wird erst geleert, wenn **mehr** als eine Teilegroesse
      // dasteht. Das ist der Trick, mit dem ein Strom ohne Vorwissen weiss,
      // welcher Teil der letzte ist: wer mehr als eine Teilegroesse hat, weiss,
      // dass nach dem naechsten Teil noch etwas kommt, und darf ihn `more`
      // nennen. Der Rest am Ende ist der `final`-Teil.
      let pending: Buffer[] = [];
      let pendingBytes = 0;

      const flush = async (final: boolean): Promise<void> => {
        const all = Buffer.concat(pending, pendingBytes);
        const chunk = final ? all : all.subarray(0, partPlaintextBytes);
        const rest = final ? Buffer.alloc(0) : all.subarray(partPlaintextBytes);
        pending = rest.length > 0 ? [rest] : [];
        pendingBytes = rest.length;
        partNumber += 1;
        if (partNumber > this.maxParts) {
          throw new ProjectDatabaseBackupArtifactError("ARTIFACT_TOO_LARGE");
        }
        const sealed = sealBackupPart({
          chunk, dataKey, identity, partPlaintextBytes, partNumber, final, previousTagHex,
        });
        previousTagHex = sealed.tagHex;
        const bytes = partNumber === 1 ? Buffer.concat([header, sealed.bytes]) : sealed.bytes;
        digest.update(sealed.bytes);
        artifactBytes += sealed.bytes.length;
        uploaded.push(await this.objects.putPart({
          key: objectKey, uploadId: uploadId!, partNumber, bytes,
        }, signal));
      };

      for await (const chunk of stream.chunks) {
        plaintextBytes += chunk.length;
        if (plaintextBytes > maxDumpBytes) {
          throw new ProjectDatabaseBackupArtifactError("ARTIFACT_TOO_LARGE");
        }
        pending.push(chunk);
        pendingBytes += chunk.length;
        while (pendingBytes > partPlaintextBytes) await flush(false);
      }
      // Ein leerer Dump ist kein Backup. Der Riegel steht hier und in
      // `project-database-dump.ts`, weil ein `pg_dump` mit Exit 0 und leerem
      // `stdout` sonst ein `available` ohne Inhalt ergaebe.
      if (pendingBytes < 1) throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_AVAILABLE");
      await flush(true);

      // Das Manifest **nach** dem Dump und nicht davor. Zwischen Dump und
      // Messung kann sich die Datenbank aendern; deshalb vergleicht der Nachweis
      // nicht Quelle gegen Wiederherstellung, sondern das Manifest der
      // **wiederhergestellten** Datenbank gegen das hier gespeicherte. Wer
      // Quelle und Wiederherstellung vergleichen will, muss die Quelle anhalten,
      // und das tut ein Backup nicht.
      const manifest = await this.dumpPort.withReader(
        { databaseInstanceRef: record.databaseInstanceRef },
        (database) => readProjectDatabaseManifest(database),
      );
      const wrapped = await this.keys.wrap({ dataKey, identity });
      await this.objects.completeMultipart({ key: objectKey, uploadId, parts: uploaded }, signal);
      uploadId = null;
      const completedAt = this.now();
      // Die Frist der Umgebung, und erst dann die Vorgabe des Prozesses. Ein
      // Fehlschlag beim Lesen der Zeile darf ein fertiges Backup nicht
      // wegwerfen: dann gilt die Vorgabe, und die ist nie `null`.
      const retentionDays = await this.retentionDaysFor(record) ?? this.retentionDays;
      return {
        objectKey,
        artifactSha256: digest.digest("hex"),
        sizeBytes: artifactBytes,
        wrappedDataKey: wrapped.wrapped,
        keyId: wrapped.keyId,
        manifestSha256: manifest.sha256,
        includes: PROJECT_DATABASE_BACKUP_INCLUDES,
        artifactFormat: "chunked",
        partCount: partNumber,
        partPlaintextBytes,
        snapshotAt,
        completedAt,
        expiresAt: new Date(completedAt.getTime() + retentionDays * DAY_MS),
      };
    } finally {
      dataKey.fill(0);
      stream?.cancel();
      // Ein nicht abgeschlossener Upload wird abgebrochen. Ohne das liegen Teile
      // im Objektspeicher, auf die keine Zeile zeigt, und sie kosten Platz,
      // ohne je ein Objekt zu werden.
      if (uploadId) await this.objects.abortMultipart(objectKey, uploadId);
    }
  }

  /**
   * Die Frist dieser Umgebung aus dem Zeitplan. `null` heisst: es gibt keine
   * Zeile oder sie liess sich nicht lesen, und dann gilt die Vorgabe des
   * Prozesses. Ein fertiges Backup an einer Fristzeile scheitern zu lassen waere
   * die falsche Reihenfolge der Sorgen.
   */
  private async retentionDaysFor(
    scope: Readonly<{ projectId: string; environment: Environment }>,
  ): Promise<number | null> {
    if (!this.schedule) return null;
    try {
      return await this.schedule.retentionDaysFor(scope);
    } catch {
      return null;
    }
  }

  private log(event: ProjectDatabaseBackupLogEvent): void {
    try {
      this.logger.log(Object.freeze(event));
    } catch {
      // Ein Logger, der wirft, darf keine Runde kippen.
    }
  }
}

/** Der Objektschluessel, abgeleitet aus der Zeile. Nie aus einer Anfrage. */
export function backupObjectKey(record: Readonly<{
  organizationId: string; projectId: string; environment: Environment; id: string;
}>): string {
  return `project-database-backups/${record.organizationId}/${record.projectId}/${record.environment}/${record.id}.qkbak`;
}

/**
 * Der Name der Zieldatenbank. Aus der Backup-Id, nicht aus einer Anfrage, und
 * innerhalb der 63 Byte, die PostgreSQL fuer einen Namen hat.
 */
export function restoreDatabaseName(backupId: string): string {
  return `qkern_restore_${backupId.replace(/-/g, "").slice(0, 32)}`;
}

export function assertDatabaseName(value: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value) || value.startsWith("pg_")) {
    throw new ProjectDatabaseBackupServiceError("INVALID_CONFIGURATION");
  }
}

export function identityOf(record: Readonly<{
  id: string; organizationId: string; projectId: string; environment: Environment;
}>): ProjectDatabaseBackupArtifactIdentity {
  return Object.freeze({
    organizationId: record.organizationId,
    projectId: record.projectId,
    environment: record.environment,
    backupId: record.id,
  });
}

/** Eine Id fuer einen Lauf, der keine Zeile hat (der Drill benutzt sie). */
export function newBackupId(): string {
  return randomUUID();
}

export function compareManifests(
  expected: ProjectDatabaseManifest,
  actual: ProjectDatabaseManifest,
): void {
  if (expected.sha256 === actual.sha256) return;
  throw new ProjectDatabaseBackupServiceError(
    "RESTORE_MANIFEST_MISMATCH",
    firstDifferingManifestPart(expected, actual) ?? "sha256",
  );
}

function backupErrorCode(error: unknown): ProjectDatabaseBackupErrorCode {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" &&
      (PROJECT_DATABASE_BACKUP_ERROR_CODES as readonly string[]).includes(code)) {
    return code as ProjectDatabaseBackupErrorCode;
  }
  if (code === "ARTIFACT_TOO_LARGE") return "ARTIFACT_TOO_LARGE";
  if (code === "MANIFEST_UNAVAILABLE") return "CONNECTION_UNAVAILABLE";
  return "DUMP_FAILED";
}

/**
 * Der Fehlercode einer gescheiterten Wiederherstellung. Fester Satz, und
 * `RESTORE_FAILED` als Sammelcode: was nicht zu einem der benannten Faelle
 * gehoert, soll nicht als einer davon erscheinen.
 */
function restoreErrorCode(error: unknown): ProjectDatabaseRestoreErrorCode {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" &&
      (PROJECT_DATABASE_RESTORE_ERROR_CODES as readonly string[]).includes(code)) {
    return code as ProjectDatabaseRestoreErrorCode;
  }
  if (code === "ARTIFACT_IDENTITY_MISMATCH" || code === "ARTIFACT_MALFORMED" ||
      code === "OBJECT_CHECKSUM_MISMATCH") {
    return "BACKUP_ARTIFACT_MISMATCH";
  }
  if (code === "OBJECT_NOT_FOUND") return "OBJECT_STORE_UNAVAILABLE";
  if (code === "DATA_KEY_INVALID") return "KEY_UNAVAILABLE";
  return "RESTORE_FAILED";
}

/** Der Schritt aus `ProjectDatabaseDumpError`, wenn einer dranhaengt. Fester Satz, kein Text. */
function dumpStep(error: unknown): string | undefined {
  const step = (error as { step?: unknown })?.step;
  return typeof step === "string" && /^[a-z_]{1,32}$/.test(step) ? step : undefined;
}

/**
 * Die Fehlerklasse, und wenn eine Datenbank dahintersteckt, ihr SQLSTATE.
 *
 * Ein SQLSTATE ist ein fuenfstelliger, fester Code und **keine** Meldung: er
 * traegt keinen Tabellennamen und keinen Wert eines Mandanten. Ohne ihn sagt
 * `PERSISTENCE_ERROR` nur "irgendetwas an der Datenbank", und der erste Lauf
 * dieses Falls hat gezeigt, wie weit man damit kommt: nicht weit.
 */
function reasonOf(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  const reason = typeof code === "string" && /^[A-Z_]{1,64}$/.test(code) ? code : "UNKNOWN";
  const cause = (error as { cause?: unknown })?.cause;
  const sqlState = (cause as { code?: unknown })?.code;
  return typeof sqlState === "string" && /^[0-9A-Z]{5}$/.test(sqlState)
    ? `${reason}/${sqlState}`
    : reason;
}

function bounded(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProjectDatabaseBackupServiceError("INVALID_CONFIGURATION");
  }
  return value;
}

function serviceMessageFor(code: ProjectDatabaseBackupServiceErrorCode): string {
  switch (code) {
    case "BACKUP_NOT_FOUND": return "The project database backup was not found.";
    case "BACKUP_NOT_AVAILABLE": return "The project database backup is not available for restore.";
    case "BACKUP_ARTIFACT_MISMATCH": return "The project database backup artifact failed its checksum.";
    case "RESTORE_MANIFEST_MISMATCH": return "The restored project database does not match the backup manifest.";
    case "RESTORE_ALREADY_REQUESTED": return "A restore of this project database backup is already under way.";
    case "INVALID_CONFIGURATION": return "The project database backup configuration is invalid.";
  }
}
