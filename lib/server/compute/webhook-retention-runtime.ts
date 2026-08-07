import type { WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";

export interface WebhookDeliveryRetention {
  pruneDeliveries(scope: WebhookOutboxScope, input: {
    deliveredBefore: Date; deadLetteredBefore: Date;
  }): Promise<{ delivered: number; deadLettered: number }>;
}

export type WebhookRetentionResult = Readonly<{ delivered: number; deadLettered: number }>;

export type WebhookRetentionRuntimeOptions = {
  repository: WebhookDeliveryRetention;
  scopes: readonly WebhookOutboxScope[];
  deliveredRetentionMs: number;
  deadLetterRetentionMs: number;
  intervalMs?: number;
  now?: () => Date;
  /** Erhält nur Zahlen, nie Ziele oder Nutzlasten. */
  onPruned?: (result: WebhookRetentionResult) => void;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Räumt abgeschlossene Webhook-Zustellungen auf.
 *
 * `project_webhook_deliveries` wuchs seit Release 1.19 unbegrenzt: Eine
 * zugestellte Zeile blieb für immer liegen. Aufgefallen ist das erst, als
 * Release 1.37 dieselbe Lücke beim Realtime-Event-Log geschlossen hat — der
 * Blick auf die eine Tabelle zeigte die andere.
 *
 * **Wartende und laufende Zustellungen bleiben unberührt.** Eine ausstehende
 * Zustellung ist keine Altlast; sie zu löschen wäre der stille Verlust genau
 * der Nachricht, die noch ankommen soll.
 *
 * Zugestellte und tote haben getrennte Fenster. Eine tote Zustellung ist der
 * Grund, warum ein Betreiber überhaupt in diese Tabelle schaut, und darf nicht
 * mit dem Alltagsrauschen verschwinden.
 */
export class WebhookRetentionRuntime {
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private stopping = false;
  private wake: (() => void) | null = null;

  constructor(private readonly options: WebhookRetentionRuntimeOptions) {
    this.intervalMs = bounded(options.intervalMs ?? 3_600_000, 1_000, 86_400_000);
    bounded(options.deliveredRetentionMs, 60_000, 365 * 86_400_000);
    bounded(options.deadLetterRetentionMs, 60_000, 365 * 86_400_000);
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => { clearTimeout(timer); resolve(); };
    }));
  }

  async runOnce(): Promise<WebhookRetentionResult> {
    const now = this.now();
    let delivered = 0;
    let deadLettered = 0;
    for (const scope of this.options.scopes) {
      if (this.stopping) break;
      try {
        const removed = await this.options.repository.pruneDeliveries(scope, {
          deliveredBefore: new Date(now.getTime() - this.options.deliveredRetentionMs),
          deadLetteredBefore: new Date(now.getTime() - this.options.deadLetterRetentionMs),
        });
        delivered += removed.delivered;
        deadLettered += removed.deadLettered;
      } catch {
        // Ein Projekt, das gerade klemmt, darf die uebrigen nicht aufhalten.
        // Die Ursache bleibt draussen: Sie kann eine Datenbankmeldung tragen.
      }
    }
    const result = Object.freeze({ delivered, deadLettered });
    if (delivered > 0 || deadLettered > 0) this.options.onPruned?.(result);
    return result;
  }

  async run(): Promise<void> {
    this.stopping = false;
    while (!this.stopping) {
      try { await this.runOnce(); } catch { /* naechster Durchlauf */ }
      if (this.stopping) break;
      await this.sleep(this.intervalMs);
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
    throw new RangeError("A webhook retention setting is out of range.");
  }
  return value;
}
