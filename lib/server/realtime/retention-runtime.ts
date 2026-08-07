import type { RealtimeScope } from "@/lib/server/realtime/model";

export interface RealtimeEventLogRetention {
  prune(scope: RealtimeScope, olderThan: Date): Promise<number>;
}

export interface RealtimeChangeFeedRetention {
  prune(scope: RealtimeScope, before: Date): Promise<number>;
}

export type RealtimeRetentionResult = Readonly<{ events: number; changes: number }>;

export type RealtimeRetentionRuntimeOptions = {
  eventLog: RealtimeEventLogRetention;
  /** Ohne Quelle bleibt der Change-Feed unberührt — er ist optional konfiguriert. */
  changeSource?: RealtimeChangeFeedRetention;
  /**
   * Welche Projekte aufgeräumt werden — **ausdrücklich**, nicht entdeckt.
   *
   * Die Runtime-Rolle sieht durch RLS nur die eigene Organisation; eine
   * organisationsübergreifende Suche nach alten Zeilen ginge nur mit einer
   * Rolle, die alles sieht. Dieselbe Entscheidung wie bei
   * `QKERN_COMPUTE_SCOPES_JSON`, aus demselben Grund.
   *
   * Die Abonnements einer Instanz wären der falsche Massstab: Gerade das
   * Projekt, dem gerade niemand zuhört, wächst unbeobachtet.
   */
  scopes: readonly RealtimeScope[];
  eventRetentionMs: number;
  changeRetentionMs: number;
  intervalMs?: number;
  now?: () => Date;
  /** Erhält nur Zahlen, nie Inhalte. */
  onPruned?: (result: RealtimeRetentionResult) => void;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Räumt Event-Log und Change-Feed auf.
 *
 * Beide `prune`-Pfade gab es seit Release 1.13 beziehungsweise 1.15 — und
 * **niemand rief sie auf**. Der Change-Poller tut es ausdrücklich nicht, mit
 * gutem Grund: Eine Instanz weiss nicht, was andere noch brauchen. Damit war
 * Aufräumen als „Betriebsaufgabe" benannt und blieb ohne Betrieb; Event-Log und
 * Feed wuchsen unbegrenzt.
 *
 * Das ist dasselbe Muster, das dieser Sprint schon beim Realtime-Poller, beim
 * dauerhaften Event-Log, bei der Webhook-Outbox, bei der Functions-Sandbox und
 * bei den Usage-Emittern gefunden hat: gebaut, zertifiziert und trotzdem
 * wirkungslos.
 *
 * **Aufbewahrt wird nach Alter, nicht nach Position.** Eine positionsbasierte
 * Aufbewahrung müsste wissen, wie weit jeder Leser gekommen ist — über
 * Instanzgrenzen hinweg und auch über die, die gerade nicht laufen. Der Preis
 * ist ehrlich zu nennen: Ein Poller, der länger als das Fenster ausgefallen
 * war, verliert Änderungen. Das Fenster ist deshalb grosszügig, und die
 * Cursor-Prüfung meldet die Lücke, statt sie zu verschweigen.
 */
export class RealtimeRetentionRuntime {
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private stopping = false;
  private running = false;
  private wake: (() => void) | null = null;

  constructor(private readonly options: RealtimeRetentionRuntimeOptions) {
    this.intervalMs = bounded(options.intervalMs ?? 3_600_000, 1_000, 86_400_000);
    bounded(options.eventRetentionMs, 60_000, 90 * 86_400_000);
    bounded(options.changeRetentionMs, 60_000, 90 * 86_400_000);
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => { clearTimeout(timer); resolve(); };
    }));
  }

  /** Ein Durchlauf über alle Scopes. */
  async runOnce(): Promise<RealtimeRetentionResult> {
    const now = this.now();
    let events = 0;
    let changes = 0;
    for (const scope of this.options.scopes) {
      if (this.stopping) break;
      // Ein Fehler bei einem Projekt darf die uebrigen nicht aufhalten. Die
      // Ursache bleibt draussen: Sie kann eine Datenbankmeldung tragen.
      try {
        events += await this.options.eventLog.prune(
          scope, new Date(now.getTime() - this.options.eventRetentionMs),
        );
      } catch { /* naechster Scope */ }
      if (!this.options.changeSource) continue;
      try {
        changes += await this.options.changeSource.prune(
          scope, new Date(now.getTime() - this.options.changeRetentionMs),
        );
      } catch { /* naechster Scope */ }
    }
    const result = Object.freeze({ events, changes });
    if (events > 0 || changes > 0) this.options.onPruned?.(result);
    return result;
  }

  /** Läuft, bis `stop` gerufen wird. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    try {
      while (!this.stopping) {
        try { await this.runOnce(); } catch { /* naechster Durchlauf */ }
        if (this.stopping) break;
        await this.sleep(this.intervalMs);
      }
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    this.stopping = true;
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError("A realtime retention setting is out of range.");
  }
  return value;
}
