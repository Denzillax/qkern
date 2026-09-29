import { nextCronOccurrence, type CronDispatcher } from "@/lib/server/compute/cron";
import type { CronDefinition } from "@/lib/server/compute/model";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

export type CronProgress = CronDefinition & { lastDispatchedAt: Date | null };

export interface CronRepository {
  /** Aktive Definitionen eines Projekts samt Fortschritt. */
  listActive(principal: ProjectQueuePrincipal, scope: {
    organizationId: string; projectId: string; environment: CronDefinition["environment"];
  }): Promise<CronProgress[]>;
  /** Schreibt den Fortschritt fort. Darf niemals zurücklaufen. */
  recordDispatch(
    principal: ProjectQueuePrincipal,
    definitionId: string,
    dispatchedAt: Date,
  ): Promise<void>;
}

export type CronSchedulerOptions = {
  repository: CronRepository;
  dispatcher: Pick<CronDispatcher, "dispatch">;
  /**
   * Höchstzahl nachgeholter Vorkommen je Definition und Durchlauf.
   *
   * Ohne Grenze würde ein Scheduler nach einem langen Ausfall alle verpassten
   * Vorkommen auf einmal auslösen — bei einem Minutentakt sind das nach einem
   * Tag über 1400 Nachrichten. Ein Betreiber will den Rückstand fast nie
   * vollständig nachgeholt haben; er will, dass es wieder läuft.
   */
  maxCatchUp?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
};

export type CronSchedulerResult = {
  dispatched: number;
  skipped: number;
  failed: number;
};

/**
 * Findet fällige Cron-Vorkommen und löst sie aus.
 *
 * **Bewusst ohne Lease.** Der Dispatcher enqueuet mit dem Dedupe-Key
 * `cron:<id>:<zeitpunkt>`; zwei Instanzen, die dasselbe Vorkommen auslösen,
 * erzeugen genau eine Nachricht. Die Queue ist bereits die Autorität für
 * Einmaligkeit — eine zweite daneben wäre eine zusätzliche Fehlerquelle ohne
 * zusätzliche Garantie.
 *
 * Ein Fehler bei einer Definition beendet den Durchlauf nicht: Die übrigen
 * sollen nicht daran hängen, dass eine Queue voll ist oder ein Ausdruck nicht
 * mehr parst.
 */
export class CronScheduler {
  private readonly maxCatchUp: number;
  private readonly now: () => Date;

  constructor(private readonly options: CronSchedulerOptions) {
    const limit = options.maxCatchUp ?? 5;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Cron catch-up limit must be between 1 and 100.");
    }
    this.maxCatchUp = limit;
    this.now = options.now ?? (() => new Date());
  }

  async run(principal: ProjectQueuePrincipal, scope: {
    organizationId: string; projectId: string; environment: CronDefinition["environment"];
  }): Promise<CronSchedulerResult> {
    const definitions = await this.options.repository.listActive(principal, scope);
    const result: CronSchedulerResult = { dispatched: 0, skipped: 0, failed: 0 };
    const now = this.now();

    for (const definition of definitions) {
      try {
        const occurrences = this.dueOccurrences(definition, now);
        if (occurrences.length === 0) {
          result.skipped += 1;
          continue;
        }
        for (const occurrence of occurrences) {
          await this.options.dispatcher.dispatch(definition, occurrence, principal);
          await this.options.repository.recordDispatch(principal, definition.id, occurrence);
          result.dispatched += 1;
        }
      } catch (error) {
        // Eine volle Queue oder ein nicht mehr parsender Ausdruck darf die
        // uebrigen Definitionen nicht mitreissen.
        this.options.onError?.(error);
        result.failed += 1;
      }
    }

    return result;
  }

  /**
   * Fällige Vorkommen seit dem letzten Fortschritt, höchstens `maxCatchUp`.
   *
   * Ohne bisherigen Fortschritt wird **nicht** rückwirkend nachgeholt: Eine neu
   * angelegte Definition soll nicht die Vergangenheit aufarbeiten, sondern ab
   * jetzt laufen.
   */
  private dueOccurrences(definition: CronProgress, now: Date): Date[] {
    if (!definition.enabled) return [];
    const occurrences: Date[] = [];
    let cursor = definition.lastDispatchedAt ?? new Date(now.getTime() - 60_000);

    for (let index = 0; index < this.maxCatchUp; index += 1) {
      const next = nextCronOccurrence(definition.expression, cursor, definition.timeZone);
      if (next > now) break;
      occurrences.push(next);
      cursor = next;
    }
    return occurrences;
  }
}
