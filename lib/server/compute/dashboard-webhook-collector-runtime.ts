import { recognisedByName } from "@/lib/server/errors/identity";
import {
  DashboardWebhookCollector,
  DashboardWebhookCollectorError,
  type DashboardEventReader,
  type DashboardWebhookBindingSource,
  type DashboardWebhookCursorStore,
} from "@/lib/server/compute/dashboard-webhooks";
import type { WebhookOutbox, WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

/**
 * Der Dashboard-Webhook-Sammler als Dauerprozess (2.75).
 *
 * ## Warum er von Anfang an mitgebaut wird
 *
 * 2.54 hat den Log-Drain-Sammler gebaut und zertifiziert, und niemand rief ihn
 * auf; 2.64 hat das nachgeholt. Eine Seite, die "QKERN meldet dieses Ereignis"
 * sagt, waehrend kein Prozess sammelt, ist derselbe Platzhalter wie vorher, nur
 * mit mehr Code dahinter. Diese Schleife gehoert darum in denselben Slice.
 *
 * Sie ist das Geschwister von `LogDrainCollectorRuntime` und
 * `DatabaseWebhookBridgeRuntime`: Entdeckung aus der Control Plane, eine
 * Schleife in der Reihenfolge der Scope-Liste, Backoff je Einheit, feste
 * Fehlercodes ohne Datenbankmeldung, sauberes Ende.
 *
 * ## Warum ein Sammler je Umgebung und nicht je Webhook
 *
 * Das ist der eine Unterschied zum Log-Drain-Sammler, und er folgt daraus, dass
 * hier nicht gebuendelt wird. Dort haelt jeder Drain einen Puffer, der zwischen
 * zwei Runden stehen bleiben muss, und darum braucht jeder Drain seinen eigenen
 * Sammler. Hier geht jedes Ereignis einzeln hinaus; es gibt nichts, was eine
 * Runde ueberdauern muesste, ausser der Position -- und die liegt in der
 * Datenbank.
 *
 * Das Backoff gilt deshalb je Umgebung. Was hier scheitern kann, ist der Zugriff
 * auf dieselbe Control Plane, aus der alle Kopplungen und alle Ereignisse dieser
 * Umgebung kommen; ein Fehlschlag gehoert nicht zu einem einzelnen Webhook.
 *
 * ## Aufbewahrung
 *
 * Diese Schleife raeumt nichts auf, und das ist keine Luecke. `audit_logs` ist
 * append-only und gehoert der Control Plane; die Zustellungen, die hier
 * entstehen, raeumt `WebhookRetentionRuntime` im selben Prozess. Sie
 * unterscheiden sich in nichts von jeder anderen Zustellung.
 */

/** Die Fehlercodes, die diese Schleife nach aussen meldet. Mehr gibt es nicht. */
export type DashboardWebhookFailureCode =
  | "DASHBOARD_WEBHOOK_COLLECTOR_UNREACHABLE"
  | "DASHBOARD_WEBHOOK_COLLECTOR_DISCOVERY_FAILED"
  | "DASHBOARD_WEBHOOK_COLLECTOR_CURSOR_FAILED";

export class DashboardWebhookRuntimeError extends Error {
  constructor(readonly code: "DASHBOARD_WEBHOOK_RUNTIME_INVALID_INPUT") {
    super(code);
    this.name = "DashboardWebhookRuntimeError";
  }
}
recognisedByName(DashboardWebhookRuntimeError, "DashboardWebhookRuntimeError");

/**
 * Wie viele Dashboard-Webhooks eine Umgebung hat und wie viele davon
 * eingeschaltet sind.
 *
 * Beide Zahlen, nicht nur die eingeschaltete: `total` sagt, ob diese Umgebung
 * ueberhaupt etwas mit Dashboard-Webhooks zu tun hat -- nur solche werden
 * gepollt. `enabled` sagt, ob dabei Meldungen entstehen koennen.
 */
export interface DashboardWebhookCensus {
  dashboardWebhookCounts(scope: WebhookOutboxScope):
    Promise<{ total: number; enabled: number }>;
}

export type DashboardWebhookRound = Readonly<{
  /** Umgebungen, die in dieser Runde gelesen wurden, in der Reihenfolge der Runde. */
  polled: readonly string[];
  /** Umgebungen, die wegen ihres Backoffs uebersprungen wurden. */
  skipped: readonly string[];
  enqueued: number;
  failed: number;
}>;

export type DashboardWebhookRuntimeOptions = {
  /**
   * Die Umgebungen, die dieser Prozess bedient -- dieselbe Liste, die Cron,
   * Zustellung, Bruecke und Log-Drains bedienen. Gepollt wird davon nur eine
   * Teilmenge.
   */
  scopes: readonly WebhookOutboxScope[];
  reader: DashboardEventReader;
  bindings: DashboardWebhookBindingSource;
  census: DashboardWebhookCensus;
  cursors: DashboardWebhookCursorStore;
  outbox: Pick<WebhookOutbox, "enqueue">;
  /** Wie viele Eintraege ein Lauf je Ereignisart hoechstens liest. */
  readLimit?: number;
  /** Wartezeit, wenn eine ganze Runde nichts eingereiht hat. */
  idleIntervalMs?: number;
  /** Grundwert des Backoffs einer gescheiterten Umgebung. Verdoppelt sich. */
  errorIntervalMs?: number;
  /** Obergrenze des Backoffs. */
  maxErrorIntervalMs?: number;
  /** Abstand zwischen zwei Entdeckungslaeufen. */
  discoveryIntervalMs?: number;
  /**
   * Nimmt jeden Fehlschlag entgegen -- mit Code und Umgebungsindex, ohne
   * Datenbankmeldung, ohne Id und ohne Ziel. Eine Schleife, die jede Sekunde
   * scheitert, soll von einer untaetigen unterscheidbar sein.
   */
  onFailure?: (code: DashboardWebhookFailureCode, scopeIndex: number) => void;
  /**
   * Nimmt entgegen, dass eine Umgebung Meldungen erzeugt hat. Nur, wenn wirklich
   * etwas eingereiht wurde: Eine leere Runde zu melden hiesse, den Takt zu
   * protokollieren statt die Arbeit.
   */
  onEnqueued?: (scopeIndex: number, enqueued: number) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type WatchedScope = {
  scope: WebhookOutboxScope;
  scopeIndex: number;
  collector: DashboardWebhookCollector;
  /** Zeitpunkt, ab dem diese Umgebung wieder gelesen werden darf. */
  notBefore: number;
  consecutiveFailures: number;
};

export function dashboardWebhookScopeKey(scope: WebhookOutboxScope): string {
  return `${scope.organizationId} ${scope.projectId} ${scope.environment}`;
}

/**
 * Welche Umgebungen gepollt werden.
 *
 * Gepollt wird, wer ueberhaupt einen Dashboard-Webhook hat -- auch, wenn alle
 * davon abgeschaltet sind. Der Sammler sammelt fuer einen abgeschalteten nichts;
 * er soll die Umgebung aber trotzdem in der Hand behalten, weil Anschalten und
 * Abschalten jederzeit passieren und eine Umgebung sonst erst beim naechsten
 * Entdeckungslauf wieder auftauchte.
 *
 * Eine Umgebung **ohne jeden** Dashboard-Webhook wird nicht angefasst. Sie ist
 * der Fall, fuer den es die Entdeckung gibt: Sie sieht von dieser Schleife keine
 * einzige Abfrage auf ihre Audit-Kette.
 *
 * Scheitert die Frage fuer eine Umgebung, bleibt es bei der letzten Antwort.
 * Eine kurz nicht erreichbare Control Plane soll eine laufende Umgebung nicht
 * stilllegen und eine stillgelegte nicht anwerfen.
 */
export async function discoverDashboardWebhookEnvironments(
  scopes: readonly WebhookOutboxScope[],
  census: DashboardWebhookCensus,
  previous: ReadonlySet<string> = new Set<string>(),
  onFailure?: (code: DashboardWebhookFailureCode, scopeIndex: number) => void,
): Promise<{ scopes: WebhookOutboxScope[]; failures: number }> {
  const wanted: WebhookOutboxScope[] = [];
  let failures = 0;
  for (const [scopeIndex, scope] of scopes.entries()) {
    let keep: boolean;
    try {
      keep = (await census.dashboardWebhookCounts(scope)).total > 0;
    } catch {
      failures += 1;
      onFailure?.("DASHBOARD_WEBHOOK_COLLECTOR_DISCOVERY_FAILED", scopeIndex);
      keep = previous.has(dashboardWebhookScopeKey(scope));
    }
    if (keep) wanted.push(scope);
  }
  return { scopes: wanted, failures };
}

export class DashboardWebhookCollectorRuntime {
  private readonly watched = new Map<string, WatchedScope>();
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

  constructor(private readonly options: DashboardWebhookRuntimeOptions) {
    this.readLimit = bounded(options.readLimit ?? 100, 1, 1_000);
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
      .map((entry) => dashboardWebhookScopeKey(entry.scope));
  }

  /** Gleicht die beobachteten Umgebungen an die Kopplungen der Control Plane an. */
  async reconcile(): Promise<void> {
    const before = new Set(this.watched.keys());
    const discovered = await discoverDashboardWebhookEnvironments(
      this.options.scopes, this.options.census, before, this.options.onFailure,
    );
    const wanted = new Set<string>();
    for (const scope of discovered.scopes) {
      const key = dashboardWebhookScopeKey(scope);
      wanted.add(key);
      if (this.watched.has(key)) continue;
      this.watched.set(key, {
        scope,
        scopeIndex: this.options.scopes.indexOf(scope),
        collector: new DashboardWebhookCollector({
          reader: this.options.reader,
          bindings: this.options.bindings,
          outbox: this.options.outbox,
          cursors: this.options.cursors,
          scope,
          readLimit: this.readLimit,
        }),
        notBefore: 0,
        consecutiveFailures: 0,
      });
    }

    for (const [key, entry] of [...this.watched]) {
      if (wanted.has(key)) continue;
      this.watched.delete(key);
      entry.collector.stop();
    }
  }

  /**
   * Eine Runde: entdecken, wenn faellig, danach jede beobachtete Umgebung einmal
   * sammeln lassen.
   *
   * Eine gescheiterte Umgebung beendet die Runde nicht. Sie bekommt ein Backoff,
   * das sich mit jedem Fehlschlag verdoppelt, und die uebrigen Umgebungen werden
   * weiter gelesen -- genau das ist der Unterschied zwischen einem Prozess, der
   * eine Umgebung verliert, und einem, der alle verliert.
   */
  async runOnce(): Promise<DashboardWebhookRound> {
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
      const key = dashboardWebhookScopeKey(entry.scope);
      if (this.now() < entry.notBefore) { skipped.push(key); continue; }
      try {
        const notices = await entry.collector.poll();
        enqueued += notices;
        entry.consecutiveFailures = 0;
        polled.push(key);
        if (notices > 0) this.options.onEnqueued?.(entry.scopeIndex, notices);
      } catch (error) {
        failed += 1;
        entry.consecutiveFailures += 1;
        entry.notBefore = this.now() + this.backoffMs(entry.consecutiveFailures);
        this.options.onFailure?.(failureCode(error), entry.scopeIndex);
      }
    }

    return Object.freeze({
      polled: Object.freeze(polled), skipped: Object.freeze(skipped), enqueued, failed,
    });
  }

  /** Laeuft, bis `stop` gerufen wird. Kehrt erst danach zurueck. */
  async run(): Promise<void> {
    if (this.running) throw new DashboardWebhookRuntimeError("DASHBOARD_WEBHOOK_RUNTIME_INVALID_INPUT");
    this.running = true;
    this.stopping = false;
    try {
      while (!this.stopping) {
        let round: DashboardWebhookRound;
        try {
          round = await this.runOnce();
        } catch {
          // Bis hierher kommt nur ein Fehler ausserhalb einer einzelnen
          // Umgebung. Er darf den Takt nicht beenden.
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
   * Ein Ereignis, das gelesen aber noch nicht eingereiht war, geht dabei nicht
   * verloren: Seine Position ist noch nicht festgehalten, und der naechste Start
   * liest es erneut.
   */
  stop(): void {
    this.stopping = true;
    for (const entry of this.watched.values()) entry.collector.stop();
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private backoffMs(consecutiveFailures: number): number {
    const grown = this.errorIntervalMs * 2 ** Math.min(consecutiveFailures - 1, 20);
    return Math.min(grown, this.maxErrorIntervalMs);
  }
}

/**
 * Was nach aussen gemeldet wird: eine unlesbare oder unschreibbare Position ist
 * etwas anderes als eine Control Plane, die nicht antwortet. Mehr Unterschiede
 * macht diese Schleife nicht -- alles Weitere waere eine Datenbankmeldung.
 */
function failureCode(error: unknown): DashboardWebhookFailureCode {
  return error instanceof DashboardWebhookCollectorError
    && error.code === "DASHBOARD_WEBHOOK_COLLECTOR_CURSOR_FAILED"
    ? "DASHBOARD_WEBHOOK_COLLECTOR_CURSOR_FAILED"
    : "DASHBOARD_WEBHOOK_COLLECTOR_UNREACHABLE";
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DashboardWebhookRuntimeError("DASHBOARD_WEBHOOK_RUNTIME_INVALID_INPUT");
  }
  return value;
}
