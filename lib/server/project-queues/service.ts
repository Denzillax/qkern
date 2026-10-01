import { recognisedByName } from "@/lib/server/errors/identity";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ConnectionUnavailableError } from "@/lib/server/db/errors";
import type { ControlPlaneService } from "@/lib/server/control-plane/model";
import type {
  ProjectQueue,
  ProjectQueueEnqueuePolicy,
  ProjectQueueFailureCode,
  ProjectQueueJson,
  ProjectQueueMessage,
  ProjectQueuePrincipal,
  ProjectQueueScope,
} from "@/lib/server/project-queues/model";
import { publicProjectQueue, sameProjectQueueScope } from "@/lib/server/project-queues/model";
import {
  ProjectQueueConflictError,
  type ProjectQueueMeter,
  type ProjectQueueRepository,
} from "@/lib/server/project-queues/repository";
import { DisabledUsageEmitter, type UsageEmitterPort } from "@/lib/server/usage/emitter";
import { parseProjectQueueTraceparent } from "@/lib/server/project-queues/trace";

const QUEUE_NAME = /^[a-z][a-z0-9_-]{2,62}$/;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEASE_TOKEN = /^qk_lease_[A-Za-z0-9_-]{43}$/;
const FAILURE_CODES = new Set<ProjectQueueFailureCode>([
  "HANDLER_ERROR", "HANDLER_TIMEOUT", "DEPENDENCY_UNAVAILABLE", "INVALID_PAYLOAD", "LEASE_EXPIRED",
]);

export type ProjectQueueErrorCode =
  | "PROJECT_QUEUES_DISABLED"
  | "QUEUE_INVALID_INPUT"
  | "QUEUE_RESOURCE_NOT_FOUND"
  | "QUEUE_ACCESS_DENIED"
  | "QUEUE_CONFLICT"
  | "QUEUE_CAPACITY_EXCEEDED"
  /** Das monatliche Kontingent ist erschöpft — nicht die Warteschlange. */
  | "QUEUE_QUOTA_EXCEEDED"
  | "QUEUE_LEASE_LOST"
  /**
   * Der Prozess hatte keine freie Datenbankverbindung.
   *
   * Nicht dasselbe wie `QUEUE_CONFLICT`: Die Warteschlange ist in Ordnung, die
   * Abfrage ist nie gelaufen. Bis Release 1.64 kam an dieser Stelle eine 409,
   * die dem Aufrufer sagte, jemand anderes sei schneller gewesen.
   */
  | "QUEUE_UNAVAILABLE";

export class ProjectQueueError extends Error {
  /**
   * `cause` stays internal. The HTTP and MCP layers serialise `code` only, and
   * the route contract tests assert that no cause ever reaches a client.
   * Without it an unexpected repository failure is indistinguishable from a
   * genuine conflict, which made the first real PostgreSQL run undiagnosable.
   */
  constructor(readonly code: ProjectQueueErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "ProjectQueueError";
  }
}
recognisedByName(ProjectQueueError, "ProjectQueueError");

/** Erkennt einen Queue-Fehler an Name und Code statt an der Klasse (2.24, siehe `isProjectDataPlaneError`). */
export function isProjectQueueError(error: unknown, code?: ProjectQueueErrorCode): error is ProjectQueueError {
  if (!(error instanceof Error) || error.name !== "ProjectQueueError") return false;
  const candidate = error as Error & { code?: unknown };
  if (typeof candidate.code !== "string") return false;
  return code === undefined || candidate.code === code;
}

export class ProjectQueueService {
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly leaseToken: () => string;
  private readonly maxPayloadBytes: number;
  private readonly usage: UsageEmitterPort;

  constructor(private readonly dependencies: {
    repository: ProjectQueueRepository;
    controlPlane?: Pick<ControlPlaneService, "getProjectEnvironment">;
    /** Ohne Emitter zählt nichts — und nichts ändert sich am Verhalten. */
    usage?: UsageEmitterPort;
    now?: () => Date;
    id?: () => string;
    leaseToken?: () => string;
    maxPayloadBytes?: number;
  }) {
    this.usage = dependencies.usage ?? new DisabledUsageEmitter();
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? (() => randomUUID());
    this.leaseToken = dependencies.leaseToken ?? (() => `qk_lease_${randomBytes(32).toString("base64url")}`);
    this.maxPayloadBytes = integer(dependencies.maxPayloadBytes ?? 64 * 1024, 256, 256 * 1024);
  }

  async createQueue(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, input: {
    name: string;
    enqueuePolicy?: ProjectQueueEnqueuePolicy;
    maxAttempts?: number;
    visibilityTimeoutSeconds?: number;
    retryBaseSeconds?: number;
    retryMaxSeconds?: number;
    dedupeWindowSeconds?: number;
    retentionSeconds?: number;
    maxPendingMessages?: number;
  }) {
    await this.assertAdmin(principal, scope);
    const now = this.now();
    const retryBaseSeconds = integer(input.retryBaseSeconds ?? 5, 1, 300);
    const retryMaxSeconds = integer(input.retryMaxSeconds ?? 300, retryBaseSeconds, 3600);
    const name = input.name.trim();
    if (!QUEUE_NAME.test(name)) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
    const queue: ProjectQueue = {
      ...scope,
      id: this.id(),
      name,
      enqueuePolicy: policy(input.enqueuePolicy ?? "authenticated"),
      maxAttempts: integer(input.maxAttempts ?? 5, 1, 20),
      visibilityTimeoutSeconds: integer(input.visibilityTimeoutSeconds ?? 30, 5, 900),
      retryBaseSeconds,
      retryMaxSeconds,
      dedupeWindowSeconds: integer(input.dedupeWindowSeconds ?? 300, 0, 86_400),
      retentionSeconds: integer(input.retentionSeconds ?? 86_400, 60, 604_800),
      maxPendingMessages: integer(input.maxPendingMessages ?? 1_000, 1, 10_000),
      createdAt: now,
      updatedAt: now,
    };
    try { return publicProjectQueue(await this.dependencies.repository.createQueue(principal, queue)); }
    catch (error) { throw mapError(error); }
  }

  async listQueues(principal: ProjectQueuePrincipal, scope: ProjectQueueScope) {
    await this.assertAdmin(principal, scope);
    try { return (await this.dependencies.repository.listQueues(principal, scope)).map(publicProjectQueue); }
    catch (error) { throw mapError(error); }
  }

  async enqueue(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, queueName: string, input: {
    payload: unknown;
    dedupeKey?: string;
    scheduledAt?: string;
    /**
     * Der `traceparent` des Aufrufers, falls er einen geschickt hat (2.121).
     *
     * Er wird gelesen und nicht geprueft: Passt er nicht zur Form, wird er
     * weggelassen, und das Einreihen laeuft weiter. Ein Beobachtungskopf ist
     * kein Teil des Auftrags, und eine 400 darauf hiesse, eine Nachricht an
     * einem Kopf scheitern zu lassen, den niemand braucht. Die Begruendung
     * steht in `trace.ts`.
     */
    traceparent?: string | null;
  }) {
    assertPrincipal(principal, scope);
    const queue = await this.queue(principal, scope, queueName);
    if (!canEnqueue(queue, principal)) throw new ProjectQueueError("QUEUE_ACCESS_DENIED");
    const now = this.now();
    const payload = safeJson(input.payload, this.maxPayloadBytes);
    const dedupeKey = input.dedupeKey?.trim();
    if (dedupeKey !== undefined && (!dedupeKey || dedupeKey.length > 128)) {
      throw new ProjectQueueError("QUEUE_INVALID_INPUT");
    }
    const availableAt = scheduledAt(input.scheduledAt, now);
    /**
     * Ein Dedupe-Fenster von null Sekunden heisst: keine Deduplizierung.
     *
     * Bis 2.43 wanderte der Verifikator trotzdem in die Zeile, waehrend der
     * Port die Frist wegliess, das Fenster war ja null. Der CHECK
     * `project_queue_messages_dedupe_pair` aus 0026 verlangt aber beides oder
     * keines, und so scheiterte **jedes** Einreihen mit Dedupe-Key in so einer
     * Queue. Der Aufrufer sah `QUEUE_CONFLICT`, also eine Aussage ueber einen
     * Wettlauf, den es nie gab; ein Cron-Job auf so einer Queue fiel bei jedem
     * Vorkommen aus und sah dabei aus, als liefe er.
     *
     * Zwei Lesarten standen zur Wahl. Null beim Anlegen abweisen waere
     * ehrlicher gegenueber dem Aufrufer, der einen Dedupe-Key schickt. Aber
     * null ist eine zugesagte Konfiguration (CHECK 0..86400 in 0026, Minimum 0
     * in OpenAPI und Route), Queue-Definitionen sind unveraenderlich, und
     * bestehende Queues mit null waeren damit dauerhaft unbrauchbar statt
     * repariert. Also die andere: Null schaltet die Deduplizierung ab, der
     * Dedupe-Key wird ignoriert, und es wird weder Verifikator noch Frist
     * abgelegt. Ein Verifikator ohne Frist waere ohnehin Gift: Der Sperrindex
     * aus 0026 haelt ihn fuer immer besetzt, das Aufraeumen loescht nur
     * abgelaufene Fristen, und der Loeschwaechter laesst die Zeile nie gehen.
     *
     * Der Preis steht im Handbuch und in den Compute-Vertraegen: Wer die
     * Zusage "Crash/Retry erzeugt keine zweite Nachricht" braucht, und jeder
     * Cron-Job braucht sie, muss ein Fenster groesser null waehlen.
     */
    const dedupeKeyHash = dedupeKey && queue.dedupeWindowSeconds > 0 ? hash(dedupeKey) : null;
    const message: ProjectQueueMessage = {
      ...scope,
      id: this.id(),
      queueId: queue.id,
      payload,
      status: "available",
      ownerSubject: principal.subject,
      dedupeKeyHash,
      attemptCount: 0,
      availableAt,
      leaseWorkerId: null,
      leaseTokenHash: null,
      leaseSequence: 0,
      leaseExpiresAt: null,
      lastFailureCode: null,
      createdAt: now,
      completedAt: null,
      deadLetteredAt: null,
      replayedFromMessageId: null,
    };
    // Gemessen wird **in** der Transaktion des Enqueues, nicht davor.
    //
    // Bis Release 1.29 lief die Messung vorher und in einer eigenen
    // Transaktion. Das war korrekt genug, um ein hartes Limit durchzusetzen,
    // aber zwischen beiden lag ein Fenster: Ein Absturz nach der Zählung und
    // vor dem Schreiben zählte eine Nachricht, die es nie gab. Jetzt gilt
    // beides zusammen oder keines von beidem.
    const meter: ProjectQueueMeter = async (transaction) => {
      const admission = await this.usage.admit(scope, {
        metric: "queue_operations", reference: message.id, observedAt: now,
      }, transaction);
      if (!admission.admitted) throw new ProjectQueueError("QUEUE_QUOTA_EXCEEDED");
    };

    try {
      const result = await this.dependencies.repository.enqueue(
        principal, scope, queue, message, now, meter,
        parseProjectQueueTraceparent(input.traceparent),
      );
      return {
        id: result.message.id,
        queue: queue.name,
        status: result.message.status,
        availableAt: result.message.availableAt.toISOString(),
        deduplicated: result.deduplicated,
      };
    } catch (error) { throw mapError(error); }
  }

  async claim(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, queueName: string, input: {
    workerId: string;
    limit?: number;
  }) {
    this.assertWorker(principal, scope);
    const queue = await this.queue(principal, scope, queueName);
    const workerId = input.workerId.trim();
    const limit = integer(input.limit ?? 1, 1, 10);
    if (!WORKER_ID.test(workerId)) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
    const leases = Array.from({ length: limit }, () => {
      const token = this.leaseToken();
      if (!LEASE_TOKEN.test(token)) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
      return { token, tokenHash: hash(token) };
    });
    try { return await this.dependencies.repository.claim(principal, scope, queue, {
      workerId, limit, now: this.now(), leases,
    }); }
    catch (error) { throw mapError(error); }
  }

  async acknowledge(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queueName: string,
    messageId: string,
    input: { workerId: string; leaseToken: string },
  ) {
    this.assertWorker(principal, scope);
    const queue = await this.queue(principal, scope, queueName);
    const lease = settlement(messageId, input);
    try {
      const message = await this.dependencies.repository.acknowledge(
        principal, scope, queue, messageId, lease.workerId, hash(lease.leaseToken), this.now(),
      );
      return { id: message.id, queue: queue.name, status: message.status, completedAt: message.completedAt!.toISOString() };
    } catch (error) { throw mapError(error); }
  }

  async fail(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queueName: string,
    messageId: string,
    input: { workerId: string; leaseToken: string; failureCode: string },
  ) {
    this.assertWorker(principal, scope);
    const queue = await this.queue(principal, scope, queueName);
    const lease = settlement(messageId, input);
    if (!FAILURE_CODES.has(input.failureCode as ProjectQueueFailureCode) || input.failureCode === "LEASE_EXPIRED") {
      throw new ProjectQueueError("QUEUE_INVALID_INPUT");
    }
    try {
      const message = await this.dependencies.repository.fail(
        principal, scope, queue, messageId, lease.workerId, hash(lease.leaseToken),
        input.failureCode as Exclude<ProjectQueueFailureCode, "LEASE_EXPIRED">, this.now(),
      );
      return {
        id: message.id, queue: queue.name, status: message.status,
        availableAt: message.availableAt.toISOString(), attempt: message.attemptCount,
        failureCode: message.lastFailureCode,
      };
    } catch (error) { throw mapError(error); }
  }

  async renewLease(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queueName: string,
    messageId: string,
    input: { workerId: string; leaseToken: string },
  ) {
    this.assertWorker(principal, scope);
    const queue = await this.queue(principal, scope, queueName);
    const lease = settlement(messageId, input);
    try {
      const message = await this.dependencies.repository.renewLease(
        principal, scope, queue, messageId, lease.workerId, hash(lease.leaseToken), this.now(),
      );
      return { id: message.id, queue: queue.name, leaseSequence: message.leaseSequence,
        leaseExpiresAt: message.leaseExpiresAt!.toISOString() };
    } catch (error) { throw mapError(error); }
  }

  async status(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, queueName: string) {
    await this.assertAdmin(principal, scope);
    const queue = await this.queue(principal, scope, queueName);
    try { return await this.dependencies.repository.status(principal, scope, queue, this.now()); }
    catch (error) { throw mapError(error); }
  }

  /**
   * Alle Queues des Scopes mit ihren Zaehlern — fuer den Metrics-Export.
   *
   * Jede Queue erscheint, auch eine leere: Ein Scraper braucht die Zeitreihe,
   * bevor sie sich bewegt. Die Zaehler entstehen wie bei `status` — inklusive
   * Lease-Erholung und Aufraeumen je Queue — und damit in derselben
   * Wahrheit, die die Einzelroute liefert.
   */
  async exportMetrics(principal: ProjectQueuePrincipal, scope: ProjectQueueScope) {
    await this.assertAdmin(principal, scope);
    const queues = await this.dependencies.repository.listQueues(principal, scope);
    const now = this.now();
    const statuses = [];
    for (const queue of queues) {
      try { statuses.push(await this.dependencies.repository.status(principal, scope, queue, now)); }
      catch (error) { throw mapError(error); }
    }
    return { generatedAt: now.toISOString(), queues: statuses };
  }

  /**
   * Die Spur einer Nachricht (2.121).
   *
   * Nur Admin, wie der Status und die Dead-Letter-Liste: Eine Spur sagt, wann
   * welcher Wirt woran gearbeitet hat, und das ist eine Betriebsangabe und
   * keine Angabe fuer die Anwendung, die eingereiht hat.
   *
   * Eine Id ohne Spur und ohne Nachricht ist `QUEUE_RESOURCE_NOT_FOUND` und
   * nicht eine leere Spur: Eine leere Spur hiesse "diese Nachricht gibt es,
   * und es ist nichts mit ihr passiert", und das stimmt nie. Jede Nachricht
   * hat mindestens ihre erste Station.
   */
  async readTrace(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queueName: string,
    messageId: string,
  ) {
    await this.assertAdmin(principal, scope);
    if (!IDENTIFIER.test(messageId)) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
    const queue = await this.queue(principal, scope, queueName);
    let trace;
    try { trace = await this.dependencies.repository.readTrace(principal, scope, queue, messageId); }
    catch (error) { throw mapError(error); }
    if (!trace) throw new ProjectQueueError("QUEUE_RESOURCE_NOT_FOUND");
    return trace;
  }

  async listDeadLetters(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queueName: string,
    input: { limit?: number } = {},
  ) {
    await this.assertAdmin(principal, scope);
    const queue = await this.queue(principal, scope, queueName);
    const limit = integer(input.limit ?? 50, 1, 100);
    try { return await this.dependencies.repository.listDeadLetters(principal, scope, queue, limit); }
    catch (error) { throw mapError(error); }
  }

  async replayDeadLetter(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queueName: string,
    messageId: string,
  ) {
    await this.assertAdmin(principal, scope);
    if (!IDENTIFIER.test(messageId)) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
    const queue = await this.queue(principal, scope, queueName);
    try {
      const result = await this.dependencies.repository.replayDeadLetter(
        principal, scope, queue, messageId, this.id(), this.now(),
      );
      return {
        id: result.message.id,
        queue: queue.name,
        status: result.message.status,
        replayedFromId: messageId,
        deduplicated: !result.created,
        availableAt: result.message.availableAt.toISOString(),
      };
    } catch (error) { throw mapError(error); }
  }

  /**
   * Die Suche steht am Anfang fast jeder Methode — und lag bis Release 1.64
   * ausserhalb der Fehlerabbildung.
   *
   * Ein Infrastrukturfehler hier verliess den Dienst als roher
   * `RepositoryError`, obwohl sein Vertrag `ProjectQueueError` zusagt.
   * Aufgefallen ist es an einem erschoepften Verbindungspool: Der Fehler kam
   * aus der Suche, nicht aus dem Einreihen, und ging an `mapError` vorbei.
   */
  private async queue(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, queueName: string) {
    if (!QUEUE_NAME.test(queueName)) throw new ProjectQueueError("QUEUE_RESOURCE_NOT_FOUND");
    let queue;
    try { queue = await this.dependencies.repository.findQueue(principal, scope, queueName); }
    catch (error) { throw mapError(error); }
    if (!queue) throw new ProjectQueueError("QUEUE_RESOURCE_NOT_FOUND");
    return queue;
  }

  private async assertAdmin(principal: ProjectQueuePrincipal, scope: ProjectQueueScope) {
    assertPrincipal(principal, scope);
    if (principal.role !== "admin") throw new ProjectQueueError("QUEUE_ACCESS_DENIED");
    if (this.dependencies.controlPlane) {
      try {
        await this.dependencies.controlPlane.getProjectEnvironment({
          organizationId: scope.organizationId,
          actor: { id: principal.subject, ref: principal.actorRef, type: "user" },
        }, scope.projectId, scope.environment);
      } catch { throw new ProjectQueueError("QUEUE_RESOURCE_NOT_FOUND"); }
    }
  }

  private assertWorker(principal: ProjectQueuePrincipal, scope: ProjectQueueScope) {
    assertPrincipal(principal, scope);
    if (principal.role !== "service_role") throw new ProjectQueueError("QUEUE_ACCESS_DENIED");
  }
}

function assertPrincipal(principal: ProjectQueuePrincipal, scope: ProjectQueueScope) {
  if (principal.organizationId !== scope.organizationId || !IDENTIFIER.test(scope.projectId) ||
      !["development", "staging", "production"].includes(scope.environment) ||
      !principal.actorRef || principal.actorRef.length > 320 || !principal.subject || principal.subject.length > 320) {
    throw new ProjectQueueError("QUEUE_ACCESS_DENIED");
  }
}

function canEnqueue(queue: ProjectQueue, principal: ProjectQueuePrincipal) {
  return principal.role === "admin" || principal.role === "service_role" ||
    (queue.enqueuePolicy === "authenticated" && principal.role === "authenticated");
}

function safeJson(value: unknown, maxBytes: number): ProjectQueueJson {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { throw new ProjectQueueError("QUEUE_INVALID_INPUT"); }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new ProjectQueueError("QUEUE_INVALID_INPUT");
  }
  const parsed = JSON.parse(serialized) as ProjectQueueJson;
  assertJson(parsed, 0, { nodes: 0 });
  return parsed;
}

function assertJson(value: ProjectQueueJson, depth: number, state: { nodes: number }) {
  state.nodes += 1;
  if (depth > 12 || state.nodes > 4_000) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
  if (Array.isArray(value)) for (const item of value) assertJson(item, depth + 1, state);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new ProjectQueueError("QUEUE_INVALID_INPUT");
    }
    assertJson(item, depth + 1, state);
  }
}

function scheduledAt(raw: string | undefined, now: Date) {
  if (!raw) return new Date(now);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() + 7 * 86_400_000 ||
      parsed.getTime() < now.getTime() - 300_000) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
  return parsed < now ? new Date(now) : parsed;
}

function settlement(messageId: string, input: { workerId: string; leaseToken: string }) {
  if (!IDENTIFIER.test(messageId) || !WORKER_ID.test(input.workerId) || !LEASE_TOKEN.test(input.leaseToken)) {
    throw new ProjectQueueError("QUEUE_INVALID_INPUT");
  }
  return input;
}

function policy(value: ProjectQueueEnqueuePolicy) {
  if (!new Set(["authenticated", "service"]).has(value)) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
  return value;
}

function integer(value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ProjectQueueError("QUEUE_INVALID_INPUT");
  return value;
}

function hash(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }

/**
 * Der Verifikator eines Dedupe-Schluessels, exportiert fuer Leser.
 *
 * Die Queue speichert nur `dedupe_key_hash`, nie den Schluessel. Wer eine
 * Nachricht zu einem bekannten Schluessel wiederfinden will — das Cron-Log aus
 * 2.42 tut genau das — muss deshalb denselben Verifikator bilden. Genau
 * dieselbe Funktion, nicht eine zweite mit derselben Absicht: Ein Unterschied
 * zwischen beiden waere eine Ansicht, die dauerhaft "fehlt" meldet, obwohl die
 * Nachricht da ist.
 */
export function projectQueueDedupeKeyHash(dedupeKey: string): string { return hash(dedupeKey); }

function mapError(error: unknown): ProjectQueueError {
  if (isProjectQueueError(error)) return error;
  if (error instanceof ProjectQueueConflictError) return new ProjectQueueError(error.code);
  // Ein erschoepfter Pool ist kein Konflikt. Er stand bis Release 1.64 im
  // Sammelzweig und wurde als 409 beantwortet — eine Aussage ueber die
  // Warteschlange, die nicht stimmte.
  if (error instanceof ConnectionUnavailableError) {
    return new ProjectQueueError("QUEUE_UNAVAILABLE", { cause: error });
  }
  return new ProjectQueueError("QUEUE_CONFLICT", { cause: error });
}
