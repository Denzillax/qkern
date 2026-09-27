import { recognisedByName } from "@/lib/server/errors/identity";
import {
  LogDrainCollector,
  LogDrainCollectorError,
  type LogDrainBinding,
  type LogDrainBindingSource,
  type LogDrainCursorStore,
  type LogDrainSourceReader,
} from "@/lib/server/compute/log-drains";
import type { WebhookOutbox, WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

/**
 * Der Log-Drain-Sammler als Dauerprozess (2.64).
 *
 * ## Was 2.54 offen gelassen hat
 *
 * 2.54 hat `LogDrainCollector` gebaut und die ganze Kette zertifiziert -- aber
 * niemand rief ihn auf. Der Compute-Prozess kannte seine Scopes, stellte
 * Webhooks zu und las seit 2.53 den Aenderungs-Feed; die Log-Quellen fasste er
 * nicht an. Gebaut, zertifiziert, untaetig: genau der Zustand, den 2.50 bei
 * der Webhook-Bruecke hinterliess und 2.51 geschlossen hat.
 *
 * Dieses Modul ist deshalb kein zweites Muster, sondern das Geschwister von
 * `DatabaseWebhookBridgeRuntime`: Entdeckung aus der Control Plane, eine
 * Schleife in der Reihenfolge der Scope-Liste, Backoff je Einheit, feste
 * Fehlercodes ohne Datenbankmeldung, sauberes Ende.
 *
 * ## Warum das Backoff je Drain gilt und nicht je Umgebung
 *
 * Das ist der eine Unterschied, und er hat einen Grund. Bei der Bruecke ist
 * die Einheit die Projektdatenbank: Faellt sie aus, faellt alles aus, was aus
 * ihr gelesen wird. Hier liegen alle Quellen in derselben Control Plane, und
 * was scheitern kann, gehoert zu **einem** Drain: seine Position, seine
 * Ladung, sein Eintrag in der Outbox. Ein Drain, dessen Position unlesbar ist,
 * darf die uebrigen Drains derselben Umgebung nicht anhalten.
 *
 * Gelesen wird trotzdem der Reihe nach und immer nur ein Drain gleichzeitig.
 * Am anderen Ende wartet kein Mensch, sondern die Outbox mit eigenem Takt.
 *
 * ## Warum ein Sammler je Drain
 *
 * `LogDrainCollector` puffert je Drain und Quelle und schickt eine Ladung,
 * wenn sie voll oder alt genug ist. Dieser Puffer muss zwischen den Runden
 * stehen bleiben, sonst gaebe es keine Buendelung. Ein Sammler je Drain haelt
 * genau diesen Puffer und kann einzeln zurueckgestellt werden; ein gemeinsamer
 * Sammler je Umgebung koennte das nicht, ohne seinen Rundenbegriff aufzugeben.
 *
 * Die Liste der aktiven Drains wird dabei **einmal je Umgebung und Runde**
 * gelesen und an die Sammler verteilt. Jeder Sammler selbst fragen zu lassen
 * waere eine Abfrage je Drain und Runde, ohne eine einzige zusaetzliche
 * Auskunft.
 *
 * ## Aufbewahrung
 *
 * Diese Schleife raeumt nichts auf, und das ist keine Luecke. Die Quellen
 * gehoeren ihren eigenen Modulen und haben ihre eigenen Fristen; die
 * Zustellungen, die hier entstehen, raeumt `WebhookRetentionRuntime` im selben
 * Prozess. Sie unterscheiden sich in nichts von jeder anderen Zustellung.
 */

/** Die Fehlercodes, die diese Schleife nach aussen meldet. Mehr gibt es nicht. */
export type LogDrainCollectorFailureCode =
  | "LOG_DRAIN_COLLECTOR_UNREACHABLE"
  | "LOG_DRAIN_COLLECTOR_DISCOVERY_FAILED"
  | "LOG_DRAIN_COLLECTOR_CURSOR_FAILED";

export class LogDrainCollectorRuntimeError extends Error {
  constructor(readonly code: "LOG_DRAIN_COLLECTOR_RUNTIME_INVALID_INPUT") {
    super(code);
    this.name = "LogDrainCollectorRuntimeError";
  }
}
recognisedByName(LogDrainCollectorRuntimeError, "LogDrainCollectorRuntimeError");

/**
 * Wie viele Drains eine Umgebung hat und wie viele davon eingeschaltet sind.
 *
 * Beide Zahlen, nicht nur die eingeschaltete: `total` sagt, ob diese Umgebung
 * ueberhaupt etwas mit Log-Drains zu tun hat -- nur solche werden gepollt.
 * `enabled` sagt, ob dabei Ladungen entstehen koennen, und geht in die Meldung
 * ein.
 */
export interface LogDrainCensus {
  drainCounts(scope: WebhookOutboxScope): Promise<{ total: number; enabled: number }>;
}

export type LogDrainCollectorRound = Readonly<{
  /** Drains, die in dieser Runde gelesen wurden, in der Reihenfolge der Runde. */
  polled: readonly string[];
  /** Drains und Umgebungen, die wegen ihres Backoffs uebersprungen wurden. */
  skipped: readonly string[];
  enqueued: number;
  failed: number;
}>;

export type LogDrainCollectorRuntimeOptions = {
  /**
   * Die Umgebungen, die dieser Prozess bedient -- dieselbe Liste, die Cron,
   * Zustellung und Bruecke bedienen. Gepollt wird davon nur eine Teilmenge.
   */
  scopes: readonly WebhookOutboxScope[];
  reader: LogDrainSourceReader;
  drains: LogDrainBindingSource;
  census: LogDrainCensus;
  cursors: LogDrainCursorStore;
  outbox: Pick<WebhookOutbox, "enqueue">;
  /** Ab so vielen gesammelten Eintraegen geht eine Ladung hinaus. */
  maxBatchEntries?: number;
  /** Und spaetestens nach dieser Zeit, auch wenn die Ladung kleiner bleibt. */
  maxBatchAgeMs?: number;
  /** Wie viele Zeilen ein Lauf je Quelle hoechstens liest. */
  readLimit?: number;
  /** Wartezeit, wenn eine ganze Runde nichts eingereiht hat. */
  idleIntervalMs?: number;
  /** Grundwert des Backoffs eines gescheiterten Drains. Verdoppelt sich. */
  errorIntervalMs?: number;
  /** Obergrenze des Backoffs. */
  maxErrorIntervalMs?: number;
  /** Abstand zwischen zwei Entdeckungslaeufen. */
  discoveryIntervalMs?: number;
  /**
   * Nimmt jeden Fehlschlag entgegen -- mit Code und Umgebungsindex, ohne
   * Datenbankmeldung, ohne Id und ohne Ziel. Genau wie bei der Bruecke: Eine
   * Schleife, die jede Sekunde scheitert, soll von einer untaetigen
   * unterscheidbar sein.
   */
  onFailure?: (code: LogDrainCollectorFailureCode, scopeIndex: number) => void;
  /**
   * Nimmt entgegen, dass ein Drain Ladungen erzeugt hat.
   *
   * Nur, wenn wirklich etwas eingereiht wurde. Eine leere Runde zu melden
   * hiesse, den Takt zu protokollieren statt die Arbeit.
   */
  onEnqueued?: (scopeIndex: number, enqueued: number) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Die Bindung genau eines Drains, aus der Liste der Runde gesetzt.
 *
 * Der Sammler fragt bei jedem Lauf nach seinen aktiven Kopplungen; hier
 * bekommt er die eine, um die es geht -- ohne eine zweite Abfrage und ohne
 * dass er von den uebrigen Drains der Umgebung etwas erfuehre.
 */
class PinnedDrain implements LogDrainBindingSource {
  constructor(public binding: LogDrainBinding) {}

  async activeDrains(): Promise<LogDrainBinding[]> {
    return [this.binding];
  }
}

type WatchedDrain = {
  webhookId: string;
  pinned: PinnedDrain;
  collector: LogDrainCollector;
  /** Zeitpunkt, ab dem dieser Drain wieder gelesen werden darf. */
  notBefore: number;
  consecutiveFailures: number;
};

type WatchedScope = {
  scope: WebhookOutboxScope;
  scopeIndex: number;
  /** Backoff fuer das Lesen der Drain-Liste dieser Umgebung. */
  notBefore: number;
  consecutiveFailures: number;
  drains: Map<string, WatchedDrain>;
};

export function logDrainScopeKey(scope: WebhookOutboxScope): string {
  return `${scope.organizationId} ${scope.projectId} ${scope.environment}`;
}

export function logDrainKey(scope: WebhookOutboxScope, webhookId: string): string {
  return `${logDrainScopeKey(scope)} ${webhookId}`;
}

/**
 * Welche Umgebungen gepollt werden.
 *
 * Gepollt wird, wer ueberhaupt einen Drain hat -- auch, wenn alle davon
 * abgeschaltet sind. Der Sammler sammelt fuer einen abgeschalteten Drain
 * nichts; er soll die Umgebung aber trotzdem in der Hand behalten, weil
 * Anschalten und Abschalten jederzeit passieren und eine Umgebung sonst erst
 * beim naechsten Entdeckungslauf wieder auftauchte.
 *
 * Eine Umgebung **ohne jeden** Drain wird nicht angefasst. Sie ist der Fall,
 * fuer den es die Entdeckung gibt: Sie sieht von dieser Schleife keine einzige
 * Abfrage auf ihre Logs.
 *
 * Scheitert die Frage fuer eine Umgebung, bleibt es bei der letzten Antwort.
 * Eine kurz nicht erreichbare Control Plane soll eine laufende Umgebung nicht
 * stilllegen und eine stillgelegte nicht anwerfen.
 */
export async function discoverLogDrainEnvironments(
  scopes: readonly WebhookOutboxScope[],
  census: LogDrainCensus,
  previous: ReadonlySet<string> = new Set<string>(),
  onFailure?: (code: LogDrainCollectorFailureCode, scopeIndex: number) => void,
): Promise<{ scopes: WebhookOutboxScope[]; failures: number }> {
  const wanted: WebhookOutboxScope[] = [];
  let failures = 0;
  for (const [scopeIndex, scope] of scopes.entries()) {
    let keep: boolean;
    try {
      keep = (await census.drainCounts(scope)).total > 0;
    } catch {
      failures += 1;
      onFailure?.("LOG_DRAIN_COLLECTOR_DISCOVERY_FAILED", scopeIndex);
      keep = previous.has(logDrainScopeKey(scope));
    }
    if (keep) wanted.push(scope);
  }
  return { scopes: wanted, failures };
}

export class LogDrainCollectorRuntime {
  private readonly watched = new Map<string, WatchedScope>();
  private readonly maxBatchEntries: number;
  private readonly maxBatchAgeMs: number;
  private readonly readLimit: number;
  private readonly idleIntervalMs: number;
  private readonly errorIntervalMs: number;
  private readonly maxErrorIntervalMs: number;
  private readonly discoveryIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextDiscoveryAt = 0;
  private running = false;
  private stopping = false;
  private wake: (() => void) | null = null;

  constructor(private readonly options: LogDrainCollectorRuntimeOptions) {
    this.maxBatchEntries = bounded(options.maxBatchEntries ?? 100, 1, 1_000);
    this.maxBatchAgeMs = bounded(options.maxBatchAgeMs ?? 60_000, 1_000, 3_600_000);
    this.readLimit = bounded(options.readLimit ?? 200, 1, 1_000);
    this.idleIntervalMs = bounded(options.idleIntervalMs ?? 1_000, 50, 60_000);
    this.errorIntervalMs = bounded(options.errorIntervalMs ?? 5_000, 100, 300_000);
    this.maxErrorIntervalMs = bounded(
      options.maxErrorIntervalMs ?? Math.max(options.errorIntervalMs ?? 5_000, 300_000),
      this.errorIntervalMs, 3_600_000,
    );
    this.discoveryIntervalMs = bounded(options.discoveryIntervalMs ?? 30_000, 250, 3_600_000);
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => { clearTimeout(timer); resolve(); };
    }));
  }

  /** Aktuell beobachtete Umgebungen, in der Reihenfolge der Runde. Fuer Tests und Diagnose. */
  get watching(): string[] {
    return [...this.watched.values()]
      .sort((left, right) => left.scopeIndex - right.scopeIndex)
      .map((entry) => logDrainScopeKey(entry.scope));
  }

  /** Aktuell beobachtete Drains, in der Reihenfolge der Runde. */
  get watchingDrains(): string[] {
    return [...this.watched.values()]
      .sort((left, right) => left.scopeIndex - right.scopeIndex)
      .flatMap((entry) => [...entry.drains.keys()].map((id) => logDrainKey(entry.scope, id)));
  }

  /** Gleicht die beobachteten Umgebungen an die Drains der Control Plane an. */
  async reconcile(): Promise<void> {
    const before = new Set(this.watched.keys());
    const discovered = await discoverLogDrainEnvironments(
      this.options.scopes, this.options.census, before, this.options.onFailure,
    );
    const wanted = new Set<string>();
    for (const scope of discovered.scopes) {
      const key = logDrainScopeKey(scope);
      wanted.add(key);
      if (this.watched.has(key)) continue;
      this.watched.set(key, {
        scope,
        scopeIndex: this.options.scopes.indexOf(scope),
        notBefore: 0,
        consecutiveFailures: 0,
        drains: new Map(),
      });
    }

    for (const [key, entry] of [...this.watched]) {
      if (wanted.has(key)) continue;
      this.watched.delete(key);
      for (const drain of entry.drains.values()) drain.collector.stop();
    }
  }

  /**
   * Eine Runde: entdecken, wenn faellig, danach jede beobachtete Umgebung
   * einmal auflisten und jeden ihrer aktiven Drains einmal sammeln lassen.
   *
   * Ein gescheiterter Drain beendet die Runde nicht. Er bekommt ein Backoff,
   * das sich mit jedem Fehlschlag verdoppelt, und die uebrigen Drains werden
   * weiter gelesen -- genau das ist der Unterschied zwischen einem Prozess,
   * der einen Drain verliert, und einem, der alle verliert.
   */
  async runOnce(): Promise<LogDrainCollectorRound> {
    const polled: string[] = [];
    const skipped: string[] = [];
    let enqueued = 0;
    let failed = 0;

    if (this.now() >= this.nextDiscoveryAt) {
      this.nextDiscoveryAt = this.now() + this.discoveryIntervalMs;
      await this.reconcile();
    }

    const round = [...this.watched.values()].sort(
      (left, right) => left.scopeIndex - right.scopeIndex,
    );
    for (const entry of round) {
      if (this.stopping) break;
      if (this.now() < entry.notBefore) {
        skipped.push(logDrainScopeKey(entry.scope));
        continue;
      }
      let bindings: readonly LogDrainBinding[];
      try {
        bindings = await this.options.drains.activeDrains(entry.scope);
      } catch {
        failed += 1;
        entry.consecutiveFailures += 1;
        entry.notBefore = this.now() + this.backoffMs(entry.consecutiveFailures);
        this.options.onFailure?.("LOG_DRAIN_COLLECTOR_DISCOVERY_FAILED", entry.scopeIndex);
        continue;
      }
      entry.consecutiveFailures = 0;

      // Ein Drain, der abgeschaltet oder geloescht wurde, verliert seinen
      // Sammler und damit seinen Puffer. Eine Ladung nach dem Abschalten waere
      // genau das, was das Abschalten verhindern soll.
      const active = new Set(bindings.map((binding) => binding.webhookId));
      for (const [webhookId, drain] of [...entry.drains]) {
        if (active.has(webhookId)) continue;
        entry.drains.delete(webhookId);
        drain.collector.stop();
      }

      for (const binding of bindings) {
        if (this.stopping) break;
        const drain = this.watch(entry, binding);
        const key = logDrainKey(entry.scope, binding.webhookId);
        if (this.now() < drain.notBefore) { skipped.push(key); continue; }
        try {
          const batches = await drain.collector.poll();
          enqueued += batches;
          drain.consecutiveFailures = 0;
          polled.push(key);
          if (batches > 0) this.options.onEnqueued?.(entry.scopeIndex, batches);
        } catch (error) {
          failed += 1;
          drain.consecutiveFailures += 1;
          drain.notBefore = this.now() + this.backoffMs(drain.consecutiveFailures);
          this.options.onFailure?.(failureCode(error), entry.scopeIndex);
        }
      }
    }

    return Object.freeze({
      polled: Object.freeze(polled), skipped: Object.freeze(skipped), enqueued, failed,
    });
  }

  /** Laeuft, bis `stop` gerufen wird. Kehrt erst danach zurueck. */
  async run(): Promise<void> {
    if (this.running) {
      throw new LogDrainCollectorRuntimeError("LOG_DRAIN_COLLECTOR_RUNTIME_INVALID_INPUT");
    }
    this.running = true;
    this.stopping = false;
    try {
      while (!this.stopping) {
        let round: LogDrainCollectorRound;
        try {
          round = await this.runOnce();
        } catch {
          // Bis hierher kommt nur ein Fehler ausserhalb eines einzelnen
          // Drains. Er darf den Takt nicht beenden.
          if (this.stopping) break;
          await this.sleep(this.errorIntervalMs);
          continue;
        }
        if (this.stopping) break;
        // Gewartet wird nur, wenn nichts eingereiht wurde. Ein Rueckstand soll
        // nicht im Takt des Intervalls abgearbeitet werden.
        if (round.enqueued === 0) await this.sleep(this.idleIntervalMs);
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Beendet die Schleife und weckt eine laufende Wartezeit sofort.
   *
   * Offene Puffer gehen dabei **nicht** hinaus. Sie sind noch nicht eingereiht,
   * ihre Position ist darum noch nicht festgehalten, und der naechste Start
   * liest denselben Bereich noch einmal. Ein Hinausschicken beim Beenden waere
   * eine Ladung, die im SIGTERM-Fenster niemand mehr quittieren kann.
   */
  stop(): void {
    this.stopping = true;
    for (const entry of this.watched.values()) {
      for (const drain of entry.drains.values()) drain.collector.stop();
    }
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private watch(entry: WatchedScope, binding: LogDrainBinding): WatchedDrain {
    const existing = entry.drains.get(binding.webhookId);
    if (existing) {
      // Dieselbe Bindung, frisch gelesen: Quellen und Fassung koennen sich
      // nicht aendern (0054 gewaehrt kein UPDATE), der Schalter schon.
      existing.pinned.binding = binding;
      return existing;
    }
    const pinned = new PinnedDrain(binding);
    const drain: WatchedDrain = {
      webhookId: binding.webhookId,
      pinned,
      collector: new LogDrainCollector({
        reader: this.options.reader,
        drains: pinned,
        outbox: this.options.outbox,
        cursors: this.options.cursors,
        scope: entry.scope,
        maxBatchEntries: this.maxBatchEntries,
        maxBatchAgeMs: this.maxBatchAgeMs,
        readLimit: this.readLimit,
      }),
      notBefore: 0,
      consecutiveFailures: 0,
    };
    entry.drains.set(binding.webhookId, drain);
    return drain;
  }

  private backoffMs(consecutiveFailures: number): number {
    const grown = this.errorIntervalMs * 2 ** Math.min(consecutiveFailures - 1, 20);
    return Math.min(grown, this.maxErrorIntervalMs);
  }
}

/**
 * Was nach aussen gemeldet wird: eine unlesbare oder unschreibbare Position
 * ist etwas anderes als eine Quelle, die nicht antwortet. Mehr Unterschiede
 * macht diese Schleife nicht -- alles Weitere waere eine Datenbankmeldung.
 */
function failureCode(error: unknown): LogDrainCollectorFailureCode {
  return error instanceof LogDrainCollectorError
    && error.code === "LOG_DRAIN_COLLECTOR_CURSOR_FAILED"
    ? "LOG_DRAIN_COLLECTOR_CURSOR_FAILED"
    : "LOG_DRAIN_COLLECTOR_UNREACHABLE";
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new LogDrainCollectorRuntimeError("LOG_DRAIN_COLLECTOR_RUNTIME_INVALID_INPUT");
  }
  return value;
}
