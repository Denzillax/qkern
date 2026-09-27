import { recognisedByName } from "@/lib/server/errors/identity";
import {
  buildLogDrainBatch,
  LogDrainError,
  LOG_DRAIN_SCHEMA_VERSION,
  logDrainEventType,
  validateLogDrain,
  type LogDrainBatch,
  type LogDrainDraft,
  type LogDrainInput,
  type LogDrainRecord,
  type LogDrainSourceId,
} from "@/lib/console/log-drains";
import {
  ComputeDefinitionError,
  type ComputeDefinitionScope,
} from "@/lib/server/compute/definitions";
import type { WebhookOutbox, WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";
import type { ProjectQueueJson, ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

/**
 * Die Verwaltungsflaeche der Log-Drains (2.54) und das Sammeln selbst.
 *
 * Der Dienst legt **zwei** Zeilen an: die ausgehende Webhook-Definition aus 0032
 * und die Kopplung aus 0054, und zwar in einem Repository-Aufruf, der beides in
 * einer Transaktion schreibt. Eine Definition ohne Kopplung waere ein Webhook,
 * den niemand beliefert und den diese Flaeche nicht mehr findet; eine Kopplung
 * ohne Definition gibt es wegen des Fremdschluessels nicht. Dieselbe Naht wie
 * bei den Datenbank-Webhooks (2.50).
 *
 * Geloescht wird in diesem Slice nicht. Abschalten geht und ist der richtige
 * erste Schritt: Es haelt die Ladungen an, ohne etwas zu verlieren.
 *
 * `signingSecretRef` ist durchgaengig eine Referenz. Es gibt in diesem Dienst
 * keinen Parameter, kein Feld und keine Rueckgabe fuer einen Geheimniswert.
 */

export interface LogDrainRepository {
  list(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope): Promise<LogDrainRecord[]>;
  get(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string):
    Promise<LogDrainRecord | null>;
  /** Legt Definition und Kopplung in einer Transaktion an. */
  create(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, draft: LogDrainDraft):
    Promise<LogDrainRecord>;
  setEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<LogDrainRecord | null>;
}

export type LogDrainServiceOptions = {
  repository: LogDrainRepository;
  maxPerScope?: number;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LogDrainService {
  private readonly maxPerScope: number;

  constructor(private readonly options: LogDrainServiceOptions) {
    const limit = options.maxPerScope ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    this.maxPerScope = limit;
  }

  async list(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    this.assertScope(principal, scope);
    return await this.options.repository.list(principal, scope);
  }

  async get(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.get(principal, scope, id);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  /**
   * Legt einen Log-Drain an.
   *
   * Geprueft wird mit **demselben** reinen Modul, das die Ansicht schon vor dem
   * Absenden anwendet. Die Ansicht kann damit den Grund einer Ablehnung zeigen,
   * ohne zu raten, und die Route bleibt trotzdem die Stelle, die entscheidet.
   */
  async create(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    input: LogDrainInput): Promise<LogDrainRecord> {
    this.assertScope(principal, scope);
    let draft: LogDrainDraft;
    try {
      draft = validateLogDrain(input);
    } catch (cause) {
      if (cause instanceof LogDrainError) {
        throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT", { cause });
      }
      throw cause;
    }

    const existing = await this.options.repository.list(principal, scope);
    if (existing.length >= this.maxPerScope) throw new ComputeDefinitionError("COMPUTE_CONFLICT");

    return await this.options.repository.create(principal, scope, draft);
  }

  /**
   * Schaltet an oder ab. Der Schalter sitzt auf der Webhook-Definition, nicht
   * auf der Kopplung: Ein abgeschalteter Webhook holt keine Zustellungen mehr,
   * und wartende bleiben stehen, statt ihre Versuche zu verbrennen. Der
   * Sammler laesst eine abgeschaltete Kopplung ausserdem gar nicht erst
   * sammeln -- sonst staute sich waehrend der Pause genau das an, was die Pause
   * verhindern sollte.
   */
  async setEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, enabled: boolean) {
    this.assertScope(principal, scope);
    this.assertId(id);
    if (typeof enabled !== "boolean") throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    const record = await this.options.repository.setEnabled(principal, scope, id, enabled);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  /** Nur Administratoren, und nur in der eigenen Organisation. */
  private assertScope(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    if (principal.role !== "admin" || principal.organizationId !== scope.organizationId) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
  }

  private assertId(id: string) {
    if (typeof id !== "string" || !ID.test(id)) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
  }
}

/** Eine aktive Kopplung, wie der Sammler sie braucht. Ohne URL, ohne Referenz. */
export type LogDrainBinding = Readonly<{
  webhookId: string;
  sources: readonly LogDrainSourceId[];
  schemaVersion: number;
}>;

export interface LogDrainBindingSource {
  /** Die aktiven Kopplungen dieser Umgebung. Abgeschaltete gehoeren nicht dazu. */
  activeDrains(scope: WebhookOutboxScope): Promise<LogDrainBinding[]>;
}

/**
 * Eine gelesene Zeile einer Quelle.
 *
 * `record` ist die Zeile in der Form, in der die Console sie zeigt; welche
 * Felder daraus wirklich hinausgehen, entscheidet die Whitelist in
 * `lib/console/log-drains`. Ein Leser, der ein Feld zu viel liest, kann es
 * darum nicht weiterleiten.
 *
 * `cursor` ist die Position der Zeile in ihrer Quelle, aufsteigend sortierbar
 * als Text. Sie ist undurchsichtig: Nur der Leser bildet und versteht sie.
 */
export type LogDrainSourceRow = Readonly<{
  cursor: string;
  record: Readonly<Record<string, unknown>>;
}>;

export interface LogDrainSourceReader {
  /**
   * Die Position der neuesten vorhandenen Zeile, oder `null` fuer eine leere
   * Quelle. Der Sammler beginnt dort, statt die Vergangenheit nachzuschicken:
   * Ein neu angelegter Drain soll dem Empfaenger nicht als erste Handlung das
   * ganze bisherige Protokoll schicken.
   */
  tip(scope: WebhookOutboxScope, source: LogDrainSourceId): Promise<string | null>;
  /** Die naechsten Zeilen nach `after`, aelteste zuerst. */
  read(scope: WebhookOutboxScope, source: LogDrainSourceId, input: {
    after: string | null; limit: number;
  }): Promise<readonly LogDrainSourceRow[]>;
}

export class LogDrainCollectorError extends Error {
  constructor(readonly code: "LOG_DRAIN_COLLECTOR_INVALID_INPUT") {
    super(code);
    this.name = "LogDrainCollectorError";
  }
}
recognisedByName(LogDrainCollectorError, "LogDrainCollectorError");

export type LogDrainCollectorOptions = {
  reader: LogDrainSourceReader;
  drains: LogDrainBindingSource;
  outbox: Pick<WebhookOutbox, "enqueue">;
  scope: WebhookOutboxScope;
  /** Ab so vielen gesammelten Eintraegen geht eine Ladung hinaus. */
  maxBatchEntries?: number;
  /** Und spaetestens nach dieser Zeit, auch wenn die Ladung kleiner bleibt. */
  maxBatchAgeMs?: number;
  /** Wie viele Zeilen ein Lauf je Quelle hoechstens liest. */
  readLimit?: number;
  now?: () => Date;
};

type Buffer = {
  rows: Array<Readonly<Record<string, unknown>>>;
  /** Wann der erste Eintrag dieser Ladung gesammelt wurde. */
  openedAt: number;
};

/**
 * Sammelt Logs und reiht sie als Ladung in die **vorhandene** Webhook-Outbox.
 *
 * ## Gewaehlter Weg: der vorhandene Zustellweg
 *
 * Es gibt keinen zweiten. Signiert wird mit `HmacWebhookSigner` ueber den
 * Vault, zugestellt von `WebhookDeliveryRuntime`, wiederholt mit dem
 * serverberechneten Backoff der Outbox, aufgegeben ins Dead Letter nach der
 * Versuchsgrenze der Definition. Ein eigener Zustellweg waere eine zweite
 * Stelle, an der die Regeln fuer ausgehende Verbindungen -- nur HTTPS, kein
 * localhost, keine IP, kein Port, keine Zugangsdaten -- auseinanderfallen
 * koennten, und die erste, die es beim Auseinanderfallen niemand merkt.
 *
 * ## Warum in Ladungen und nicht je Zeile
 *
 * Ein Log-Ziel bekommt sonst je Anmeldung eine HTTPS-Verbindung. Gebuendelt
 * wird nach Anzahl **oder** Alter: Die Anzahl haelt die Last klein, das Alter
 * verhindert, dass eine ruhige Umgebung ihre letzten Eintraege stundenlang
 * liegen laesst.
 *
 * ## Was dieser Sammler nicht verspricht
 *
 * Luckenlosigkeit. Der Stand steht im Prozess, nicht in der Datenbank -- wie
 * die Position der Webhook-Bruecke vor 0050. Ein Neustart beginnt an der
 * Gegenwart, ein abgebrochener Lauf kann eine Ladung doppelt senden. Beides
 * sagt die Ansicht, und beides ist die ehrliche Zusage: Wer eine
 * beweisbare Kette braucht, liest das Audit-Log, das sie hat.
 */
export class LogDrainCollector {
  private readonly cursors = new Map<string, string | null>();
  private readonly buffers = new Map<string, Buffer>();
  private readonly maxBatchEntries: number;
  private readonly maxBatchAgeMs: number;
  private readonly readLimit: number;
  private readonly now: () => Date;
  private running = false;
  private stopped = false;

  constructor(private readonly options: LogDrainCollectorOptions) {
    this.now = options.now ?? (() => new Date());
    this.maxBatchEntries = bounded(options.maxBatchEntries ?? 100, 1, 1_000);
    this.maxBatchAgeMs = bounded(options.maxBatchAgeMs ?? 60_000, 1_000, 3_600_000);
    this.readLimit = bounded(options.readLimit ?? 200, 1, 1_000);
  }

  /**
   * Liest jede Quelle jedes aktiven Drains einmal und reiht die faelligen
   * Ladungen ein. Gibt die Zahl der eingereihten Ladungen zurueck.
   */
  async poll(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    try {
      const drains = await this.options.drains.activeDrains(this.options.scope);
      const active = new Set<string>();
      for (const drain of drains) {
        for (const source of drain.sources) {
          const key = `${drain.webhookId}:${source}`;
          active.add(key);
          await this.collect(key, source);
        }
      }
      // Ein Drain, der abgeschaltet oder um eine Quelle aermer wurde, laesst
      // seinen Puffer stehen. Er wird verworfen, nicht gesendet: Eine Ladung
      // nach dem Abschalten waere genau das, was das Abschalten verhindern
      // soll.
      for (const key of [...this.buffers.keys()]) {
        if (!active.has(key)) this.buffers.delete(key);
      }
      let enqueued = 0;
      for (const [key, buffer] of [...this.buffers.entries()]) {
        if (buffer.rows.length < this.maxBatchEntries &&
            this.now().getTime() - buffer.openedAt < this.maxBatchAgeMs) continue;
        enqueued += (await this.flushKey(key, drains)) ? 1 : 0;
      }
      return enqueued;
    } finally {
      this.running = false;
    }
  }

  /** Schickt jede offene Ladung hinaus, unabhaengig von Anzahl und Alter. */
  async flush(): Promise<number> {
    const drains = await this.options.drains.activeDrains(this.options.scope);
    let enqueued = 0;
    for (const key of [...this.buffers.keys()]) {
      enqueued += (await this.flushKey(key, drains)) ? 1 : 0;
    }
    return enqueued;
  }

  stop(): void {
    this.stopped = true;
  }

  private async collect(key: string, source: LogDrainSourceId) {
    if (!this.cursors.has(key)) {
      this.cursors.set(key, await this.options.reader.tip(this.options.scope, source));
    }
    const after = this.cursors.get(key) ?? null;
    const rows = await this.options.reader.read(this.options.scope, source, {
      after, limit: this.readLimit,
    });
    if (rows.length === 0) return;
    const buffer = this.buffers.get(key) ?? { rows: [], openedAt: this.now().getTime() };
    for (const row of rows) buffer.rows.push(row.record);
    this.buffers.set(key, buffer);
    // Der Stand wandert erst weiter, wenn die Zeilen im Puffer liegen. Ein
    // Fehler beim Lesen wiederholt denselben Bereich; lieber eine Ladung
    // doppelt als eine verlorene.
    this.cursors.set(key, rows[rows.length - 1].cursor);
  }

  private async flushKey(key: string, drains: readonly LogDrainBinding[]): Promise<boolean> {
    const buffer = this.buffers.get(key);
    if (!buffer || buffer.rows.length === 0) {
      this.buffers.delete(key);
      return false;
    }
    const separator = key.lastIndexOf(":");
    const webhookId = key.slice(0, separator);
    const source = key.slice(separator + 1) as LogDrainSourceId;
    const drain = drains.find((candidate) => candidate.webhookId === webhookId);
    if (!drain || !drain.sources.includes(source)) {
      this.buffers.delete(key);
      return false;
    }
    const batch = buildLogDrainBatch(source, buffer.rows);
    await this.options.outbox.enqueue(this.options.scope, {
      webhookId,
      eventType: logDrainEventType(source),
      payload: asJson(batch, drain.schemaVersion),
      occurredAt: this.now(),
    });
    this.buffers.delete(key);
    return true;
  }
}

/**
 * Die Huelle, wie sie in die Outbox geht.
 *
 * Die Fassung kommt aus der Definition, nicht aus dem Code: Ein Empfaenger, der
 * fuer Fassung 1 angelegt wurde, soll nicht durch ein Deployment eine andere
 * bekommen. Eine unbekannte Fassung in der Zeile faellt auf die Fassung dieses
 * Codes zurueck, statt eine Zahl zu senden, die niemand beschrieben hat.
 */
function asJson(batch: LogDrainBatch, schemaVersion: number): ProjectQueueJson {
  const version = Number.isSafeInteger(schemaVersion) && schemaVersion >= 1
    && schemaVersion <= LOG_DRAIN_SCHEMA_VERSION ? schemaVersion : LOG_DRAIN_SCHEMA_VERSION;
  return { ...batch, schemaVersion: version } as unknown as ProjectQueueJson;
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new LogDrainCollectorError("LOG_DRAIN_COLLECTOR_INVALID_INPUT");
  }
  return value;
}
