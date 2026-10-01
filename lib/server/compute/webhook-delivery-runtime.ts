import type { WebhookDefinition } from "@/lib/server/compute/model";
import { WebhookDeliveryError, type WebhookDeliverer } from "@/lib/server/compute/webhooks";
import {
  WebhookOutboxError,
  type WebhookClaim,
  type WebhookFailureCode,
  type WebhookOutbox,
  type WebhookOutboxScope,
} from "@/lib/server/compute/webhook-outbox";

export interface WebhookDefinitionSource {
  /** Aktive Definition zu einer Zustellung, oder `null` wenn sie nicht mehr gilt. */
  find(scope: WebhookOutboxScope, webhookId: string): Promise<WebhookDefinition | null>;
}

export type WebhookDeliveryRuntimeOptions = {
  outbox: Pick<WebhookOutbox, "claim" | "acknowledge" | "fail">;
  deliverer: Pick<WebhookDeliverer, "deliver">;
  definitions: WebhookDefinitionSource;
  scope: WebhookOutboxScope;
  workerId: string;
  batchSize?: number;
  idleIntervalMs?: number;
  /**
   * Wartezeit, nachdem der Claim selbst fehlgeschlagen ist. Bewusst länger als
   * das Leerlaufintervall: Eine nicht erreichbare Datenbank soll nicht mit
   * Wiederholungen belastet werden.
   */
  errorIntervalMs?: number;
  /** Erhält nur den Fehlercode, niemals Payload, URL oder Signatur. */
  onFailure?: (code: WebhookFailureCode) => void;
  /**
   * Meldet eine gelungene Zustellung.
   *
   * Bis Release 1.54 gab es nur den Fehlerhaken: Ein Prozess konnte melden,
   * dass etwas schiefging, nie dass etwas ankam. Ein Log, das nur Fehler kennt,
   * beantwortet die haeufigste Frage nicht — laeuft es?
   */
  onDelivered?: () => void;
  sleep?: (ms: number) => Promise<void>;
};

export type WebhookRunResult = { delivered: number; failed: number; skipped: number };

/**
 * Betreibt die Webhook-Zustellung: claim, senden, settlen.
 *
 * Bis Release 1.19 existierten Outbox und Deliverer, aber nichts verband sie —
 * ein hinterlegtes Ereignis wurde nie gesendet. Das ist dasselbe Muster, das
 * dieser Sprint bereits beim Realtime-Poller und beim dauerhaften Event-Log
 * gefunden hat: gebaut, zertifiziert, und trotzdem wirkungslos.
 *
 * Ein Fehlschlag beendet den Durchlauf nicht. Die übrigen Zustellungen sollen
 * nicht daran hängen, dass ein Empfänger langsam ist — genau dafür hat jede
 * Zustellung ihre eigene Lease und ihren eigenen Versuchszähler.
 */
export class WebhookDeliveryRuntime {
  private readonly batchSize: number;
  private readonly idleIntervalMs: number;
  private readonly errorIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private stopping = false;
  private running = false;
  private wake: (() => void) | null = null;

  constructor(private readonly options: WebhookDeliveryRuntimeOptions) {
    this.batchSize = bounded(options.batchSize ?? 5, 1, 10);
    this.idleIntervalMs = bounded(options.idleIntervalMs ?? 1_000, 50, 60_000);
    this.errorIntervalMs = bounded(options.errorIntervalMs ?? 5_000, 100, 300_000);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => { clearTimeout(timer); resolve(); };
    }));
  }

  /** Verarbeitet höchstens einen Stapel. */
  async runOnce(): Promise<WebhookRunResult> {
    const result: WebhookRunResult = { delivered: 0, failed: 0, skipped: 0 };
    if (this.stopping) return result;

    const claims = await this.options.outbox.claim(this.options.scope, {
      workerId: this.options.workerId, limit: this.batchSize,
    });

    for (const claim of claims) {
      const definition = await this.options.definitions.find(this.options.scope, claim.webhookId);
      if (!definition) {
        // Die Definition wurde abgeschaltet, waehrend die Zustellung wartete.
        // Sie trotzdem zu senden waere gegen den Willen des Betreibers, und sie
        // zu verwerfen ebenso falsch, weil ein Abschalten ruecknehmbar ist.
        // Deshalb geschieht hier nichts: Die Lease laeuft ab, der Claim gibt die
        // Zustellung wieder frei, und solange der Webhook abgeschaltet bleibt,
        // wird sie nicht erneut geholt.
        result.skipped += 1;
        continue;
      }
      try {
        await this.options.deliverer.deliver(definition, {
          id: claim.id,
          webhookId: claim.webhookId,
          eventType: claim.eventType,
          occurredAt: claim.occurredAt.toISOString(),
          payload: claim.payload,
          // Der Anschluss kommt aus der Zeile und nicht aus diesem Prozess
          // (2.125). Deshalb traegt ihn auch der zweite Versuch nach einem
          // verfallenen Lease, und zwar denselben: Ein Versuch, der eine andere
          // Spur nennt als der erste, haengt denselben Vorgang an zwei Orte.
          trace: claim.trace,
        });
        await this.options.outbox.acknowledge(this.options.scope, claim.id, {
          workerId: this.options.workerId, leaseToken: claim.leaseToken,
        });
        result.delivered += 1;
        this.options.onDelivered?.();
      } catch (error) {
        // Ein anderer Fehler als der des Zustellers bleibt ein Fehlschlag des
        // Empfaengers: Er darf die Zustellung nicht stillschweigend verlieren.
        const code: WebhookFailureCode = error instanceof WebhookDeliveryError
          ? error.code
          : "WEBHOOK_REJECTED";
        this.options.onFailure?.(code);
        await this.settleFailure(claim, code);
        result.failed += 1;
      }
    }
    return result;
  }

  /** Läuft, bis `stop` gerufen wird. */
  async run(): Promise<void> {
    if (this.running) throw new WebhookOutboxError("WEBHOOK_OUTBOX_INVALID_INPUT");
    this.running = true;
    this.stopping = false;
    try {
      while (!this.stopping) {
        let processed: number;
        try {
          const result = await this.runOnce();
          processed = result.delivered + result.failed + result.skipped;
        } catch {
          // Ein Fehler beim Claim selbst — etwa eine kurz nicht erreichbare
          // Datenbank — darf die Schleife nicht beenden. Der Fehler wird nicht
          // weitergereicht: Er kann eine Datenbankmeldung tragen und gehoert
          // nicht ins Log dieses Prozesses.
          if (this.stopping) break;
          await this.sleep(this.errorIntervalMs);
          continue;
        }
        if (this.stopping) break;
        if (processed === 0) await this.sleep(this.idleIntervalMs);
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

  /**
   * Meldet den Fehlschlag. Ein verlorener Lease wird verschluckt: Die
   * Zustellung gehört dann bereits einem anderen Worker, und ein Fehler hier
   * würde den Stapel abbrechen, ohne etwas zu verbessern.
   */
  private async settleFailure(claim: WebhookClaim, code: WebhookFailureCode): Promise<void> {
    try {
      await this.options.outbox.fail(this.options.scope, claim.id, {
        webhookId: claim.webhookId,
        workerId: this.options.workerId,
        leaseToken: claim.leaseToken,
        failureCode: code,
        attemptCount: claim.attemptCount,
      });
    } catch (error) {
      if (!(error instanceof WebhookOutboxError)) throw error;
    }
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new WebhookOutboxError("WEBHOOK_OUTBOX_INVALID_INPUT");
  }
  return value;
}
