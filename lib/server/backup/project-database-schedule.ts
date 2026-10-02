import type { Environment } from "@/lib/types";
import type {
  ProjectDatabaseBackupLogEvent,
  ProjectDatabaseBackupRecord,
  ProjectDatabaseBackupScheduleDuty,
} from "@/lib/server/backup/project-database";

/**
 * Der Zeitplan fuer Projektdatenbank-Backups (2.129).
 *
 * 2.73.0 hat den Backup-Weg ohne Zeitplan ausgeliefert und das selbst notiert:
 * "Es gibt auch keinen Zeitplan, der Auftraege einstellt", und `pruneExpired`
 * rief niemand von sich aus. Das hier ist beides.
 *
 * ## Warum kein zweiter Scheduler, und warum nicht der vorhandene Cron-Weg
 *
 * Die vier Gruende, warum eine Cron-Definition das nicht traegt, stehen in
 * `db/migrations/0084_project_database_backup_schedules.sql` -- kurz: eine
 * Cron-Definition zeigt auf eine **Compute-Funktion des Mandanten**, laeuft im
 * **Compute-Prozess**, ist **mandantenbearbeitbar**, und ein Backup braucht
 * keinen Cron-Ausdruck, sondern einen Takt.
 *
 * Und doch ist das hier **keine zweite Schleife**. Es gibt keinen Timer, keinen
 * neunten Prozess und kein `setInterval`: `tick()` wird von
 * `ProjectDatabaseBackupService.runRound` gerufen, und die ruft der Provisioner
 * in seiner Leerlaufrunde. Wer den Zeitplan laufen sehen will, startet den
 * Provisioner. Ein Prozess, der nicht laeuft, macht keine Backups, und das ist
 * sichtbar und nicht still.
 *
 * ## Was bei einem Lauf passiert, der den vorigen noch laufend findet
 *
 * Drei Entscheidungen, und alle drei kosten etwas:
 *
 * 1. **Es entsteht kein zweiter Auftrag.** `store.enqueue` gibt den wartenden
 *    oder laufenden Auftrag derselben Umgebung zurueck, statt einen zweiten
 *    anzulegen (0083, `enqueue`). Zwei Dumps derselben Datenbank zur selben Zeit
 *    sind Last ohne Nutzen.
 * 2. **Der Takt laeuft trotzdem weiter.** `next_due_at` wird fortgeschrieben,
 *    auch wenn nichts Neues entstand. Sonst waere jede Runde des Provisioners
 *    ein weiterer faelliger Takt, und das Log waere voll davon. Was bleibt, ist
 *    `busy_count` in der Zeile: die Zahl, an der ein Betreiber sieht, dass sein
 *    Takt kuerzer ist als ein Dump dauert. Sie steht in der Zeile und nicht nur
 *    im Log, weil ein Log nach vier Wochen weg ist.
 * 3. **Fortgeschrieben wird auf `now() + interval`** und nicht auf
 *    `next_due_at + interval`. Nach einem Ausfall von drei Tagen soll ein
 *    Zeitplan wieder laufen und nicht drei Tage nachholen. Das ist dieselbe
 *    Entscheidung, die `CronScheduler.maxCatchUp` begruendet, nur radikaler:
 *    hier wird gar nichts nachgeholt, weil ein nachgeholtes Backup von vorletzter
 *    Woche den Stand von heute sichert und damit nicht das ist, was es vorgibt.
 *
 * **Der Preis, ausgeschrieben:** das Fortschreiben passiert in derselben
 * Anweisung, die die faelligen Zeilen holt, also **vor** dem Einstellen des
 * Auftrags. Scheitert das Einstellen danach, faellt dieser Takt aus und der
 * naechste kommt nach `interval_hours`. Die andere Reihenfolge waere ein Takt,
 * der nach einem Fehlschlag jede Runde wieder feuert, und das ist bei einem
 * dauerhaft kaputten Weg eine Schleife.
 *
 * ## Wer `pruneExpired` ruft
 *
 * Derselbe `tick()`, hoechstens einmal je `pruneIntervalMs` (Voreinstellung eine
 * Stunde).
 *
 * Der Zeitpunkt dafuer steht **im Prozess** und nicht in einer Zeile, und das
 * ist eine Entscheidung: Aufraeumen ist idempotent und findet nichts, wenn
 * nichts da ist. Eine Spalte `prune_due_at` waere eine Schreibzugriff je Runde
 * fuer eine Information, die nach einem Neustart hoechstens eine zusaetzliche
 * leere Abfrage kostet. Was eine Zeile braeuchte, ist eine Zusage der Art
 * "hoechstens einmal pro Stunde ueber alle Wirte", und die braucht das
 * Aufraeumen nicht: zwei Wirte, die gleichzeitig aufraeumen, loeschen dieselben
 * Objekte und dieselben Zeilen, und das zweite Loeschen ist ein 204.
 */

export type ProjectDatabaseBackupSchedule = Readonly<{
  organizationId: string;
  projectId: string;
  environment: Environment;
  enabled: boolean;
  intervalHours: number;
  retentionDays: number;
  nextDueAt: Date;
  lastEnqueuedAt: Date | null;
  lastBackupId: string | null;
  busyCount: number;
  databaseInstanceRef: string;
}>;

export interface ProjectDatabaseBackupScheduleStore {
  /**
   * Holt die faelligen Zeitplaene **und schreibt sie in derselben Anweisung
   * fort**. Eine Anweisung und nicht zwei: zwei Wirte, die lesen und dann
   * schreiben, lesen beide dieselbe faellige Zeile.
   *
   * Der `databaseInstanceRef` kommt aus `project_environments` und nicht aus
   * dem Zeitplan: er kann sich mit einer Neubereitstellung aendern, und eine
   * Kopie in der Zeitplanzeile waere dann falsch. Aus der **Bindung** kommt er
   * bewusst nicht, denn `qkern_runtime` darf den Verbindungskatalog nicht lesen
   * (0020), und dieselbe Abfrage lauft unter beiden Rollen.
   */
  claimDue(now: Date, limit: number): Promise<readonly ProjectDatabaseBackupSchedule[]>;
  /** Vermerkt, was aus dem Takt wurde: ein neuer Auftrag, oder ein noch laufender. */
  recordTick(
    key: Readonly<{ projectId: string; environment: Environment }>,
    outcome: Readonly<{ backupId: string; busy: boolean; at: Date }>,
  ): Promise<void>;
  get(key: Readonly<{ projectId: string; environment: Environment }>):
    Promise<ProjectDatabaseBackupSchedule | null>;
}

/** Was der Takt zum Einstellen braucht. Genau die zwei Methoden des Dienstes. */
export interface ProjectDatabaseBackupScheduleTarget {
  /**
   * `created` ist hier die ganze Unterscheidung zwischen "neuer Auftrag" und
   * "der vorige laeuft noch". Sie aus Zeitstempeln zu raten hat genau einmal
   * funktioniert und beim ersten Stacklauf von (2.129) nicht mehr: ein Auftrag,
   * den eine Route zwischen zwei Takten einstellt, sieht wie ein neuer aus.
   */
  enqueueBackup(
    scope: Readonly<{ organizationId: string; projectId: string; environment: Environment }>,
    databaseInstanceRef: string,
  ): Promise<Readonly<{ record: ProjectDatabaseBackupRecord; created: boolean }>>;
  pruneExpired(
    options?: Readonly<{ batchSize?: number; maxBatches?: number }>,
    signal?: AbortSignal,
  ): Promise<number>;
}

export type ProjectDatabaseBackupSchedulerOptions = Readonly<{
  store: ProjectDatabaseBackupScheduleStore;
  target: ProjectDatabaseBackupScheduleTarget;
  /**
   * Zeitplaene je Takt. Zehn, und nicht alle: eine Runde des Provisioners soll
   * kurz sein, und ein wartender Projektauftrag geht immer vor. Was in dieser
   * Runde nicht dran war, ist in der naechsten immer noch faellig.
   */
  maxPerTick?: number;
  pruneIntervalMs?: number;
  now?: () => Date;
  logger?: { log(event: ProjectDatabaseBackupLogEvent): void };
}>;

export type ProjectDatabaseBackupTickResult = Readonly<{
  /** Zeitplaene, die faellig waren. */
  due: number;
  /** Davon: neue Auftraege. */
  enqueued: number;
  /** Davon: der vorige Auftrag lief noch. */
  busy: number;
  /** Zeitplaene, deren Auftrag nicht zustande kam. */
  failed: number;
  /** Abgelaufene Backups, die dieser Takt weggeraeumt hat. */
  pruned: number;
}>;

const DEFAULT_MAX_PER_TICK = 10;
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1_000;

export class ProjectDatabaseBackupScheduler implements ProjectDatabaseBackupScheduleDuty {
  private readonly maxPerTick: number;
  private readonly pruneIntervalMs: number;
  private readonly now: () => Date;
  private readonly logger: { log(event: ProjectDatabaseBackupLogEvent): void };
  private lastPruneAt = 0;

  constructor(private readonly options: ProjectDatabaseBackupSchedulerOptions) {
    this.maxPerTick = bounded(options.maxPerTick ?? DEFAULT_MAX_PER_TICK, 1, 200);
    this.pruneIntervalMs = bounded(options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS, 1_000, 86_400_000);
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? { log: () => undefined };
  }

  async tick(signal?: AbortSignal): Promise<ProjectDatabaseBackupTickResult> {
    let enqueued = 0;
    let busy = 0;
    let failed = 0;
    let due: readonly ProjectDatabaseBackupSchedule[] = [];
    if (!signal?.aborted) {
      try {
        due = await this.options.store.claimDue(this.now(), this.maxPerTick);
      } catch (error) {
        this.log({ event: "project_database_backup.schedule_failed", reason: reasonOf(error) });
        return Object.freeze({ due: 0, enqueued: 0, busy: 0, failed: 1, pruned: 0 });
      }
    }

    for (const schedule of due) {
      if (signal?.aborted) break;
      try {
        const outcome = await this.options.target.enqueueBackup({
          organizationId: schedule.organizationId,
          projectId: schedule.projectId,
          environment: schedule.environment,
        }, schedule.databaseInstanceRef);
        const record = outcome.record;
        // Ein Auftrag, der vor diesem Takt schon da war, ist der vorige und
        // nicht der neue -- und das sagt der Katalog, der eingefuegt hat oder
        // nicht, und nicht ein Vergleich von Zeitstempeln.
        const wasBusy = !outcome.created;
        await this.options.store.recordTick(schedule, {
          backupId: record.id, busy: wasBusy, at: this.now(),
        });
        if (wasBusy) {
          busy += 1;
          this.log({
            event: "project_database_backup.schedule_busy",
            backupId: record.id,
            projectId: schedule.projectId,
            environment: schedule.environment,
          });
        } else {
          enqueued += 1;
          this.log({
            event: "project_database_backup.scheduled",
            backupId: record.id,
            projectId: schedule.projectId,
            environment: schedule.environment,
          });
        }
      } catch (error) {
        // Ein Zeitplan, dessen Auftrag nicht zustande kommt, reisst die uebrigen
        // nicht mit. Derselbe Grund wie im Cron-Scheduler: eine kaputte Zeile
        // soll nicht alle anderen anhalten.
        failed += 1;
        this.log({
          event: "project_database_backup.schedule_failed",
          projectId: schedule.projectId,
          environment: schedule.environment,
          reason: reasonOf(error),
        });
      }
    }

    const pruned = await this.prune(signal);
    return Object.freeze({ due: due.length, enqueued, busy, failed, pruned });
  }

  async retentionDaysFor(
    scope: Readonly<{ projectId: string; environment: Environment }>,
  ): Promise<number | null> {
    const schedule = await this.options.store.get(scope);
    return schedule?.retentionDays ?? null;
  }

  private async prune(signal?: AbortSignal): Promise<number> {
    const now = this.now().getTime();
    if (signal?.aborted || now - this.lastPruneAt < this.pruneIntervalMs) return 0;
    this.lastPruneAt = now;
    try {
      return await this.options.target.pruneExpired({}, signal);
    } catch (error) {
      // Der Aufraeumer loggt sein Ergebnis selbst; was hier fehlt, ist der
      // Grund, warum er nicht dazu kam.
      this.log({ event: "project_database_backup.schedule_failed", reason: reasonOf(error) });
      return 0;
    }
  }

  private log(event: ProjectDatabaseBackupLogEvent): void {
    try {
      this.logger.log(Object.freeze(event));
    } catch {
      // Ein Logger, der wirft, darf keinen Takt kippen.
    }
  }
}

/** Dieselbe Form wie im Dienst: Fehlerklasse und, wenn eine Datenbank dahintersteckt, ihr SQLSTATE. */
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
    throw new Error("The project database backup schedule bound is invalid.");
  }
  return value;
}
