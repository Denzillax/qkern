import type { RealtimeChangePoller } from "@/lib/server/realtime/change-poller";
import { RealtimeError } from "@/lib/server/realtime/model";

export type RealtimeChangePollerRuntimeOptions = {
  poller: Pick<RealtimeChangePoller, "poll" | "stop">;
  /** Wartezeit, wenn der letzte Lauf nichts fand. */
  idleIntervalMs?: number;
  /**
   * Wartezeit nach einem Fehler. Bewusst länger als das Leerlaufintervall: Ein
   * dauerhaft fehlschlagender Lauf soll die Datenbank nicht mit Wiederholungen
   * belasten.
   */
  errorIntervalMs?: number;
  /** Wird bei jedem Fehler aufgerufen. Erhält keine Payload und keinen Cursor. */
  onError?: (error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Betreibt einen `RealtimeChangePoller` als Dauerschleife.
 *
 * Bis 1.14 existierte der Poller, aber kein Prozess rief ihn auf. Erfasste
 * Änderungen erreichten damit weiterhin niemanden — dieselbe Lücke zwischen
 * „gebaut" und „in Betrieb", die dieser Sprint mehrfach aufgedeckt hat.
 *
 * Die Schleife wartet nur, wenn nichts zu tun war. Findet ein Lauf Änderungen,
 * folgt der nächste sofort: Ein Rückstand soll nicht im Takt des Intervalls
 * abgearbeitet werden, sondern so schnell wie möglich.
 */
export class RealtimeChangePollerRuntime {
  private readonly idleIntervalMs: number;
  private readonly errorIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private running = false;
  private stopping = false;
  private wake: (() => void) | null = null;

  constructor(private readonly options: RealtimeChangePollerRuntimeOptions) {
    this.idleIntervalMs = bounded(options.idleIntervalMs ?? 500, 50, 60_000);
    this.errorIntervalMs = bounded(options.errorIntervalMs ?? 5_000, 100, 300_000);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => { clearTimeout(timer); resolve(); };
    }));
  }

  get active(): boolean {
    return this.running;
  }

  /** Läuft, bis `stop` gerufen wird. Kehrt erst danach zurück. */
  async run(): Promise<void> {
    if (this.running) throw new RealtimeError("REALTIME_INVALID_MESSAGE");
    this.running = true;
    this.stopping = false;
    try {
      while (!this.stopping) {
        let delivered = 0;
        try {
          delivered = await this.options.poller.poll();
        } catch (error) {
          // Ein Fehler beendet die Schleife nicht: Der naechste Lauf liest
          // denselben Bereich erneut, weil die Position nicht fortgeschrieben
          // wurde.
          this.options.onError?.(error);
          if (this.stopping) break;
          await this.sleep(this.errorIntervalMs);
          continue;
        }
        if (this.stopping) break;
        if (delivered === 0) await this.sleep(this.idleIntervalMs);
      }
    } finally {
      this.running = false;
    }
  }

  /** Beendet die Schleife und weckt eine laufende Wartezeit sofort. */
  stop(): void {
    this.stopping = true;
    this.options.poller.stop();
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RealtimeError("REALTIME_INVALID_MESSAGE");
  }
  return value;
}
