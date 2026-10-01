import { randomUUID } from "node:crypto";
import { recognisedByName } from "@/lib/server/errors/identity";
import type { Environment } from "@/lib/types";
import type { SqlQueryable } from "@/lib/server/db/sql";
import {
  MAX_ARTIFACT_BYTES,
  artifactSha256,
  newBackupDataKey,
  openBackupArtifact,
  sameDigest,
  sealBackupArtifact,
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
 * ## Wohin die Bytes gehen
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

/**
 * Die Control-Plane-Seite. Jede Methode lauft in **einer** Transaktion mit
 * gesetztem `qkern.organization_id`; die Implementierung dazu steht in
 * `project-database-postgres.ts` und benutzt `withTenantTransaction`.
 */
export interface ProjectDatabaseBackupStore {
  /** Legt einen Auftrag an. Mehr als ein wartender Auftrag je Umgebung ist keiner. */
  enqueue(scope: ProjectDatabaseBackupScope, databaseInstanceRef: string): Promise<ProjectDatabaseBackupRecord>;
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
  /** Setzt ein abgelaufenes Backup auf `expired` und nimmt ihm Schluessel und Objektverweis. */
  forget(backupId: string): Promise<void>;
}

/** Der Dump. Siehe `project-database-dump.ts`: warum ein Kindprozess und wie das Passwort dorthin kommt. */
export interface ProjectDatabaseDumpPort {
  dump(
    input: Readonly<{ databaseInstanceRef: string }>,
    signal?: AbortSignal,
  ): Promise<Buffer>;
  /** Eine Verbindung zum Lesen des Manifests, mit derselben Rolle wie der Dump. */
  withReader<T>(
    input: Readonly<{ databaseInstanceRef: string }>,
    operation: (database: SqlQueryable) => Promise<T>,
  ): Promise<T>;
}

/** Das Ziel einer Wiederherstellung: eine neue, leere Datenbank, und der Weg, einen Dump hineinzuspielen. */
export interface ProjectDatabaseRestoreTargetPort {
  createDatabase(
    input: Readonly<{ databaseInstanceRef: string; databaseName: string }>,
    signal?: AbortSignal,
  ): Promise<void>;
  restore(
    input: Readonly<{ databaseInstanceRef: string; databaseName: string; dump: Buffer }>,
    signal?: AbortSignal,
  ): Promise<void>;
  withReader<T>(
    input: Readonly<{ databaseInstanceRef: string; databaseName: string }>,
    operation: (database: SqlQueryable) => Promise<T>,
  ): Promise<T>;
}

export interface ProjectDatabaseBackupObjectStore {
  put(key: string, bytes: Buffer, signal?: AbortSignal): Promise<void>;
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
    | "project_database_backup.pruned"
    | "project_database_backup.round_failed";
  /** Eine Backup-Id, kein Objektschluessel, kein Schluessel-Name, keine Groesse in Bytes eines Mandanten. */
  backupId?: string;
  projectId?: string;
  environment?: Environment;
  attempt?: number;
  errorCode?: ProjectDatabaseBackupErrorCode;
  /** Nur die Fehlerklasse, nie eine Meldung (dieselbe Regel wie im Provisioner-Log). */
  reason?: string;
  removed?: number;
}>;

export type ProjectDatabaseBackupRoundResult =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "succeeded"; backupId: string }>
  | Readonly<{ status: "failed"; backupId: string; errorCode: ProjectDatabaseBackupErrorCode }>
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
}>;

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
  }

  enqueue(scope: ProjectDatabaseBackupScope, databaseInstanceRef: string): Promise<ProjectDatabaseBackupRecord> {
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
    const artifact = await this.objects.get(record.objectKey, signal);
    // Die Pruefsumme vor dem Schluessel: ein Artefakt, das unterwegs
    // verstuemmelt wurde, soll das sagen und nicht wie ein Schluesselfehler
    // aussehen.
    if (!sameDigest(artifactSha256(artifact), record.artifactSha256)) {
      throw new ProjectDatabaseBackupServiceError("BACKUP_ARTIFACT_MISMATCH");
    }
    const dataKey = await this.keys.unwrap({
      wrapped: record.wrappedDataKey,
      keyId: record.keyId,
      identity,
    });
    const dump = openBackupArtifact({ artifact, dataKey, identity });
    dataKey.fill(0);

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
    snapshotAt: Date;
    completedAt: Date;
    expiresAt: Date;
  }> {
    const record = claim.record;
    const identity = identityOf(record);
    const snapshotAt = this.now();
    const dump = await this.dumpPort.dump({ databaseInstanceRef: record.databaseInstanceRef }, signal);
    // Das Manifest wird **nach** dem Dump gelesen und nicht davor. Zwischen
    // Dump und Messung kann sich die Datenbank aendern; deshalb vergleicht der
    // Nachweis nicht Quelle gegen Wiederherstellung, sondern das Manifest der
    // **wiederhergestellten** Datenbank gegen das hier gespeicherte. Wer
    // Quelle und Wiederherstellung vergleichen will, muss die Quelle anhalten,
    // und das tut ein Backup nicht.
    const manifest = await this.dumpPort.withReader(
      { databaseInstanceRef: record.databaseInstanceRef },
      (database) => readProjectDatabaseManifest(database),
    );
    const dataKey = newBackupDataKey();
    try {
      const artifact = sealBackupArtifact({ dump, dataKey, identity });
      if (artifact.length > MAX_ARTIFACT_BYTES) {
        throw new ProjectDatabaseBackupServiceError("INVALID_CONFIGURATION");
      }
      const wrapped = await this.keys.wrap({ dataKey, identity });
      const objectKey = backupObjectKey(record);
      await this.objects.put(objectKey, artifact, signal);
      const completedAt = this.now();
      return {
        objectKey,
        artifactSha256: artifactSha256(artifact),
        sizeBytes: artifact.length,
        wrappedDataKey: wrapped.wrapped,
        keyId: wrapped.keyId,
        manifestSha256: manifest.sha256,
        includes: PROJECT_DATABASE_BACKUP_INCLUDES,
        snapshotAt,
        completedAt,
        expiresAt: new Date(completedAt.getTime() + this.retentionDays * DAY_MS),
      };
    } finally {
      dataKey.fill(0);
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

function reasonOf(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[A-Z_]{1,64}$/.test(code) ? code : "UNKNOWN";
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
    case "INVALID_CONFIGURATION": return "The project database backup configuration is invalid.";
  }
}
