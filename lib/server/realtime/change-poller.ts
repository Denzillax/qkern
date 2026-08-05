import type { RealtimeChangeSource } from "@/lib/server/realtime/change-source";
import type { RealtimeScope } from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";

/**
 * Dienst-Teilmenge, die der Poller braucht. Bewusst schmal gehalten, damit ein
 * Test ihn ohne vollständigen `RealtimeService` treiben kann.
 */
export interface RealtimeChangeConsumer {
  deliverChanges(changes: readonly Awaited<ReturnType<RealtimeChangeSource["read"]>>[number][]):
    Promise<string[]>;
}

export type RealtimeChangePollerOptions = {
  source: RealtimeChangeSource;
  consumer: RealtimeChangeConsumer;
  scope: RealtimeScope;
  /** Wird für jede Verbindung aufgerufen, die wegen Rückstaus zu schließen ist. */
  onOverloaded?: (connectionId: string) => void;
  batchSize?: number;
  /** Position, ab der gelesen wird. Jede Instanz führt ihre eigene. */
  startPosition?: number;
};

/**
 * Verbindet die Änderungsquelle mit der Zustellung.
 *
 * Bis hierher existierten beide Seiten, aber nichts rief sie auf: Erfasste
 * Änderungen lagen im Feed und erreichten niemanden.
 *
 * Drei Eigenschaften prägen ihn:
 *
 * **Die Position wird erst nach der Zustellung fortgeschrieben.** Scheitert ein
 * Durchlauf, wird derselbe Bereich erneut gelesen. Lieber eine Änderung zweimal
 * zustellen als sie zu verlieren — die Zustellung ist für den Abonnenten
 * beobachtbar, ein Verlust nicht.
 *
 * **Läufe überlappen nicht.** Ein zweiter `poll` während eines laufenden kehrt
 * sofort zurück, statt denselben Bereich parallel zu verarbeiten.
 *
 * **Die Position ist instanzlokal.** Jede Instanz beliefert eigene Abonnenten
 * und führt deshalb eine eigene Position. Genau deshalb räumt der Poller den
 * Feed nicht auf: Er wüsste nicht, was andere Instanzen noch brauchen.
 */
export class RealtimeChangePoller {
  private position: number;
  private readonly batchSize: number;
  private running = false;
  private stopped = false;

  constructor(private readonly options: RealtimeChangePollerOptions) {
    this.position = bounded(options.startPosition ?? 0, 0, Number.MAX_SAFE_INTEGER);
    this.batchSize = bounded(options.batchSize ?? 100, 1, 500);
  }

  /** Zuletzt erfolgreich zugestellte Position dieser Instanz. */
  get currentPosition(): number {
    return this.position;
  }

  /**
   * Liest und stellt einen Stapel zu. Gibt die Zahl der zugestellten Änderungen
   * zurück; `0` bedeutet, dass der Feed aufgeholt ist.
   */
  async poll(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    try {
      const changes = await this.options.source.read(
        this.options.scope, this.position, this.batchSize,
      );
      if (changes.length === 0) return 0;

      const overloaded = await this.options.consumer.deliverChanges(changes);
      for (const connectionId of overloaded) this.options.onOverloaded?.(connectionId);

      const highest = changes[changes.length - 1].position;
      if (highest <= this.position) throw new RealtimeError("REALTIME_INVALID_MESSAGE");
      this.position = highest;
      return changes.length;
    } finally {
      this.running = false;
    }
  }

  /**
   * Holt den Feed vollständig auf, höchstens `maxBatches` Stapel.
   *
   * Die Grenze ist Absicht: Ohne sie könnte ein schnell wachsender Feed den
   * Aufruf beliebig lange festhalten und andere Arbeit aushungern.
   */
  async drain(maxBatches = 10): Promise<number> {
    let delivered = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const count = await this.poll();
      delivered += count;
      if (count < this.batchSize) break;
    }
    return delivered;
  }

  stop(): void {
    this.stopped = true;
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return value;
}
