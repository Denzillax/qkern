import { recognisedByName } from "@/lib/server/errors/identity";
import {
  databaseWebhookEventType,
  type DatabaseWebhookEvent,
} from "@/lib/console/database-webhooks";
import type { WebhookOutbox, WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";
import type { ProjectQueueJson } from "@/lib/server/project-queues/model";
import type { RealtimeChange, RealtimeChangeSource } from "@/lib/server/realtime/change-source";

/**
 * Die Kopplung (2.50): aus einer erfassten Tabellenaenderung wird eine
 * wartende Webhook-Zustellung.
 *
 * ## Gewaehlter Weg: der vorhandene Change Feed
 *
 * Realtime beobachtet Tabellenaenderungen seit `db/project/0003` ueber
 * `qkern_internal.change_feed` und den Trigger `capture_change()`. Diese
 * Bruecke liest **denselben** Feed ueber dieselbe `RealtimeChangeSource` und
 * installiert in der Kundendatenbank nichts. Der verworfene Gegenentwurf waere
 * ein eigener Trigger samt eigener Funktion ueber ein Change Set gewesen; er
 * haette zwei Erfassungswege mit zwei Zusicherungen darueber nebeneinander
 * gestellt, was eine erfasste Aenderung traegt, und jede Tabelle mit zwei
 * Triggern fuer dieselbe Beobachtung belastet. Die Begruendung in voller Laenge
 * steht in `lib/console/database-webhooks`.
 *
 * Die Folge, offen gesagt: Eine Tabelle ohne `capture_change`-Trigger erzeugt
 * keine Zustellung. Das Anschalten je Tabelle ist eine Schemaaenderung und
 * laeuft ueber Change Set und Freigabezentrale — derselbe Weg, den Realtime
 * dafuer schon nimmt.
 *
 * ## Warum die Position erst nach dem Einreihen weiterwandert
 *
 * Genau wie beim `RealtimeChangePoller`: Scheitert ein Durchlauf, wird derselbe
 * Bereich erneut gelesen. Lieber eine Zustellung doppelt als eine verlorene —
 * die Zustellung traegt eine eigene Id, und ein Empfaenger, der zweimal
 * dasselbe Ereignis sieht, kann es an `position` erkennen. Eine verlorene
 * Aenderung koennte er nirgends erkennen.
 *
 * Laeufe ueberlappen nicht, und die Position ist instanzlokal. Aufgeraeumt wird
 * der Feed hier nicht: Diese Bruecke wuesste nicht, was Realtime noch braucht.
 */

/** Eine Kopplung, wie die Control Plane sie haelt. Ohne URL, ohne Referenz. */
export type DatabaseWebhookBinding = Readonly<{
  webhookId: string;
  schema: string;
  table: string;
  events: readonly DatabaseWebhookEvent[];
}>;

/** Die Nutzlast. Mehr als diese sechs Felder gibt es nicht. */
export type DatabaseWebhookPayload = Readonly<{
  schema: string;
  table: string;
  operation: DatabaseWebhookEvent;
  /** Ausschliesslich die Primaerschluesselwerte, wie der Feed sie haelt. */
  key: Readonly<Record<string, unknown>>;
  position: number;
  committedAt: string;
}>;

export type DatabaseWebhookDelivery = Readonly<{
  webhookId: string;
  eventType: string;
  occurredAt: Date;
  payload: DatabaseWebhookPayload;
}>;

/**
 * Macht aus einer erfassten Aenderung die Zustellung einer Kopplung, oder
 * `null`, wenn die Kopplung sie nichts angeht.
 *
 * Uebernommen wird ausschliesslich, was der Feed ohnehin haelt: Schema,
 * Tabelle, Operation, Primaerschluessel, Position, Commit-Zeitpunkt. Die
 * Funktion kennt keine Verbindung, keine Claims und keinen Leser; sie kann
 * darum gar keinen Spaltenwert beschaffen, den der Feed nicht schon traegt.
 * Genau deshalb ist sie ein eigenes, reines Stueck Code und einzeln pruefbar.
 */
export function changeToDelivery(
  binding: DatabaseWebhookBinding,
  change: RealtimeChange,
): DatabaseWebhookDelivery | null {
  if (change.schema !== binding.schema || change.table !== binding.table) return null;
  if (!binding.events.includes(change.operation)) return null;
  if (!Number.isSafeInteger(change.position) || change.position < 1) return null;
  const committedAt = change.committedAt instanceof Date ? change.committedAt : new Date(NaN);
  if (Number.isNaN(committedAt.getTime())) return null;
  const key = change.key;
  if (!key || typeof key !== "object" || Array.isArray(key)) return null;

  return Object.freeze({
    webhookId: binding.webhookId,
    eventType: databaseWebhookEventType(change.operation),
    occurredAt: committedAt,
    payload: Object.freeze({
      schema: change.schema,
      table: change.table,
      operation: change.operation,
      // Flache Kopie: Der Aufrufer soll die Aenderung nicht ueber die Nutzlast
      // veraendern koennen.
      key: Object.freeze({ ...key }),
      position: change.position,
      committedAt: committedAt.toISOString(),
    }),
  });
}

export interface DatabaseWebhookBindingSource {
  /** Die aktiven Kopplungen dieser Umgebung. Abgeschaltete gehoeren nicht dazu. */
  activeBindings(scope: WebhookOutboxScope): Promise<DatabaseWebhookBinding[]>;
}

export type DatabaseWebhookBridgeOptions = {
  source: RealtimeChangeSource;
  bindings: DatabaseWebhookBindingSource;
  outbox: Pick<WebhookOutbox, "enqueue">;
  scope: WebhookOutboxScope;
  batchSize?: number;
  /** Position, ab der gelesen wird. Jede Instanz fuehrt ihre eigene. */
  startPosition?: number;
};

export class DatabaseWebhookBridgeError extends Error {
  constructor(readonly code: "DATABASE_WEBHOOK_BRIDGE_INVALID_INPUT") {
    super(code);
    this.name = "DatabaseWebhookBridgeError";
  }
}
recognisedByName(DatabaseWebhookBridgeError, "DatabaseWebhookBridgeError");

export class DatabaseWebhookBridge {
  private position: number;
  private readonly batchSize: number;
  private running = false;
  private stopped = false;

  constructor(private readonly options: DatabaseWebhookBridgeOptions) {
    this.position = bounded(options.startPosition ?? 0, 0, Number.MAX_SAFE_INTEGER);
    this.batchSize = bounded(options.batchSize ?? 100, 1, 500);
  }

  /** Zuletzt vollstaendig eingereihte Position dieser Instanz. */
  get currentPosition(): number {
    return this.position;
  }

  /**
   * Liest einen Stapel und reiht die passenden Zustellungen ein. Gibt die Zahl
   * der eingereihten Zustellungen zurueck.
   *
   * Ohne aktive Kopplung wird der Feed trotzdem gelesen und die Position
   * weitergesetzt: Sonst wuerde eine spaeter angelegte Kopplung mit der ganzen
   * Vergangenheit des Feeds beginnen, und ein Empfaenger bekaeme beim
   * Einschalten einen Schwall alter Ereignisse.
   */
  async poll(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    try {
      const changes = await this.options.source.read(
        this.options.scope, this.position, this.batchSize,
      );
      if (changes.length === 0) return 0;

      const bindings = await this.options.bindings.activeBindings(this.options.scope);
      let enqueued = 0;
      for (const change of changes) {
        for (const binding of bindings) {
          const delivery = changeToDelivery(binding, change);
          if (!delivery) continue;
          await this.options.outbox.enqueue(this.options.scope, {
            webhookId: delivery.webhookId,
            eventType: delivery.eventType,
            payload: delivery.payload as unknown as ProjectQueueJson,
            occurredAt: delivery.occurredAt,
          });
          enqueued += 1;
        }
      }

      const highest = changes[changes.length - 1].position;
      if (highest <= this.position) throw new DatabaseWebhookBridgeError("DATABASE_WEBHOOK_BRIDGE_INVALID_INPUT");
      this.position = highest;
      return enqueued;
    } finally {
      this.running = false;
    }
  }

  /**
   * Holt den Feed auf, hoechstens `maxBatches` Stapel.
   *
   * Die Grenze ist Absicht: Ohne sie koennte ein schnell wachsender Feed den
   * Aufruf beliebig lange festhalten.
   */
  async drain(maxBatches = 10): Promise<number> {
    let enqueued = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const before = this.position;
      enqueued += await this.poll();
      if (this.position === before) break;
    }
    return enqueued;
  }

  stop(): void {
    this.stopped = true;
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DatabaseWebhookBridgeError("DATABASE_WEBHOOK_BRIDGE_INVALID_INPUT");
  }
  return value;
}
