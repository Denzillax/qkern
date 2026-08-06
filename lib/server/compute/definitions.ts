import { nextCronOccurrence } from "@/lib/server/compute/cron";
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
  | "COMPUTE_AT_CAPACITY";

export class ComputeDefinitionError extends Error {
  constructor(readonly code: ComputeDefinitionErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "ComputeDefinitionError";
  }
}

export type CronDefinitionInput = {
  name: string;
  expression: string;
  queue: string;
  payload?: ProjectQueueJson;
  enabled?: boolean;
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

export interface ComputeDefinitionRepository {
  listCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope): Promise<CronDefinitionRecord[]>;
  createCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, input: {
    name: string; expression: string; queue: string; payload: ProjectQueueJson; enabled: boolean;
  }): Promise<CronDefinitionRecord>;
  getCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string):
    Promise<CronDefinitionRecord | null>;
  setCronEnabled(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string,
    enabled: boolean): Promise<CronDefinitionRecord | null>;
  deleteCron(principal: ProjectQueuePrincipal, scope: ComputeDefinitionScope, id: string): Promise<boolean>;

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

  constructor(private readonly options: ComputeDefinitionServiceOptions) {
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
    // versteht, darf gar nicht erst entstehen.
    try {
      nextCronOccurrence(input.expression, new Date(0));
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
      enabled: input.enabled ?? true,
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
