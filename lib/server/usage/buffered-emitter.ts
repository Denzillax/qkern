import { randomUUID } from "node:crypto";
import type { UsageMetric, UsageScope } from "@/lib/server/usage/model";
import type { UsageAdmission, UsageEmitterPort, UsageMeasurement } from "@/lib/server/usage/emitter";

const ADMITTED: UsageAdmission = Object.freeze({ admitted: true, reason: null });
const MAX_QUANTITY = 1_000_000_000_000;

type Pending = {
  scope: UsageScope;
  metric: UsageMetric;
  quantity: number;
  /**
   * Wird beim ersten Ereignis eines Stapels vergeben und bleibt, bis der Stapel
   * geschrieben ist. Ein wiederholter Schreibversuch trägt damit denselben
   * Schlüssel und zählt nicht doppelt.
   */
  reference: string;
};

export type BufferedUsageEmitterOptions = {
  /** Wohin gebündelt geschrieben wird. */
  inner: UsageEmitterPort;
  /** Ab dieser gesammelten Menge je Schlüssel wird sofort geschrieben. */
  flushAtQuantity?: number;
  /** Höchstzahl gleichzeitig gepufferter Scope-Metrik-Paare. */
  maxKeys?: number;
  /** Höchstzahl aufbewahrter Stapel, die das Ledger nicht erreicht haben. */
  maxRetryBatches?: number;
  id?: () => string;
};

/**
 * Sammelt Messungen und schreibt sie gebündelt.
 *
 * Für `realtime_messages` ist eine Buchung je Nachricht keine Option: Der
 * Realtime-Pfad misst seine Latenz in Millisekunden, und eine
 * Control-Plane-Transaktion je Broadcast wäre ein absehbarer Fehler.
 *
 * Der Preis ist ehrlich zu nennen, und er ist doppelt:
 *
 * **Dieser Emitter kann nicht gaten.** `admit` lässt immer durch. Man kann
 * keine Nachricht ablehnen, die man bereits in einem offenen Stapel gezählt
 * hat. Deshalb steht `realtime_messages` in `UNENFORCEABLE_USAGE_METRICS`: Ein
 * hartes Limit wäre hier eine Zusage, die niemand einhält.
 *
 * **Ein Absturz verliert den Puffer.** Das ist die gewählte Richtung: lieber zu
 * wenig zählen als zu viel. Wer zu viel zählt, stellt in Rechnung, was nie
 * stattgefunden hat; wer zu wenig zählt, verschenkt. Nur eine dieser beiden
 * Fehlerarten kann man einem Kunden zumuten.
 *
 * Die laufende Transaktion einer Operation wird ignoriert — es gibt sie beim
 * Schreiben längst nicht mehr.
 */
export class BufferedUsageEmitter implements UsageEmitterPort {
  private readonly pending = new Map<string, Pending>();
  /** Stapel, die das Ledger nicht erreicht haben. Begrenzt: Speicher ist endlich. */
  private readonly retry: Pending[] = [];
  private readonly flushAtQuantity: number;
  private readonly maxKeys: number;
  private readonly maxRetryBatches: number;
  private readonly id: () => string;
  private flushing: Promise<void> | null = null;

  constructor(private readonly options: BufferedUsageEmitterOptions) {
    this.flushAtQuantity = bounded(options.flushAtQuantity ?? 500, 1, 1_000_000);
    this.maxKeys = bounded(options.maxKeys ?? 1_000, 1, 100_000);
    this.maxRetryBatches = bounded(options.maxRetryBatches ?? 100, 1, 10_000);
    this.id = options.id ?? (() => randomUUID());
  }

  async admit(scope: UsageScope, input: UsageMeasurement): Promise<UsageAdmission> {
    const quantity = input.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return ADMITTED;

    const key = `${scope.organizationId}:${scope.projectId}:${scope.environment}:${input.metric}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, MAX_QUANTITY);
    } else {
      // Ein voller Puffer wird geschrieben, nicht verworfen. Eine Messung
      // stillschweigend fallen zu lassen, waere genau der Fehler, den dieser
      // ganze Sprint sucht.
      if (this.pending.size >= this.maxKeys) await this.flush();
      this.pending.set(key, {
        scope: { ...scope }, metric: input.metric, quantity, reference: this.id(),
      });
    }

    if ((this.pending.get(key)?.quantity ?? 0) >= this.flushAtQuantity) await this.flush();
    return ADMITTED;
  }

  /** Gepufferte Anzahl eines Schlüssels. Nur zur Beobachtung. */
  buffered(scope: UsageScope, metric: UsageMetric): number {
    const key = `${scope.organizationId}:${scope.projectId}:${scope.environment}:${metric}`;
    return this.pending.get(key)?.quantity ?? 0;
  }

  /**
   * Schreibt alles Gesammelte.
   *
   * Nebenläufige Aufrufe teilen sich einen Durchlauf. Zwei gleichzeitige
   * Schreibvorgänge desselben Stapels würden denselben Schlüssel tragen und
   * damit ohnehin dedupliziert — aber sie würden den Puffer zweimal leeren und
   * dabei die Zwischenzeit verlieren.
   */
  async flush(): Promise<void> {
    if (this.flushing) return await this.flushing;
    const run = this.flushOnce();
    this.flushing = run;
    try { await run; } finally { this.flushing = null; }
  }

  private async flushOnce(): Promise<void> {
    // Zuerst die Stapel, die beim letzten Mal nicht ankamen, und zwar
    // **unverändert**. Sie mit neuen Ereignissen zusammenzulegen würde ihre
    // Menge ändern — derselbe Schlüssel mit anderem Inhalt ist ein
    // Idempotenzkonflikt und würde den Stapel dauerhaft unschreibbar machen.
    const batch = [...this.retry.splice(0), ...this.pending.values()];
    this.pending.clear();

    for (const entry of batch) {
      const admission = await this.options.inner.admit(entry.scope, {
        metric: entry.metric, quantity: entry.quantity, reference: entry.reference,
      });
      // `unavailable` heisst: Das Ledger hat nichts verbucht. Der Stapel wird
      // beim nächsten Mal erneut versucht; sein Schlüssel bleibt derselbe, ein
      // doppelt angekommener Stapel zählt also trotzdem einmal.
      //
      // `quota_exceeded` und `conflict` heissen: Das Ledger hat entschieden.
      // Ein erneuter Versuch bekäme dieselbe Antwort, und der Stapel wird
      // verworfen. Genau deshalb ist ein hartes Limit für eine gebündelte
      // Metrik nicht setzbar.
      if (admission.reason !== "unavailable") continue;
      if (this.retry.length < this.maxRetryBatches) this.retry.push(entry);
    }
  }

  /** Letzter Schreibvorgang beim Herunterfahren. */
  async stop(): Promise<void> {
    await this.flush();
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError("A buffered usage emitter setting is out of range.");
  }
  return value;
}
