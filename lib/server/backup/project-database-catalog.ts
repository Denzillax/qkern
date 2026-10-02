import { getPostgresPool } from "@/lib/server/db/pool";
import { runtimeModeFromEnv } from "@/lib/server/runtime-mode";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ControlPlaneContext } from "@/lib/server/control-plane/model";
import type { Environment } from "@/lib/types";
import {
  ProjectDatabaseBackupServiceError,
  restoreDatabaseName,
  type ProjectDatabaseBackupRecord,
} from "@/lib/server/backup/project-database";
import {
  PostgresProjectDatabaseBackupScheduleStore,
  PostgresProjectDatabaseBackupStore,
} from "@/lib/server/backup/project-database-postgres";

/**
 * Der Katalog der Projektdatenbank-Backups, wie ihn eine **Route** sieht
 * (2.129).
 *
 * ## Warum das nicht der Dienst aus 2.126 ist
 *
 * `ProjectDatabaseBackupService` kann ein Backup **fahren**: er hat `pg_dump`,
 * `psql`, den Vault-Weg zur Projektdatenbank und die Rolle mit `CREATEDB`. Nichts
 * davon gehoert in den Next-Prozess, und das ist keine Vorsicht, sondern dieselbe
 * Begruendung, mit der 2.126 den Backup-Weg in den Provisioner gelegt hat: ein
 * zweiter Prozess mit `CREATEDB` waere eine zweite Stelle mit dem schaerfsten
 * Recht im Cluster.
 *
 * Was eine Route braucht, ist viel weniger: die Katalogzeilen lesen und zwei
 * Auftraege einstellen. Beides geht mit der Rolle, die der Next-Prozess schon
 * hat (`qkern_runtime`), und mit den Rechten, die 0083 und 0084 ihr geben --
 * `SELECT`, `INSERT`, und `UPDATE` auf **genau vier** Spalten. Darum steht hier
 * ein eigener, enger Dienst und kein zweiter Aufbau des grossen.
 *
 * ## Die Mandantengrenze
 *
 * Sie haengt **nicht** an einem Filter in dieser Datei. Jeder Aufruf baut einen
 * Store auf die Organisation des angemeldeten Prinzipals, jede Anweisung lauft in
 * `withTenantTransaction`, und die Policy aus 0083 entscheidet. Eine Backup-Id
 * aus einem fremden Mandanten ergibt hier `null` und nicht eine Zeile, und zwar
 * ohne dass eine Anweisung die Organisation nennt.
 */

export type ProjectDatabaseBackupView = Readonly<{
  id: string;
  projectId: string;
  environment: Environment;
  status: string;
  /** Wie das Artefakt liegt. `chunked` seit 2.129, `single` fuer Zeilen aus 2.73.0. */
  artifactFormat: string;
  /**
   * Die Groesse des Artefakts in Bytes.
   *
   * Sie geht hinaus, und das ist eine Entscheidung gegen die Regel des Logs
   * ("keine Groesse in Bytes eines Mandanten"): im Log ist eine Groesse eine
   * Spur auf einer Logflaeche, die andere lesen; hier ist sie die Antwort auf
   * "wie gross ist mein Backup", gestellt von dem, dem die Daten gehoeren.
   */
  sizeBytes: number | null;
  partCount: number | null;
  manifestSha256: string | null;
  includes: readonly string[];
  snapshotAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  lastErrorCode: string | null;
  restore: Readonly<{
    status: string;
    requestedAt: string | null;
    completedAt: string | null;
    databaseName: string | null;
    errorCode: string | null;
  }> | null;
  createdAt: string;
}>;

export type ProjectDatabaseBackupScheduleView = Readonly<{
  enabled: boolean;
  intervalHours: number;
  retentionDays: number;
  nextDueAt: string;
  lastEnqueuedAt: string | null;
  busyCount: number;
}>;

export type ProjectDatabaseBackupListing = Readonly<{
  backups: readonly ProjectDatabaseBackupView[];
  /** Der Zeitplan dieser Umgebung, oder `null`, wenn es keinen gibt. */
  schedule: ProjectDatabaseBackupScheduleView | null;
}>;

export interface ProjectDatabaseBackupCatalog {
  list(
    context: ControlPlaneContext,
    scope: Readonly<{ projectId: string; environment: Environment }>,
    limit: number,
  ): Promise<ProjectDatabaseBackupListing>;
  get(
    context: ControlPlaneContext,
    backupId: string,
  ): Promise<ProjectDatabaseBackupView | null>;
  /** Bestellt ein Backup. Ein wartender Auftrag je Umgebung reicht; ein zweiter Aufruf gibt denselben. */
  request(
    context: ControlPlaneContext,
    scope: Readonly<{ projectId: string; environment: Environment }>,
  ): Promise<Readonly<{ backup: ProjectDatabaseBackupView; created: boolean }>>;
  /** Bestellt eine Wiederherstellung. Sie laeuft im Provisioner und nicht hier. */
  requestRestore(
    context: ControlPlaneContext,
    backupId: string,
  ): Promise<ProjectDatabaseBackupView>;
}

export class PostgresProjectDatabaseBackupCatalog implements ProjectDatabaseBackupCatalog {
  constructor(private readonly pool: SqlPool) {}

  async list(
    context: ControlPlaneContext,
    scope: Readonly<{ projectId: string; environment: Environment }>,
    limit: number,
  ): Promise<ProjectDatabaseBackupListing> {
    const store = this.storeFor(context);
    const schedules = this.scheduleStoreFor(context);
    const [backups, schedule] = await Promise.all([
      store.list({ organizationId: context.organizationId, ...scope }, limit),
      schedules.get(scope),
    ]);
    return Object.freeze({
      backups: backups.map(viewOf),
      schedule: schedule ? Object.freeze({
        enabled: schedule.enabled,
        intervalHours: schedule.intervalHours,
        retentionDays: schedule.retentionDays,
        nextDueAt: schedule.nextDueAt.toISOString(),
        lastEnqueuedAt: schedule.lastEnqueuedAt?.toISOString() ?? null,
        busyCount: schedule.busyCount,
      }) : null,
    });
  }

  async get(context: ControlPlaneContext, backupId: string): Promise<ProjectDatabaseBackupView | null> {
    const record = await this.storeFor(context).get(backupId);
    return record ? viewOf(record) : null;
  }

  async request(
    context: ControlPlaneContext,
    scope: Readonly<{ projectId: string; environment: Environment }>,
  ): Promise<Readonly<{ backup: ProjectDatabaseBackupView; created: boolean }>> {
    const store = this.storeFor(context);
    // Der `databaseInstanceRef` kommt aus der **Bindung** und nicht aus der
    // Anfrage. Eine Route, die ihn annimmt, waere eine Route, mit der ein
    // Mandant ein Backup einer fremden Datenbank bestellt -- die Policy wuerde
    // ihm die Zeile verweigern, aber der Provisioner wuerde den Dump schon
    // gezogen haben.
    const databaseInstanceRef = await store.databaseInstanceRefFor(scope);
    if (!databaseInstanceRef) throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_FOUND");
    // Ob ein Auftrag **entstand** oder schon dastand, entscheidet den Status der
    // Antwort (202 gegen 200), und es sagt der Katalog: `enqueue` hat eingefuegt
    // oder den wartenden zurueckgegeben (0083). Ein Vergleich der neuesten Zeile
    // vor und nach dem Aufruf stand hier zuerst und war eine Rekonstruktion von
    // etwas, das die Anweisung selbst weiss; derselbe Fehler kostete den
    // Zeitplan seine `busy_count` (siehe `ProjectDatabaseBackupStore.enqueue`).
    const outcome = await store.enqueue(
      { organizationId: context.organizationId, ...scope }, databaseInstanceRef,
    );
    return Object.freeze({ backup: viewOf(outcome.record), created: outcome.created });
  }

  async requestRestore(
    context: ControlPlaneContext,
    backupId: string,
  ): Promise<ProjectDatabaseBackupView> {
    const store = this.storeFor(context);
    const record = await store.get(backupId);
    if (!record) throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_FOUND");
    if (record.status !== "available") {
      throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_AVAILABLE");
    }
    if (record.restoreStatus === "requested" || record.restoreStatus === "running") {
      throw new ProjectDatabaseBackupServiceError("RESTORE_ALREADY_REQUESTED");
    }
    const requested = await store.requestRestore({
      backupId: record.id,
      // Aus der Backup-Id und nie aus der Anfrage.
      databaseName: restoreDatabaseName(record.id),
      // Die Kennung des Bestellers, und **nicht** seine Mailadresse: der Katalog
      // traegt sonst keine Personendaten, und ein Backup-Katalog ist nicht der
      // Ort, an dem das anfaengt.
      requestedBy: actorReference(context),
      at: new Date(),
    });
    if (!requested) throw new ProjectDatabaseBackupServiceError("RESTORE_ALREADY_REQUESTED");
    return viewOf(requested);
  }

  private storeFor(context: ControlPlaneContext): PostgresProjectDatabaseBackupStore {
    return new PostgresProjectDatabaseBackupStore(
      this.pool, context.organizationId, actorReference(context),
    );
  }

  private scheduleStoreFor(context: ControlPlaneContext): PostgresProjectDatabaseBackupScheduleStore {
    return new PostgresProjectDatabaseBackupScheduleStore(
      this.pool, context.organizationId, actorReference(context),
    );
  }
}

/**
 * Die Kennung des Bestellers. Sie landet in `restore_requested_by`, und 0084
 * begrenzt sie auf `[A-Za-z0-9._:-]`. Eine Mailadresse passt dort nicht hinein,
 * und das ist der Riegel: was hier herauskommt, ist `user:<uuid>`.
 */
function actorReference(context: ControlPlaneContext): string {
  const id = context.actor?.id ?? "";
  return /^[0-9a-f-]{36}$/i.test(id) ? `user:${id.toLowerCase()}` : "console";
}

function viewOf(record: ProjectDatabaseBackupRecord): ProjectDatabaseBackupView {
  return Object.freeze({
    id: record.id,
    projectId: record.projectId,
    environment: record.environment,
    status: record.status,
    artifactFormat: record.artifactFormat,
    sizeBytes: record.sizeBytes,
    partCount: record.partCount,
    manifestSha256: record.manifestSha256,
    includes: record.includes,
    snapshotAt: record.snapshotAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    lastErrorCode: record.lastErrorCode,
    restore: record.restoreStatus ? Object.freeze({
      status: record.restoreStatus,
      requestedAt: record.restoreRequestedAt?.toISOString() ?? null,
      completedAt: record.restoreCompletedAt?.toISOString() ?? null,
      databaseName: record.restoreDatabaseName,
      errorCode: record.restoreErrorCode,
    }) : null,
    createdAt: record.createdAt.toISOString(),
  });
}

/**
 * **Kein Objektschluessel, kein eingewickelter Schluessel, kein Schluesselname.**
 *
 * Was `viewOf` weglaesst, ist die Liste, die eine Route nicht herausgeben darf:
 * `objectKey` sagt, wo die Bytes liegen, `wrappedDataKey` ist Schluesselmaterial,
 * `keyId` nennt den Mandanten-Schluessel, `artifactSha256` ist die Pruefsumme,
 * mit der ein Angreifer ein getauschtes Artefakt plausibel macht, und
 * `databaseInstanceRef` nennt die Datenbankinstanz. `manifestSha256` geht
 * dagegen hinaus: es ist eine Zahl ueber den **eigenen** Stand und die Angabe,
 * mit der ein Betreiber zwei Backups unterscheidet.
 */

/**
 * Der Katalog im Speichermodus.
 *
 * QKERN hat zwei Laufmodi, und der Speichermodus ist der, in dem die Console
 * ohne PostgreSQL startet (`lib/server/runtime-mode.ts`). Ohne diese Haelfte
 * wuerde der Next-Prozess beim Laden der Route einen Pool bauen und mit
 * `QKERN_RUNTIME_DATABASE_URL is required` fallen -- dieselbe Form, die der
 * Provisioner-Dienst mit `MemoryProjectDatabaseProvisioningService` hat.
 *
 * Es gibt hier **keinen Katalog und keinen Auftrag**: ein Backup im
 * Speichermodus waere ein Backup, das nichts sichert. Die Liste ist leer, und
 * jede Bestellung ist ein 404 -- also genau das, was ein Aufrufer sieht, wenn es
 * fuer diese Umgebung keine Datenbank gibt. Eine Haelfte, die einen Auftrag
 * vortaeuscht, waere die schlechtere Antwort.
 */
export class MemoryProjectDatabaseBackupCatalog implements ProjectDatabaseBackupCatalog {
  async list(): Promise<ProjectDatabaseBackupListing> {
    return Object.freeze({ backups: [], schedule: null });
  }
  async get(): Promise<ProjectDatabaseBackupView | null> { return null; }
  async request(): Promise<never> {
    throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_FOUND");
  }
  async requestRestore(): Promise<never> {
    throw new ProjectDatabaseBackupServiceError("BACKUP_NOT_FOUND");
  }
}

export function createProjectDatabaseBackupCatalog(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: { pool?: SqlPool } = {},
): ProjectDatabaseBackupCatalog {
  if (!dependencies.pool && runtimeModeFromEnv(env) === "memory") {
    return new MemoryProjectDatabaseBackupCatalog();
  }
  return new PostgresProjectDatabaseBackupCatalog(dependencies.pool ?? getPostgresPool(env));
}

type GlobalBackupCatalog = typeof globalThis & {
  __qkernProjectDatabaseBackupCatalog?: ProjectDatabaseBackupCatalog;
};
const runtime = globalThis as GlobalBackupCatalog;
export const projectDatabaseBackupCatalog = runtime.__qkernProjectDatabaseBackupCatalog ??
  createProjectDatabaseBackupCatalog();
if (process.env.NODE_ENV !== "production") {
  runtime.__qkernProjectDatabaseBackupCatalog = projectDatabaseBackupCatalog;
}
