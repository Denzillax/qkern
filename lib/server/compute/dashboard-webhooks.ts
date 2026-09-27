import { recognisedByName } from "@/lib/server/errors/identity";
import {
  buildDashboardEventNotice,
  DashboardWebhookError,
  DASHBOARD_WEBHOOK_SCHEMA_VERSION,
  dashboardEventType,
  validateDashboardWebhook,
  type DashboardEventKind,
  type DashboardEventNotice,
  type DashboardWebhookDraft,
  type DashboardWebhookInput,
  type DashboardWebhookRecord,
} from "@/lib/console/dashboard-webhooks";
import {
  ComputeDefinitionError,
  type ComputeDefinitionScope,
} from "@/lib/server/compute/definitions";
import type { WebhookOutbox, WebhookOutboxScope } from "@/lib/server/compute/webhook-outbox";
import type { ProjectQueueJson, ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

/**
 * Die Verwaltungsflaeche der Dashboard-Webhooks (2.75) und das Sammeln selbst.
 *
 * Der Dienst legt **zwei** Zeilen an: die ausgehende Webhook-Definition aus 0032
 * und die Kopplung aus 0057, und zwar in einem Repository-Aufruf, der beides in
 * einer Transaktion schreibt. Eine Definition ohne Kopplung waere ein Webhook,
 * den niemand beliefert und den diese Flaeche nicht mehr findet; eine Kopplung
 * ohne Definition gibt es wegen des Fremdschluessels nicht. Dieselbe Naht wie
 * bei den Datenbank-Webhooks (2.50) und den Log-Drains (2.54).
 *
 * Geloescht wird in diesem Slice nicht. Abschalten geht und ist der richtige
 * erste Schritt: Es haelt die Meldungen an, ohne etwas zu verlieren.
 *
 * `signingSecretRef` ist durchgaengig eine Referenz. Es gibt in diesem Dienst
 * keinen Parameter, kein Feld und keine Rueckgabe fuer einen Geheimniswert.
 */

export interface DashboardWebhookRepository {
  list(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope):
    Promise<DashboardWebhookRecord[]>;
  get(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string):
    Promise<DashboardWebhookRecord | null>;
  /** Legt Definition und Kopplung in einer Transaktion an. */
  create(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    draft: DashboardWebhookDraft): Promise<DashboardWebhookRecord>;
  setEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<DashboardWebhookRecord | null>;
}

/**
 * Wie weit der Sammler gekommen ist, so weit die Ansicht es zeigen darf.
 *
 * `project_dashboard_webhook_cursors` haelt je Webhook und Ereignisart die
 * zuletzt gemeldete Position und wann sie geschrieben wurde. Mehr behauptet
 * diese Naht nicht -- insbesondere nicht, wann zuletzt *nachgesehen* wurde. Der
 * Prozess liest im Sekundentakt und schreibt nur, wenn eine Meldung
 * hinausgegangen ist; "zuletzt nachgesehen" waere eine Zahl, die es nirgends
 * gibt.
 */
export type DashboardWebhookNotification = Readonly<{
  webhookId: string;
  kind: DashboardEventKind;
  position: string;
  notifiedAt: string;
}>;

export interface DashboardWebhookCollectorStateSource {
  lastNotifications(
    principal: { organizationId: string; actorRef: string },
    scope: ComputeDefinitionScope,
  ): Promise<DashboardWebhookNotification[]>;
}

export type DashboardWebhookServiceOptions = {
  repository: DashboardWebhookRepository;
  collector?: DashboardWebhookCollectorStateSource;
  maxPerScope?: number;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DashboardWebhookService {
  private readonly maxPerScope: number;

  constructor(private readonly options: DashboardWebhookServiceOptions) {
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

  /**
   * Wann jeder Webhook zuletzt gemeldet hat und bis zu welcher Position.
   *
   * `null` heisst "diese Installation fuehrt keine dauerhafte Position", eine
   * leere Liste heisst "noch nie gemeldet". Die Ansicht muss beides
   * unterscheiden koennen, ohne zu raten.
   */
  async collectorState(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    this.assertScope(principal, scope);
    if (!this.options.collector) return null;
    return await this.options.collector.lastNotifications(principal, scope);
  }

  async get(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.get(principal, scope, id);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  /**
   * Legt einen Dashboard-Webhook an.
   *
   * Geprueft wird mit **demselben** reinen Modul, das die Ansicht schon vor dem
   * Absenden anwendet. Die Ansicht kann damit den Grund einer Ablehnung zeigen,
   * ohne zu raten, und die Route bleibt trotzdem die Stelle, die entscheidet.
   */
  async create(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    input: DashboardWebhookInput): Promise<DashboardWebhookRecord> {
    this.assertScope(principal, scope);
    let draft: DashboardWebhookDraft;
    try {
      draft = validateDashboardWebhook(input);
    } catch (cause) {
      if (cause instanceof DashboardWebhookError) {
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
   * und wartende bleiben stehen, statt ihre Versuche zu verbrennen. Der Sammler
   * laesst eine abgeschaltete Kopplung ausserdem gar nicht erst sammeln --
   * sonst staute sich waehrend der Pause genau das an, was die Pause verhindern
   * sollte.
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
export type DashboardWebhookBinding = Readonly<{
  webhookId: string;
  kinds: readonly DashboardEventKind[];
  schemaVersion: number;
}>;

export interface DashboardWebhookBindingSource {
  /** Die aktiven Kopplungen dieser Umgebung. Abgeschaltete gehoeren nicht dazu. */
  activeDashboardWebhooks(scope: WebhookOutboxScope): Promise<DashboardWebhookBinding[]>;
}

/**
 * Ein gelesener Audit-Eintrag.
 *
 * `record` ist der Eintrag in der Form, in der die Audit-Ansicht der Console ihn
 * zeigt; welche Felder daraus wirklich hinausgehen, entscheidet die Whitelist in
 * `lib/console/dashboard-webhooks`. Ein Leser, der ein Feld zu viel liest, kann
 * es darum nicht melden.
 *
 * `cursor` ist die Position des Eintrags in der Kette, aufsteigend sortierbar
 * als Text. Sie ist undurchsichtig: Nur der Leser bildet und versteht sie.
 */
export type DashboardEventRow = Readonly<{
  cursor: string;
  record: Readonly<Record<string, unknown>>;
}>;

export interface DashboardEventReader {
  /**
   * Die Position des neuesten vorhandenen Eintrags dieser Art, oder `null`, wenn
   * es keinen gibt. Der Sammler beginnt dort, statt die Vergangenheit
   * nachzuschicken: Ein neu angelegter Webhook soll dem Empfaenger nicht als
   * erste Handlung die gesamte Geschichte des Projekts melden.
   */
  tip(scope: WebhookOutboxScope, kind: DashboardEventKind): Promise<string | null>;
  /** Die naechsten Eintraege nach `after`, aeltester zuerst. */
  read(scope: WebhookOutboxScope, kind: DashboardEventKind, input: {
    after: string | null; limit: number;
  }): Promise<readonly DashboardEventRow[]>;
}

export class DashboardWebhookCollectorError extends Error {
  constructor(
    readonly code:
      | "DASHBOARD_WEBHOOK_COLLECTOR_INVALID_INPUT"
      | "DASHBOARD_WEBHOOK_COLLECTOR_CURSOR_FAILED",
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "DashboardWebhookCollectorError";
  }
}
recognisedByName(DashboardWebhookCollectorError, "DashboardWebhookCollectorError");

/**
 * Die Position eines Webhooks in einer Ereignisart, dauerhaft.
 *
 * `load` gibt `null` zurueck, wenn es noch keine Position gibt -- der Sammler
 * beginnt dann an der Spitze und schreibt sie sofort fest. Scheitert das Lesen,
 * wirft `load`; der Sammler faengt dann **nicht** an, statt sich eine Position
 * auszudenken.
 *
 * `begin` und `advance` sind zwei Methoden und nicht eine, weil sie zwei
 * verschiedene Dinge behaupten: `begin` haelt den Anfangsstand fest, ohne dass
 * je etwas hinausgegangen waere; `advance` haelt die Position einer eingereihten
 * Meldung fest. Waere es eine Methode, zeigte die Console fuer einen frisch
 * angelegten Webhook einen Zeitpunkt, zu dem niemand etwas gemeldet hat.
 */
export interface DashboardWebhookCursorStore {
  load(scope: WebhookOutboxScope, webhookId: string, kind: DashboardEventKind):
    Promise<string | null>;
  begin(scope: WebhookOutboxScope, webhookId: string, kind: DashboardEventKind,
    position: string): Promise<void>;
  advance(scope: WebhookOutboxScope, webhookId: string, kind: DashboardEventKind,
    position: string): Promise<void>;
}

export type DashboardWebhookCollectorOptions = {
  reader: DashboardEventReader;
  bindings: DashboardWebhookBindingSource;
  outbox: Pick<WebhookOutbox, "enqueue">;
  scope: WebhookOutboxScope;
  /**
   * Die dauerhafte Position je Webhook und Ereignisart. Ohne sie lebt der Stand
   * im Prozess, und ein Neustart beginnt an der Gegenwart. Der Dauerprozess
   * reicht sie ausdruecklich ein.
   */
  cursors?: DashboardWebhookCursorStore;
  /** Wie viele Eintraege ein Lauf je Art hoechstens liest. */
  readLimit?: number;
  now?: () => Date;
};

/**
 * Sammelt Projektereignisse und reiht sie in die **vorhandene** Webhook-Outbox.
 *
 * ## Gewaehlter Weg: der vorhandene Zustellweg
 *
 * Es gibt keinen zweiten. Signiert wird mit `HmacWebhookSigner` ueber den Vault,
 * zugestellt von `WebhookDeliveryRuntime`, wiederholt mit dem serverberechneten
 * Backoff der Outbox, aufgegeben ins Dead Letter nach der Versuchsgrenze der
 * Definition.
 *
 * ## Warum je Ereignis eine Meldung und keine Ladung
 *
 * Der Log-Drain-Sammler buendelt, weil eine Umgebung hunderte Protokollzeilen je
 * Minute erzeugt. Ein Projekt erzeugt am Tag eine Handvoll dieser Ereignisse.
 * Eine Ladung mit einem Eintrag waere eine Huelle um nichts, und ein Empfaenger,
 * der eine Freigabe in einen Chatkanal schreibt, muesste sie erst wieder
 * auspacken. Darum gibt es hier keinen Puffer, kein Alter einer Ladung und
 * keinen Rundenbegriff, der einen Puffer ueberdauern muesste.
 *
 * ## Was dieser Sammler nicht verspricht
 *
 * Genau einmal. Die Position wird **nach** dem Einreichen festgehalten: Ein
 * Absturz dazwischen meldet dasselbe Ereignis noch einmal, statt es zu
 * verlieren. Zwei Instanzen mit derselben Scope-Liste duerfen dasselbe tun. Ein
 * Empfaenger erkennt die Wiederholung an `event.id`, der Kennung des
 * Audit-Eintrags, und die Ansicht sagt genau das auch so.
 *
 * Und keine Lueckenlosigkeit als Beweis: Die Hashkette der Audit-Eintraege geht
 * nicht mit hinaus. Wer beweisen muss, dass nichts fehlt, liest das Audit-Log.
 */
export class DashboardWebhookCollector {
  private readonly positions = new Map<string, string | null>();
  private readonly readLimit: number;
  private readonly now: () => Date;
  private running = false;
  private stopped = false;

  constructor(private readonly options: DashboardWebhookCollectorOptions) {
    this.now = options.now ?? (() => new Date());
    this.readLimit = bounded(options.readLimit ?? 100, 1, 1_000);
  }

  /**
   * Liest jede Ereignisart jeder aktiven Kopplung einmal und reiht die
   * gefundenen Meldungen ein. Gibt die Zahl der eingereihten Meldungen zurueck.
   */
  async poll(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    try {
      const bindings = await this.options.bindings.activeDashboardWebhooks(this.options.scope);
      let enqueued = 0;
      for (const binding of bindings) {
        for (const kind of binding.kinds) {
          if (this.stopped) return enqueued;
          enqueued += await this.collect(binding, kind);
        }
      }
      return enqueued;
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    this.stopped = true;
  }

  /**
   * Der Anfangsstand eines Schluessels.
   *
   * Ohne dauerhafte Ablage ist es die Spitze der Kette. Mit ihr gilt die
   * gespeicherte Position -- und gibt es noch keine, wird die Spitze **sofort**
   * festgeschrieben. Ohne dieses sofortige Schreiben spraenge ein Neustart vor
   * der ersten Meldung auf die inzwischen gewachsene Spitze und uebersprunge
   * alles dazwischen.
   */
  private async startPosition(webhookId: string, kind: DashboardEventKind):
  Promise<string | null> {
    const store = this.options.cursors;
    if (!store) return await this.options.reader.tip(this.options.scope, kind);
    let stored: string | null;
    try {
      stored = await store.load(this.options.scope, webhookId, kind);
    } catch (cause) {
      // Kein Ersatzwert. Die Spitze uebersprunge, was seit dem letzten Lauf
      // entstanden ist, und der Anfang wiederholte die ganze Geschichte.
      throw new DashboardWebhookCollectorError(
        "DASHBOARD_WEBHOOK_COLLECTOR_CURSOR_FAILED", { cause });
    }
    if (stored !== null) return stored === "" ? null : stored;
    const tip = await this.options.reader.tip(this.options.scope, kind);
    try {
      // Die leere Zeichenkette heisst "von Anfang an" -- so sieht eine Umgebung
      // ohne einen einzigen Eintrag dieser Art aus.
      await store.begin(this.options.scope, webhookId, kind, tip ?? "");
    } catch (cause) {
      throw new DashboardWebhookCollectorError(
        "DASHBOARD_WEBHOOK_COLLECTOR_CURSOR_FAILED", { cause });
    }
    return tip;
  }

  private async collect(binding: DashboardWebhookBinding, kind: DashboardEventKind):
  Promise<number> {
    const key = `${binding.webhookId}:${kind}`;
    if (!this.positions.has(key)) {
      this.positions.set(key, await this.startPosition(binding.webhookId, kind));
    }
    const after = this.positions.get(key) ?? null;
    const rows = await this.options.reader.read(this.options.scope, kind, {
      after, limit: this.readLimit,
    });
    let enqueued = 0;
    for (const row of rows) {
      if (this.stopped) return enqueued;
      await this.options.outbox.enqueue(this.options.scope, {
        webhookId: binding.webhookId,
        eventType: dashboardEventType(kind),
        payload: asJson(buildDashboardEventNotice(kind, row.record), binding.schemaVersion),
        occurredAt: this.now(),
      });
      enqueued += 1;
      // Erst einreihen, dann die Position festhalten -- dieselbe Reihenfolge wie
      // in der Webhook-Bruecke und beim Log-Drain-Sammler. Ein Absturz zwischen
      // beiden meldet hoechstens ein Ereignis doppelt; er verliert keines.
      // Umgekehrt waere der Verlust still.
      //
      // Festgehalten wird je Ereignis und nicht erst am Ende des Laufs: Bei
      // einem seltenen Ereignis ist das eine Anweisung mehr und dafuer ein
      // Fenster, das genau ein Ereignis gross ist.
      this.positions.set(key, row.cursor);
      if (this.options.cursors) {
        try {
          await this.options.cursors.advance(
            this.options.scope, binding.webhookId, kind, row.cursor);
        } catch (cause) {
          throw new DashboardWebhookCollectorError(
            "DASHBOARD_WEBHOOK_COLLECTOR_CURSOR_FAILED", { cause });
        }
      }
    }
    return enqueued;
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
function asJson(notice: DashboardEventNotice, schemaVersion: number): ProjectQueueJson {
  const version = Number.isSafeInteger(schemaVersion) && schemaVersion >= 1
    && schemaVersion <= DASHBOARD_WEBHOOK_SCHEMA_VERSION
    ? schemaVersion : DASHBOARD_WEBHOOK_SCHEMA_VERSION;
  return { ...notice, schemaVersion: version } as unknown as ProjectQueueJson;
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DashboardWebhookCollectorError("DASHBOARD_WEBHOOK_COLLECTOR_INVALID_INPUT");
  }
  return value;
}
