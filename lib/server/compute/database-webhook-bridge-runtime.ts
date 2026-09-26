import { recognisedByName } from "@/lib/server/errors/identity";
import {
  DatabaseWebhookBridge,
  type DatabaseWebhookBindingSource,
} from "@/lib/server/compute/database-webhook-bridge";
import type { WebhookOutbox, WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";
import type { RealtimeChangeSource } from "@/lib/server/realtime/change-source";

/**
 * Die Webhook-Bruecke als Dauerprozess (2.53).
 *
 * ## Was 2.50 offen gelassen hat
 *
 * 2.50 hat `DatabaseWebhookBridge` gebaut und die ganze Kette zertifiziert --
 * aber niemand rief sie auf. Der Compute-Prozess kannte seine Scopes und die
 * Control Plane und hielt keine Verbindung zu einer Projektdatenbank, und
 * genau die braucht `qkern_internal.change_feed`. Gebaut, zertifiziert,
 * untaetig: dasselbe Muster, das dieses Projekt beim Realtime-Poller (1.14),
 * beim dauerhaften Event-Log (1.14) und bei der Laufzeitprobe (1.53) schon
 * gefunden hat.
 *
 * ## Warum eine Schleife und nicht ein Poller je Umgebung
 *
 * Realtime loest dasselbe Problem mit `RealtimeChangePollerRegistry`: je
 * beobachtetem Projekt ein eigener Poller, gestartet und beendet, wenn ein
 * Abonnent kommt oder geht. Das ist dort richtig, weil die Menge sich im
 * Sekundentakt aendert und jeder Abonnent seine eigene Antwortzeit erwartet.
 *
 * Hier ist beides anders. Die Menge steht in `QKERN_COMPUTE_SCOPES_JSON` und
 * ist auf 32 begrenzt, und am anderen Ende wartet kein Mensch, sondern eine
 * Outbox mit eigenem Takt. Eine Schleife, die der Reihe nach durch die
 * Umgebungen geht, hat dafuer zwei Vorteile, die zaehlen: Die Reihenfolge ist
 * festgelegt und pruefbar, und es ist zu **jedem Zeitpunkt hoechstens eine**
 * Projektverbindung offen. Ein Poller je Umgebung haette bis zu 32
 * gleichzeitig offen, ohne dass irgendjemand auf sie wartet.
 *
 * Alles andere ist von Realtime uebernommen statt neu erfunden: warten nur,
 * wenn nichts zu tun war; nach einem Fehler laenger warten als im Leerlauf;
 * die Position erst nach dem Einreihen weitersetzen.
 *
 * ## Aufbewahrung
 *
 * Diese Schleife raeumt nichts auf, und das ist keine Luecke. Den Feed raeumt
 * `RealtimeRetentionRuntime` (`QKERN_REALTIME_CHANGE_RETENTION_MS`) -- die
 * Bruecke wuesste nicht, was Realtime noch braucht, und zwei Aufraeumer auf
 * derselben Tabelle waeren zwei Meinungen darueber, was weg darf. Die
 * Zustellungen, die hier entstehen, raeumt `WebhookRetentionRuntime` im selben
 * Prozess; sie unterscheiden sich in nichts von jeder anderen Zustellung.
 *
 * ## Rueckstau
 *
 * Realtime schliesst ein Abonnement, das nicht mitkommt. Hier gibt es kein
 * Abonnement, das man schliessen koennte: Der Empfaenger ist die Outbox, und
 * die hat ihr eigenes Backoff. Die Grenze ist stattdessen `maxBatches` je
 * Runde -- eine Umgebung mit grossem Rueckstand darf die uebrigen nicht
 * aushungern.
 */

/** Die Fehlercodes, die diese Schleife nach aussen meldet. Mehr gibt es nicht. */
export type DatabaseWebhookBridgeFailureCode =
  | "DATABASE_WEBHOOK_BRIDGE_UNREACHABLE"
  | "DATABASE_WEBHOOK_BRIDGE_DISCOVERY_FAILED"
  | "DATABASE_WEBHOOK_BRIDGE_CURSOR_FAILED";

export class DatabaseWebhookBridgeRuntimeError extends Error {
  constructor(readonly code: "DATABASE_WEBHOOK_BRIDGE_RUNTIME_INVALID_INPUT") {
    super(code);
    this.name = "DatabaseWebhookBridgeRuntimeError";
  }
}
recognisedByName(DatabaseWebhookBridgeRuntimeError, "DatabaseWebhookBridgeRuntimeError");

/**
 * Wie viele Kopplungen eine Umgebung hat und wie viele davon eingeschaltet
 * sind.
 *
 * Beide Zahlen, nicht nur die eingeschaltete: Sie beantworten zwei
 * verschiedene Fragen. `total` sagt, ob diese Umgebung ueberhaupt etwas mit
 * Datenbank-Webhooks zu tun hat -- nur solche werden gepollt. `enabled` sagt,
 * ob dabei Zustellungen entstehen koennen, und geht in die Meldung ein.
 */
export interface DatabaseWebhookCouplingCensus {
  couplingCounts(scope: WebhookOutboxScope): Promise<{ total: number; enabled: number }>;
}

/**
 * Die Position je Umgebung, dauerhaft.
 *
 * `DatabaseWebhookBridge` fuehrt sie instanzlokal und nimmt sie als
 * `startPosition` entgegen -- genau diese Naht wird hier bedient, statt die
 * Bruecke umzubauen.
 */
export interface DatabaseWebhookCursorStore {
  load(scope: WebhookOutboxScope): Promise<number>;
  save(scope: WebhookOutboxScope, position: number): Promise<void>;
}

export type DatabaseWebhookBridgeRound = Readonly<{
  /** Umgebungen, die in dieser Runde gelesen wurden, in der Reihenfolge der Runde. */
  polled: readonly string[];
  /** Umgebungen, die wegen ihres Backoffs uebersprungen wurden. */
  skipped: readonly string[];
  enqueued: number;
  failed: number;
}>;

export type DatabaseWebhookBridgeRuntimeOptions = {
  /**
   * Die Umgebungen, die dieser Prozess bedient -- dieselbe Liste, die Cron und
   * Zustellung bedienen. Gepollt wird davon nur eine Teilmenge.
   */
  scopes: readonly WebhookOutboxScope[];
  source: RealtimeChangeSource;
  bindings: DatabaseWebhookBindingSource;
  census: DatabaseWebhookCouplingCensus;
  cursors: DatabaseWebhookCursorStore;
  outbox: Pick<WebhookOutbox, "enqueue">;
  batchSize?: number;
  /** Hoechstzahl Stapel je Umgebung und Runde. Bremst den Rueckstand einer Umgebung. */
  maxBatches?: number;
  /** Wartezeit, wenn eine ganze Runde nichts eingereiht hat. */
  idleIntervalMs?: number;
  /** Grundwert des Backoffs einer unerreichbaren Umgebung. Verdoppelt sich. */
  errorIntervalMs?: number;
  /** Obergrenze des Backoffs. */
  maxErrorIntervalMs?: number;
  /** Abstand zwischen zwei Entdeckungslaeufen. */
  discoveryIntervalMs?: number;
  /**
   * Nimmt jeden Fehlschlag entgegen -- mit Code und Umgebungsindex, ohne
   * Datenbankmeldung und ohne Id. Genau wie beim Zusteller: Eine Schleife, die
   * jede Sekunde scheitert, soll von einer untaetigen unterscheidbar sein.
   */
  onFailure?: (code: DatabaseWebhookBridgeFailureCode, scopeIndex: number) => void;
  /**
   * Nimmt entgegen, dass eine Umgebung Zustellungen erzeugt hat.
   *
   * Je Umgebung und nur, wenn wirklich etwas eingereiht wurde. Eine leere
   * Runde zu melden hiesse, den Takt zu protokollieren statt die Arbeit.
   */
  onEnqueued?: (scopeIndex: number, enqueued: number) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type Watched = {
  scope: WebhookOutboxScope;
  scopeIndex: number;
  bridge: DatabaseWebhookBridge;
  /** Zeitpunkt, ab dem diese Umgebung wieder gelesen werden darf. */
  notBefore: number;
  consecutiveFailures: number;
  /** Zuletzt dauerhaft geschriebene Position. Verhindert ein Schreiben ohne Fortschritt. */
  savedPosition: number;
};

export function databaseWebhookScopeKey(scope: WebhookOutboxScope): string {
  return `${scope.organizationId} ${scope.projectId} ${scope.environment}`;
}

/**
 * Welche Umgebungen gepollt werden.
 *
 * **Gepollt wird, wer ueberhaupt eine Kopplung hat -- nicht nur, wer eine
 * eingeschaltete hat.** Das ist eine bewusste Abweichung, und sie hat einen
 * Grund: Die Bruecke liest den Feed auch ohne eingeschaltete Kopplung und
 * setzt ihre Position weiter, damit eine Pause nicht zum Stau wird. Wer eine
 * Umgebung mit ausschliesslich abgeschalteten Kopplungen aus der Liste nimmt,
 * kehrt genau das um: Beim Wiedereinschalten bekaeme der Empfaenger auf einen
 * Schlag alles, was der Feed seit dem Abschalten haelt. 2.50 hat diese Regel
 * ausdruecklich aufgestellt, und sie waere hier still verloren gegangen.
 *
 * Eine Umgebung **ohne jede** Kopplung wird nicht angefasst. Sie ist der Fall,
 * fuer den es die Entdeckung gibt: Ihre Projektdatenbank sieht von dieser
 * Schleife keine einzige Verbindung.
 *
 * Scheitert die Frage fuer eine Umgebung, bleibt es bei der letzten Antwort.
 * Eine kurz nicht erreichbare Control Plane soll eine laufende Umgebung nicht
 * stilllegen und eine stillgelegte nicht anwerfen.
 */
export async function discoverDatabaseWebhookEnvironments(
  scopes: readonly WebhookOutboxScope[],
  census: DatabaseWebhookCouplingCensus,
  previous: ReadonlySet<string> = new Set<string>(),
  onFailure?: (code: DatabaseWebhookBridgeFailureCode, scopeIndex: number) => void,
): Promise<{ scopes: WebhookOutboxScope[]; failures: number }> {
  const wanted: WebhookOutboxScope[] = [];
  let failures = 0;
  for (const [scopeIndex, scope] of scopes.entries()) {
    let keep: boolean;
    try {
      keep = (await census.couplingCounts(scope)).total > 0;
    } catch {
      failures += 1;
      onFailure?.("DATABASE_WEBHOOK_BRIDGE_DISCOVERY_FAILED", scopeIndex);
      keep = previous.has(databaseWebhookScopeKey(scope));
    }
    if (keep) wanted.push(scope);
  }
  return { scopes: wanted, failures };
}

export class DatabaseWebhookBridgeRuntime {
  private readonly watched = new Map<string, Watched>();
  private readonly batchSize: number;
  private readonly maxBatches: number;
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

  constructor(private readonly options: DatabaseWebhookBridgeRuntimeOptions) {
    this.batchSize = bounded(options.batchSize ?? 100, 1, 500);
    this.maxBatches = bounded(options.maxBatches ?? 10, 1, 100);
    this.idleIntervalMs = bounded(options.idleIntervalMs ?? 1_000, 50, 60_000);
    this.errorIntervalMs = bounded(options.errorIntervalMs ?? 5_000, 100, 300_000);
    this.maxErrorIntervalMs = bounded(
      options.maxErrorIntervalMs ?? Math.max(this.errorIntervalMs, 300_000),
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
      .map((entry) => databaseWebhookScopeKey(entry.scope));
  }

  /**
   * Gleicht die beobachteten Umgebungen an die Kopplungen der Control Plane an.
   *
   * Eine neue Umgebung startet bei ihrer **gespeicherten** Position. Scheitert
   * das Lesen der Position, wird die Umgebung diesmal nicht aufgenommen: Bei 0
   * zu beginnen hiesse, den ganzen noch vorhandenen Feed einzureihen, und das
   * ist schlimmer als eine Runde zu warten.
   */
  async reconcile(): Promise<void> {
    const before = new Set(this.watched.keys());
    const discovered = await discoverDatabaseWebhookEnvironments(
      this.options.scopes, this.options.census, before, this.options.onFailure,
    );
    const wanted = new Map<string, { scope: WebhookOutboxScope; scopeIndex: number }>();
    for (const scope of discovered.scopes) {
      const scopeIndex = this.options.scopes.indexOf(scope);
      wanted.set(databaseWebhookScopeKey(scope), { scope, scopeIndex });
    }

    for (const [key, entry] of wanted) {
      if (this.watched.has(key)) continue;
      let startPosition: number;
      try {
        startPosition = await this.options.cursors.load(entry.scope);
      } catch {
        this.options.onFailure?.("DATABASE_WEBHOOK_BRIDGE_CURSOR_FAILED", entry.scopeIndex);
        continue;
      }
      this.watched.set(key, {
        scope: entry.scope,
        scopeIndex: entry.scopeIndex,
        bridge: new DatabaseWebhookBridge({
          source: this.options.source,
          bindings: this.options.bindings,
          outbox: this.options.outbox,
          scope: entry.scope,
          batchSize: this.batchSize,
          startPosition,
        }),
        notBefore: 0,
        consecutiveFailures: 0,
        savedPosition: startPosition,
      });
    }

    for (const key of [...this.watched.keys()]) {
      if (wanted.has(key)) continue;
      const entry = this.watched.get(key)!;
      this.watched.delete(key);
      entry.bridge.stop();
    }
  }

  /**
   * Eine Runde: entdecken, wenn faellig, danach jede beobachtete Umgebung
   * einmal lesen.
   *
   * Eine unerreichbare Projektdatenbank beendet die Runde nicht. Sie bekommt
   * ein Backoff, das sich mit jedem Fehlschlag verdoppelt, und die uebrigen
   * Umgebungen werden weiter gelesen -- genau das ist der Unterschied zwischen
   * einem Prozess, der eine Umgebung verliert, und einem, der alle verliert.
   */
  async runOnce(): Promise<DatabaseWebhookBridgeRound> {
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
      const key = databaseWebhookScopeKey(entry.scope);
      if (this.now() < entry.notBefore) { skipped.push(key); continue; }
      try {
        const round = await entry.bridge.drain(this.maxBatches);
        enqueued += round;
        entry.consecutiveFailures = 0;
        polled.push(key);
        if (round > 0) this.options.onEnqueued?.(entry.scopeIndex, round);
      } catch {
        failed += 1;
        entry.consecutiveFailures += 1;
        entry.notBefore = this.now() + this.backoffMs(entry.consecutiveFailures);
        this.options.onFailure?.("DATABASE_WEBHOOK_BRIDGE_UNREACHABLE", entry.scopeIndex);
        continue;
      }
      // Erst einreihen, dann die Position festhalten -- dieselbe Reihenfolge,
      // die die Bruecke intern haelt. Ein Absturz zwischen beiden wiederholt
      // hoechstens einen Stapel; er verliert keinen.
      const position = entry.bridge.currentPosition;
      if (position > entry.savedPosition) {
        try {
          await this.options.cursors.save(entry.scope, position);
          entry.savedPosition = position;
        } catch {
          failed += 1;
          this.options.onFailure?.("DATABASE_WEBHOOK_BRIDGE_CURSOR_FAILED", entry.scopeIndex);
        }
      }
    }

    return Object.freeze({
      polled: Object.freeze(polled), skipped: Object.freeze(skipped), enqueued, failed,
    });
  }

  /** Laeuft, bis `stop` gerufen wird. Kehrt erst danach zurueck. */
  async run(): Promise<void> {
    if (this.running) throw new DatabaseWebhookBridgeRuntimeError(
      "DATABASE_WEBHOOK_BRIDGE_RUNTIME_INVALID_INPUT");
    this.running = true;
    this.stopping = false;
    try {
      while (!this.stopping) {
        let round: DatabaseWebhookBridgeRound;
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

  /** Beendet die Schleife und weckt eine laufende Wartezeit sofort. */
  stop(): void {
    this.stopping = true;
    for (const entry of this.watched.values()) entry.bridge.stop();
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private backoffMs(consecutiveFailures: number): number {
    const grown = this.errorIntervalMs * 2 ** Math.min(consecutiveFailures - 1, 20);
    return Math.min(grown, this.maxErrorIntervalMs);
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DatabaseWebhookBridgeRuntimeError("DATABASE_WEBHOOK_BRIDGE_RUNTIME_INVALID_INPUT");
  }
  return value;
}
