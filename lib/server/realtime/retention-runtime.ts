import type { RealtimeScope } from "@/lib/server/realtime/model";

export interface RealtimeEventLogRetention {
  prune(scope: RealtimeScope, olderThan: Date): Promise<number>;
}

export interface RealtimeChangeFeedRetention {
  prune(scope: RealtimeScope, before: Date): Promise<number>;
}

/**
 * Der Aufräumer für dauerhafte Presence (0077).
 *
 * Er arbeitet häppchenweise, anders als die beiden anderen: Eine Presence-Zeile
 * entsteht je Abonnent und Kanal, und eine Instanz, die hart gestorben ist,
 * hinterlässt so viele Waisen, wie sie Abonnements hielt. Ein nacktes DELETE
 * über alle wäre genau die lange Sperre, die ein Aufräumer vermeiden soll.
 */
export interface RealtimePresenceRetention {
  prune(scope: RealtimeScope, expiredBefore: Date, limit: number): Promise<number>;
}

export type RealtimeRetentionResult = Readonly<{
  events: number; changes: number; presence: number;
}>;

export type RealtimeRetentionRuntimeOptions = {
  eventLog: RealtimeEventLogRetention;
  /** Ohne Quelle bleibt der Change-Feed unberührt — er ist optional konfiguriert. */
  changeSource?: RealtimeChangeFeedRetention;
  /**
   * Ohne Store bleibt Presence unberührt. Das ist der Fall, in dem sie im
   * Prozessspeicher liegt: Dort gibt es nichts aufzuräumen, weil ohnehin nichts
   * einen Neustart überlebt.
   */
  presence?: RealtimePresenceRetention;
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
  /**
   * Die Frist **nach dem Ablauf** einer Presence-Pacht, nicht nach dem
   * Eintragen. Sie ist deshalb etwas anderes als die beiden Fristen darüber: Ein
   * Ereignis wird alt, eine Pacht läuft aus. Die Sichtbarkeit endet schon am
   * Ablauf (jede Lesung filtert); diese Frist entscheidet nur, wie lange die
   * leere Hülle noch in der Tabelle steht, damit eine Fehlersuche direkt nach
   * einem Vorfall sie noch findet.
   */
  presenceRetentionMs?: number;
  /** Zeilen je Anweisung beim Presence-Aufräumen. */
  presenceBatchSize?: number;
  /** Anweisungen je Scope und Runde beim Presence-Aufräumen. */
  presenceMaxBatches?: number;
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
 *
 * **Presence ist die dritte Tabelle, und sie ist anders.** Ereignisse und
 * Änderungen werden alt; eine Presence-Zeile läuft aus. Was hier aufgeräumt
 * wird, sind Einträge von Verbindungen, die ohne Abmeldung verschwunden sind:
 * gekapptes Netz, getöteter Prozess, abgestürzter Rechner. Sie zählen schon
 * nicht mehr mit, sobald ihre Pacht abgelaufen ist -- jede Lesung filtert danach
 * -- und sie verschwinden eine kurze Frist später ganz. Die Frist ist der
 * einzige Grund, aus dem sie überhaupt noch stehen: Wer unmittelbar nach einem
 * Vorfall nachsieht, soll die Waise noch finden.
 */
export class RealtimeRetentionRuntime {
  private readonly intervalMs: number;
  private readonly presenceRetentionMs: number;
  private readonly presenceBatchSize: number;
  private readonly presenceMaxBatches: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private stopping = false;
  private running = false;
  private wake: (() => void) | null = null;

  constructor(private readonly options: RealtimeRetentionRuntimeOptions) {
    this.intervalMs = bounded(options.intervalMs ?? 3_600_000, 1_000, 86_400_000);
    bounded(options.eventRetentionMs, 60_000, 90 * 86_400_000);
    bounded(options.changeRetentionMs, 60_000, 90 * 86_400_000);
    // Untergrenze eine Minute, wie beim Auth-Aufräumer: Eine Frist von null
    // wäre die Löschung im selben Augenblick, in dem die Pacht abläuft, und
    // damit gäbe es keinen Augenblick, in dem jemand die Waise noch sieht.
    this.presenceRetentionMs = bounded(options.presenceRetentionMs ?? 600_000, 60_000, 86_400_000);
    this.presenceBatchSize = bounded(options.presenceBatchSize ?? 500, 1, 1_000);
    this.presenceMaxBatches = bounded(options.presenceMaxBatches ?? 20, 1, 1_000);
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
    let presence = 0;
    for (const scope of this.options.scopes) {
      if (this.stopping) break;
      // Ein Fehler bei einem Projekt darf die uebrigen nicht aufhalten. Die
      // Ursache bleibt draussen: Sie kann eine Datenbankmeldung tragen.
      try {
        events += await this.options.eventLog.prune(
          scope, new Date(now.getTime() - this.options.eventRetentionMs),
        );
      } catch { /* naechster Scope */ }
      // Presence vor dem Change-Feed, und die Reihenfolge ist hier frei: Die
      // drei Tabellen haengen an keinem gemeinsamen Schluessel und an keiner
      // Kaskade. Presence steht trotzdem vorn, weil ihre Waisen die einzigen
      // sind, die etwas Falsches behaupten, solange sie liegen.
      if (this.options.presence) {
        const expiredBefore = new Date(now.getTime() - this.presenceRetentionMs);
        try {
          for (let round = 0; round < this.presenceMaxBatches; round += 1) {
            if (this.stopping) break;
            const removed = await this.options.presence.prune(
              scope, expiredBefore, this.presenceBatchSize,
            );
            // Gezaehlt wird nach jeder Portion und nicht am Ende: Bricht die
            // dritte ab, sind die ersten beiden trotzdem geloescht.
            presence += removed;
            if (removed < this.presenceBatchSize) break;
          }
        } catch { /* naechster Scope */ }
      }
      if (!this.options.changeSource) continue;
      try {
        changes += await this.options.changeSource.prune(
          scope, new Date(now.getTime() - this.options.changeRetentionMs),
        );
      } catch { /* naechster Scope */ }
    }
    const result = Object.freeze({ events, changes, presence });
    if (events > 0 || changes > 0 || presence > 0) this.options.onPruned?.(result);
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
