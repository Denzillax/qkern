import { recognisedByName } from "@/lib/server/errors/identity";
import { CRON_DEFAULT_TIME_ZONE, nextCronOccurrence, validateCronTimeZone } from "@/lib/server/compute/cron";
import {
  buildCronOccurrenceLog,
  cronOccurrenceCandidates,
  CRON_OCCURRENCE_LIMIT,
  CRON_OCCURRENCE_LOOKAHEAD_SECONDS,
  CRON_OCCURRENCE_WINDOW_SECONDS,
  type CronOccurrenceLog,
  type CronOccurrenceMessageRow,
} from "@/lib/server/compute/cron-occurrences";
import { validateFunctionDefinition } from "@/lib/server/compute/functions";
import { isDeliverableWebhookTarget } from "@/lib/server/compute/webhooks";
import type { ProjectQueueJson, ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { Environment } from "@/lib/types";

export type ComputeDefinitionScope = {
  organizationId: string;
  projectId: string;
  environment: Environment;
};

export type CronDefinitionRecord = ComputeDefinitionScope & Readonly<{
  id: string;
  name: string;
  expression: string;
  queue: string;
  payload: ProjectQueueJson;
  enabled: boolean;
  /** IANA-Zeitzone, in der der Ausdruck gelesen wird; `UTC` fuer jeden Plan von vor 2.66. */
  timeZone: string;
  lastDispatchedAt: string | null;
  createdAt: string;
}>;

export type WebhookDefinitionRecord = ComputeDefinitionScope & Readonly<{
  id: string;
  name: string;
  url: string;
  eventTypes: readonly string[];
  signingSecretRef: string;
  timeoutMs: number;
  maxAttempts: number;
  enabled: boolean;
  createdAt: string;
}>;

export type FunctionDefinitionRecord = ComputeDefinitionScope & Readonly<{
  id: string;
  name: string;
  runtime: "nodejs24";
  image: string;
  entrypoint: string;
  timeoutMs: number;
  memoryMiB: number;
  maxConcurrency: number;
  egressOrigins: readonly string[];
  secretRefs: readonly string[];
  enabled: boolean;
  createdAt: string;
}>;

/** Zustellstatus ohne Nutzlast — sie gehört dem Projekt, nicht der Übersicht. */
export type WebhookDeliveryRecord = Readonly<{
  id: string;
  webhookId: string;
  eventType: string;
  status: "pending" | "in_flight" | "delivered" | "dead_lettered";
  attemptCount: number;
  lastFailureCode: string | null;
  occurredAt: string;
  availableAt: string;
  settledAt: string | null;
}>;

export type ComputeDefinitionErrorCode =
  | "COMPUTE_INVALID_INPUT"
  | "COMPUTE_NOT_FOUND"
  | "COMPUTE_CONFLICT"
  | "COMPUTE_PRECONDITION_FAILED"
  | "COMPUTE_AT_CAPACITY"
  /** Das monatliche Kontingent ist erschöpft — nicht die Nebenläufigkeit. */
  | "COMPUTE_QUOTA_EXCEEDED";

export class ComputeDefinitionError extends Error {
  constructor(readonly code: ComputeDefinitionErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "ComputeDefinitionError";
  }
}
recognisedByName(ComputeDefinitionError, "ComputeDefinitionError");

export type CronDefinitionInput = {
  name: string;
  expression: string;
  queue: string;
  payload?: ProjectQueueJson;
  enabled?: boolean;
  /** IANA-Zeitzone (`Europe/Berlin`). Ohne Angabe UTC. */
  timeZone?: string;
};

export type WebhookDefinitionInput = {
  name: string;
  url: string;
  eventTypes: readonly string[];
  signingSecretRef: string;
  timeoutMs?: number;
  maxAttempts?: number;
  enabled?: boolean;
};

export type FunctionDefinitionInput = {
  name: string;
  image: string;
  entrypoint: string;
  timeoutMs?: number;
  memoryMiB?: number;
  maxConcurrency?: number;
  egressOrigins?: readonly string[];
  secretRefs?: readonly string[];
  enabled?: boolean;
};

export type FunctionDeploymentRecord = {
  revision: number;
  image: string;
  deployedBy: string;
  deployedAt: string;
};

/** Ein protokollierter Aufruf — Zeit, Dauer, Ausgang; nie stdout oder stderr. */
export type FunctionInvocationRecord = Readonly<{
  invocationId: string;
  invokedBy: string;
  startedAt: string;
  durationMs: number;
  outcome: "completed" | "failed";
  statusCode: number | null;
  errorCode: string | null;
}>;

/**
 * Eine Zeile des Aufrufprotokolls mit der Function, zu der sie gehoert.
 *
 * Der Name steht dabei, weil das Protokoll ueber alle Functions einer
 * Umgebung laeuft; eine Id allein waere in einer Tabelle nicht lesbar.
 * Mehr als die Zeile aus Migration 0045 traegt sie nicht: keine Nutzlast,
 * keine Ausgabe des Containers, kein Geheimnis.
 */
export type FunctionInvocationLogRow = FunctionInvocationRecord & Readonly<{
  functionId: string;
  functionName: string;
}>;

/** Filter und Seitenschnitt des Aufrufprotokolls. `null` heisst: kein Filter. */
export type FunctionInvocationLogQuery = Readonly<{
  functionId: string | null;
  outcome: "completed" | "failed" | null;
  limit: number;
  offset: number;
}>;

/**
 * Eine Seite des Aufrufprotokolls.
 *
 * `counts` zaehlt die Ausgaenge **ohne** den Ausgangsfilter, aber mit dem
 * Function-Filter: Sonst zeigte die Ansicht neben dem Filter "fehlgeschlagen"
 * nur die fehlgeschlagenen und koennte nie sagen, wie viele es insgesamt
 * sind. `hasMore` kommt aus einer Zeile mehr, nicht aus einem Gesamtzaehler.
 */
export type FunctionInvocationLogPage = Readonly<{
  rows: readonly FunctionInvocationLogRow[];
  limit: number;
  offset: number;
  hasMore: boolean;
  counts: Readonly<{ completed: number; failed: number }>;
}>;

export const FUNCTION_INVOCATION_LOG_LIMITS = Object.freeze({
  maxLimit: 200,
  defaultLimit: 50,
  /** Tiefer blaettern geht nicht; ein OFFSET ohne Grenze ist ein Tischscan. */
  maxOffset: 10_000,
});

export interface ComputeDefinitionRepository {
  listCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope): Promise<CronDefinitionRecord[]>;
  createCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, input: {
    name: string; expression: string; queue: string; payload: ProjectQueueJson; enabled: boolean;
    timeZone: string;
  }): Promise<CronDefinitionRecord>;
  getCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string):
    Promise<CronDefinitionRecord | null>;
  setCronEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<CronDefinitionRecord | null>;
  deleteCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string): Promise<boolean>;
  /**
   * Nachrichten der Zielqueue zu bekannten Dedupe-Verifikatoren, plus das
   * Dedupe-Fenster dieser Queue (`null`, wenn es die Queue nicht gibt).
   *
   * Bewusst so schmal: Der Aufrufer kennt die Verifikatoren schon, weil er sie
   * aus den erwarteten Vorkommen gebildet hat. Die Queue muss dafuer nichts
   * durchsuchen, was ihm nicht gehoert, und keine Nutzlast herausgeben.
   */
  listCronOccurrenceMessages(
    principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, queue: string,
    dedupeKeyHashes: readonly string[],
  ): Promise<{ dedupeWindowSeconds: number | null; messages: CronOccurrenceMessageRow[] }>;

  listWebhooks(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope):
    Promise<WebhookDefinitionRecord[]>;
  createWebhook(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, input: {
    name: string; url: string; eventTypes: readonly string[]; signingSecretRef: string;
    timeoutMs: number; maxAttempts: number; enabled: boolean;
  }): Promise<WebhookDefinitionRecord>;
  getWebhook(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string):
    Promise<WebhookDefinitionRecord | null>;
  setWebhookEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<WebhookDefinitionRecord | null>;
  deleteWebhook(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string): Promise<boolean>;
  listDeliveries(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, webhookId: string,
    limit: number): Promise<WebhookDeliveryRecord[]>;

  /**
   * Wechselt das Image einer Function ueber die eine Tuer aus Migration 0042
   * und liefert die neue Revision. Eine Image-Aenderung ohne Historienzeile
   * ist auf Datenbankebene nicht ausdrueckbar.
   */
  deployFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, image: string): Promise<number>;
  listFunctionDeployments(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string): Promise<FunctionDeploymentRecord[]>;
  recordFunctionInvocation(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    functionId: string, entry: FunctionInvocationRecord): Promise<void>;
  listFunctionInvocations(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    functionId: string, limit: number): Promise<FunctionInvocationRecord[]>;
  /** Das Aufrufprotokoll ueber alle Functions einer Umgebung (2.51). */
  listInvocationLog(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    query: FunctionInvocationLogQuery): Promise<FunctionInvocationLogPage>;
  listFunctions(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope):
    Promise<FunctionDefinitionRecord[]>;
  createFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, input: {
    name: string; image: string; entrypoint: string; timeoutMs: number; memoryMiB: number;
    maxConcurrency: number; egressOrigins: readonly string[]; secretRefs: readonly string[];
    enabled: boolean;
  }): Promise<FunctionDefinitionRecord>;
  getFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string):
    Promise<FunctionDefinitionRecord | null>;
  /** Aktive Definition zu einem Namen — der Weg, den ein Aufruf nimmt. */
  findFunctionByName(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, name: string):
    Promise<FunctionDefinitionRecord | null>;
  setFunctionEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<FunctionDefinitionRecord | null>;
  deleteFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string):
    Promise<boolean>;
}

export interface ComputeQueueDirectory {
  /** Namen der Queues eines Projekts. */
  queueNames(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope): Promise<string[]>;
}

export type ComputeDefinitionServiceOptions = {
  repository: ComputeDefinitionRepository;
  /**
   * Optional. Ist er vorhanden, muss die Zielqueue eines Cron-Jobs beim Anlegen
   * existieren. Ohne diese Prüfung entsteht ein Zeitplan, der bei jedem
   * Vorkommen scheitert und dabei aussieht, als liefe er.
   */
  queues?: ComputeQueueDirectory;
  maxCronPerScope?: number;
  maxWebhooksPerScope?: number;
  maxFunctionsPerScope?: number;
  maxPayloadBytes?: number;
  /** Nur fuer Tests einsetzbar; im Betrieb die Systemuhr. */
  now?: () => Date;
};

const NAME = /^[a-z][a-z0-9_-]{2,62}$/;
const EVENT_TYPE = /^[a-z][a-z0-9._-]{0,63}$/;
const SECRET_REF = /^[A-Za-z][A-Za-z0-9_./:-]{2,127}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verwaltet Cron- und Webhook-Definitionen.
 *
 * Bis Release 1.20 entstanden beide ausschliesslich über direkten
 * Datenbankzugriff. Der Betrieb lief, aber niemand konnte ihm ohne `psql`
 * sagen, was er tun soll.
 *
 * **Nur `enabled` ist änderbar.** Migration 0031 hat diese Entscheidung bereits
 * getroffen und begründet: Ausdruck, Queue und Nutzlast eines Cron-Jobs bleiben
 * unveränderlich, eine Änderung erfolgt über Löschen und Neuanlegen. Dieselbe
 * Regel gilt hier für Webhooks. Der Preis ist eine neue Id; der Gewinn ist, dass
 * ein Zustellversuch niemals gegen eine Definition läuft, die sich zwischen
 * Auslösen und Senden verändert hat.
 */
export class ComputeDefinitionService {
  private readonly maxCron: number;
  private readonly maxWebhooks: number;
  private readonly maxFunctions: number;
  private readonly maxPayloadBytes: number;
  private readonly now: () => Date;

  constructor(private readonly options: ComputeDefinitionServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.maxCron = bounded(options.maxCronPerScope ?? 50, 1, 500);
    this.maxWebhooks = bounded(options.maxWebhooksPerScope ?? 50, 1, 500);
    this.maxFunctions = bounded(options.maxFunctionsPerScope ?? 50, 1, 500);
    this.maxPayloadBytes = bounded(options.maxPayloadBytes ?? 64 * 1024, 256, 64 * 1024);
  }

  async listCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    this.assertScope(principal, scope);
    return await this.options.repository.listCron(principal, scope);
  }

  async createCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    input: CronDefinitionInput): Promise<CronDefinitionRecord> {
    this.assertScope(principal, scope);
    if (!NAME.test(input.name) || !NAME.test(input.queue)) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    // Derselbe Parser, den der Scheduler benutzt. Ein Ausdruck, den er nicht
    // versteht, darf gar nicht erst entstehen; dasselbe gilt fuer die Zeitzone.
    let timeZone: string;
    try {
      timeZone = validateCronTimeZone(input.timeZone ?? CRON_DEFAULT_TIME_ZONE);
      nextCronOccurrence(input.expression, new Date(0), timeZone);
    } catch (cause) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT", { cause });
    }
    const payload = this.boundedPayload(input.payload ?? {});

    if (this.options.queues) {
      const names = await this.options.queues.queueNames(principal, scope);
      if (!names.includes(input.queue)) throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    const existing = await this.options.repository.listCron(principal, scope);
    if (existing.length >= this.maxCron) throw new ComputeDefinitionError("COMPUTE_CONFLICT");

    return await this.options.repository.createCron(principal, scope, {
      name: input.name, expression: input.expression.trim(), queue: input.queue, payload,
      enabled: input.enabled ?? true, timeZone,
    });
  }

  async getCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.getCron(principal, scope, id);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  async setCronEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, enabled: boolean) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.setCronEnabled(principal, scope, id, enabled);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  async deleteCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    this.assertScope(principal, scope);
    this.assertId(id);
    if (!await this.options.repository.deleteCron(principal, scope, id)) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
  }

  /**
   * Das Cron-Log einer Definition (2.42): erwartete Vorkommen und ihr Ausgang.
   *
   * Nur lesend, und ohne Nutzlast, Dedupe-Schluessel oder Nachrichten-Id: Die
   * Nutzlast eines Cron-Jobs kann Kundendaten tragen, und die Betriebsfrage
   * ("laeuft es?") braucht sie nicht. Das Fenster ist gebunden: die letzten 24
   * Stunden plus die naechste Stunde, hoechstens 50 Vorkommen, neueste zuerst.
   */
  async listCronOccurrences(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string): Promise<CronOccurrenceLog> {
    this.assertScope(principal, scope);
    this.assertId(id);
    const definition = await this.options.repository.getCron(principal, scope, id);
    if (!definition) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");

    const now = this.now();
    const from = new Date(now.getTime() - CRON_OCCURRENCE_WINDOW_SECONDS * 1_000);
    const to = new Date(now.getTime() + CRON_OCCURRENCE_LOOKAHEAD_SECONDS * 1_000);
    let candidates;
    try {
      candidates = cronOccurrenceCandidates(definition, { from, to, limit: CRON_OCCURRENCE_LIMIT });
    } catch (cause) {
      // Der Definitionsdienst laesst keinen unlesbaren Ausdruck entstehen, ein
      // direkter INSERT schon (der CHECK in 0031 prueft nur die Laenge). Dann
      // gibt es keine erwarteten Vorkommen, und das ist eine Aussage ueber die
      // Definition, nicht ueber die Anfrage.
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT", { cause });
    }
    const found = await this.options.repository.listCronOccurrenceMessages(
      principal, scope, definition.queue, candidates.map((candidate) => candidate.dedupeKeyHash),
    );
    return buildCronOccurrenceLog({
      definition: { ...definition, createdAt: new Date(definition.createdAt) },
      candidates,
      messages: found.messages,
      now, from, to, limit: CRON_OCCURRENCE_LIMIT,
      dedupeWindowSeconds: found.dedupeWindowSeconds,
    });
  }

  async listWebhooks(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    this.assertScope(principal, scope);
    return await this.options.repository.listWebhooks(principal, scope);
  }

  async createWebhook(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    input: WebhookDefinitionInput): Promise<WebhookDefinitionRecord> {
    this.assertScope(principal, scope);
    const eventTypes = [...new Set(input.eventTypes ?? [])];
    if (!NAME.test(input.name) ||
        // Exakt die Regel des Zustellers. Fielen beide auseinander, entstuende
        // ein Webhook, den der Betrieb bei jedem Versuch stumm abweist.
        !isDeliverableWebhookTarget(input.url) ||
        !SECRET_REF.test(input.signingSecretRef) ||
        eventTypes.length < 1 || eventTypes.length > 20 ||
        !eventTypes.every((type) => EVENT_TYPE.test(type))) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    const timeoutMs = bounded(input.timeoutMs ?? 5_000, 250, 30_000);
    const maxAttempts = bounded(input.maxAttempts ?? 5, 1, 20);

    const existing = await this.options.repository.listWebhooks(principal, scope);
    if (existing.length >= this.maxWebhooks) throw new ComputeDefinitionError("COMPUTE_CONFLICT");

    return await this.options.repository.createWebhook(principal, scope, {
      name: input.name, url: input.url, eventTypes, signingSecretRef: input.signingSecretRef,
      timeoutMs, maxAttempts, enabled: input.enabled ?? true,
    });
  }

  async getWebhook(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.getWebhook(principal, scope, id);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  async setWebhookEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, enabled: boolean) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.setWebhookEnabled(principal, scope, id, enabled);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  /**
   * Löscht einen Webhook — aber nur, wenn er vorher abgeschaltet wurde.
   *
   * Das Löschen entfernt über den Fremdschlüssel auch alle wartenden
   * Zustellungen. Ein Betreiber, der eine Definition versehentlich löscht,
   * verlöre sie stillschweigend. Der Umweg über das Abschalten macht daraus
   * zwei bewusste Schritte und gibt ihm dazwischen einen Zustand, in dem nichts
   * Neues geholt wird und er die offenen Zustellungen noch sehen kann.
   */
  async deleteWebhook(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.getWebhook(principal, scope, id);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    if (record.enabled) throw new ComputeDefinitionError("COMPUTE_PRECONDITION_FAILED");
    if (!await this.options.repository.deleteWebhook(principal, scope, id)) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
  }

  async listDeliveries(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    webhookId: string, limit = 50) {
    this.assertScope(principal, scope);
    this.assertId(webhookId);
    const bound = bounded(limit, 1, 200);
    if (!await this.options.repository.getWebhook(principal, scope, webhookId)) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
    return await this.options.repository.listDeliveries(principal, scope, webhookId, bound);
  }

  async listFunctions(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    this.assertScope(principal, scope);
    return await this.options.repository.listFunctions(principal, scope);
  }

  /**
   * Legt eine Function an.
   *
   * Die Form prüft `validateFunctionDefinition` — derselbe Validator, den der
   * Aufruf anwendet. Eine Definition, die der Betrieb später abweisen würde,
   * darf gar nicht erst entstehen; dieselbe Regel gilt seit Release 1.21 schon
   * für Cron-Ausdrücke und Webhook-Ziele.
   */
  async createFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    input: FunctionDefinitionInput): Promise<FunctionDefinitionRecord> {
    this.assertScope(principal, scope);
    const candidate = {
      ...scope,
      id: "00000000-0000-4000-8000-000000000000",
      name: input.name,
      runtime: "nodejs24" as const,
      image: input.image,
      entrypoint: input.entrypoint,
      timeoutMs: input.timeoutMs ?? 30_000,
      memoryMiB: input.memoryMiB ?? 128,
      maxConcurrency: input.maxConcurrency ?? 1,
      egressOrigins: [...new Set(input.egressOrigins ?? [])],
      secretRefs: [...new Set(input.secretRefs ?? [])],
    };
    try {
      validateFunctionDefinition(candidate);
    } catch (cause) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT", { cause });
    }

    const existing = await this.options.repository.listFunctions(principal, scope);
    if (existing.length >= this.maxFunctions) throw new ComputeDefinitionError("COMPUTE_CONFLICT");

    return await this.options.repository.createFunction(principal, scope, {
      name: candidate.name,
      image: candidate.image,
      entrypoint: candidate.entrypoint,
      timeoutMs: candidate.timeoutMs,
      memoryMiB: candidate.memoryMiB,
      maxConcurrency: candidate.maxConcurrency,
      egressOrigins: candidate.egressOrigins,
      secretRefs: candidate.secretRefs,
      enabled: input.enabled ?? true,
    });
  }

  /**
   * Rollt ein neues Image aus — Sprosse 6 der Paritaetsleiter.
   *
   * Alles andere an der Definition bleibt unveraenderlich, und genau deshalb
   * ist ein Deployment kein Loeschen-und-Neuanlegen: Der Name, die Grenzen
   * und die Bindungen der Function bleiben stehen, nur das Image wandert —
   * mit erzwungener Historie. Rollback ist ein Deployment auf den alten
   * Digest, keine Sonderoperation.
   */
  async deployFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, input: { image: string }): Promise<{ revision: number; image: string }> {
    this.assertScope(principal, scope);
    this.assertId(id);
    if (typeof input.image !== "string" ||
        !/^[a-z0-9][a-z0-9./_-]{2,255}@sha256:[0-9a-f]{64}$/.test(input.image)) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    const existing = await this.options.repository.getFunction(principal, scope, id);
    if (!existing) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    const revision = await this.options.repository.deployFunction(principal, scope, id, input.image);
    return { revision, image: input.image };
  }

  async listFunctionDeployments(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string): Promise<FunctionDeploymentRecord[]> {
    this.assertScope(principal, scope);
    this.assertId(id);
    const existing = await this.options.repository.getFunction(principal, scope, id);
    if (!existing) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return await this.options.repository.listFunctionDeployments(principal, scope, id);
  }

  /**
   * Das Aufrufprotokoll — die Produktflaeche der Function-Logs (1.89). Nur
   * Admins; neueste zuerst; hoechstens 200 auf einmal.
   */
  async listFunctionInvocations(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, limit = 50): Promise<FunctionInvocationRecord[]> {
    this.assertScope(principal, scope);
    this.assertId(id);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    const existing = await this.options.repository.getFunction(principal, scope, id);
    if (!existing) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return await this.options.repository.listFunctionInvocations(principal, scope, id, limit);
  }

  /**
   * Das Aufrufprotokoll einer ganzen Umgebung (2.51) — die Lesefläche der
   * Seite Logs → Functions.
   *
   * Nur Admins, neueste zuerst, mit Seitenschnitt und zwei Filtern. Ein
   * unbekannter Ausgang, eine unbrauchbare Function-Id, ein Limit ausserhalb
   * der Grenze oder ein zu tiefer Versatz sind eine ungueltige Eingabe und
   * kommen nie bis zur Datenbank.
   *
   * Anders als `listFunctionInvocations` wird hier **nicht** geprueft, ob es
   * die gefilterte Function gibt: Das Protokoll einer geloeschten Function
   * ist ohnehin mitgeloescht (0045 kaskadiert), und ein 404 statt einer
   * leeren Seite waere fuer eine Filterauswahl die falsche Antwort.
   */
  async readFunctionInvocationLog(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    input: {
      functionId?: string | null; outcome?: string | null;
      limit?: number; offset?: number;
    } = {}): Promise<FunctionInvocationLogPage> {
    this.assertScope(principal, scope);
    const limit = input.limit ?? FUNCTION_INVOCATION_LOG_LIMITS.defaultLimit;
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > FUNCTION_INVOCATION_LOG_LIMITS.maxLimit ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > FUNCTION_INVOCATION_LOG_LIMITS.maxOffset) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    const outcome = input.outcome ?? null;
    if (outcome !== null && outcome !== "completed" && outcome !== "failed") {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    const functionId = input.functionId ?? null;
    if (functionId !== null && !ID.test(functionId)) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    return await this.options.repository.listInvocationLog(principal, scope, Object.freeze({
      functionId, outcome, limit, offset,
    }));
  }

  async getFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.getFunction(principal, scope, id);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  async setFunctionEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope,
    id: string, enabled: boolean) {
    this.assertScope(principal, scope);
    this.assertId(id);
    const record = await this.options.repository.setFunctionEnabled(principal, scope, id, enabled);
    if (!record) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    return record;
  }

  async deleteFunction(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string) {
    this.assertScope(principal, scope);
    this.assertId(id);
    if (!await this.options.repository.deleteFunction(principal, scope, id)) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
  }

  /**
   * Nur Administratoren, und nur in der eigenen Organisation.
   *
   * Die Organisation kommt aus der Session, nie aus dem Pfad. Diese Prüfung ist
   * die zweite Verteidigungslinie hinter RLS, nicht die erste.
   */
  private assertScope(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope) {
    if (principal.role !== "admin" || principal.organizationId !== scope.organizationId) {
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }
  }

  private assertId(id: string) {
    if (!ID.test(id)) throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
  }

  private boundedPayload(payload: ProjectQueueJson): ProjectQueueJson {
    let encoded: string;
    try {
      encoded = JSON.stringify(payload);
    } catch (cause) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT", { cause });
    }
    if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > this.maxPayloadBytes) {
      throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
    }
    return payload;
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ComputeDefinitionError("COMPUTE_INVALID_INPUT");
  }
  return value;
}
