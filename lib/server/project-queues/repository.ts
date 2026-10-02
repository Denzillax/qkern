import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  ProjectQueue,
  ProjectQueueClaim,
  ProjectQueueDeadLetter,
  ProjectQueueFailureCode,
  ProjectQueueMessage,
  ProjectQueuePrincipal,
  ProjectQueueScope,
  ProjectQueueStatus,
} from "@/lib/server/project-queues/model";
import { sameProjectQueueScope } from "@/lib/server/project-queues/model";
import type {
  ProjectQueueTrace,
  ProjectQueueTraceAnchor,
  ProjectQueueTraceEntry,
  ProjectQueueTraceSearchEntry,
  ProjectQueueTraceSearchPage,
  ProjectQueueTraceStation,
} from "@/lib/server/project-queues/trace";
import {
  PROJECT_QUEUE_TRACE_MAX_STATIONS,
  projectQueueClaimTraceparent,
  projectQueueTraceExpiresAt,
  projectQueueTraceSpanId,
} from "@/lib/server/project-queues/trace";
import type { SqlQueryable } from "@/lib/server/db/sql";

/**
 * Wird **innerhalb** der Enqueue-Transaktion gerufen, nachdem die Nachricht
 * geschrieben wurde und bevor sie festgeschrieben wird.
 *
 * Wirft der Haken, rollt die Nachricht mit zurück. Das ist der ganze Zweck: Es
 * soll keine Nachricht geben, die niemand gezählt hat, und keine Zählung ohne
 * ihre Nachricht.
 *
 * Der Memory-Port hat keine Transaktion und übergibt deshalb nichts.
 */
export type ProjectQueueMeter = (transaction?: SqlQueryable) => Promise<void>;

export class ProjectQueueConflictError extends Error {
  constructor(readonly code: "QUEUE_CONFLICT" | "QUEUE_CAPACITY_EXCEEDED" | "QUEUE_LEASE_LOST") {
    super(code); this.name = "ProjectQueueConflictError";
  }
}
recognisedByName(ProjectQueueConflictError, "ProjectQueueConflictError");

export interface ProjectQueueRepository {
  readonly durability: "ephemeral" | "durable";
  listQueues(principal: ProjectQueuePrincipal, scope: ProjectQueueScope): Promise<ProjectQueue[]>;
  findQueue(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, queueIdOrName: string): Promise<ProjectQueue | null>;
  createQueue(principal: ProjectQueuePrincipal, queue: ProjectQueue): Promise<ProjectQueue>;
  enqueue(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    message: ProjectQueueMessage,
    now: Date,
    meter?: ProjectQueueMeter,
    /**
     * Der Anschluss an eine fremde Spur, falls der Aufrufer einen
     * `traceparent` mitgebracht hat. Er landet auf der ersten Station und
     * nirgends sonst; siehe `trace.ts`.
     */
    trace?: ProjectQueueTraceAnchor | null,
  ): Promise<{ message: ProjectQueueMessage; deduplicated: boolean }>;
  claim(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    input: {
      workerId: string;
      limit: number;
      now: Date;
      leases: Array<{ token: string; tokenHash: string }>;
    },
  ): Promise<ProjectQueueClaim[]>;
  acknowledge(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    now: Date,
  ): Promise<ProjectQueueMessage>;
  fail(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    failureCode: Exclude<ProjectQueueFailureCode, "LEASE_EXPIRED">,
    now: Date,
  ): Promise<ProjectQueueMessage>;
  renewLease(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    now: Date,
  ): Promise<ProjectQueueMessage>;
  status(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, queue: ProjectQueue, now: Date): Promise<ProjectQueueStatus>;
  listDeadLetters(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    limit: number,
  ): Promise<ProjectQueueDeadLetter[]>;
  replayDeadLetter(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    replayId: string,
    now: Date,
  ): Promise<{ message: ProjectQueueMessage; created: boolean }>;
  /**
   * Die Spur einer Nachricht (2.121), in Zeitreihenfolge.
   *
   * `null` heisst: In dieser Queue dieses Scopes gibt es zu dieser Id weder
   * eine Nachricht noch eine Station. Eine Nachricht ohne Stationen gibt es
   * nicht, aber Stationen ohne Nachricht schon: Die Spur ueberlebt das
   * Aufraeumen der Nachricht, und genau dafuer ist sie da.
   */
  readTrace(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
  ): Promise<ProjectQueueTrace | null>;
  /**
   * Das Subjekt, das diese Nachricht eingereiht hat (2.131).
   *
   * `null` heisst: Es gibt die Zeile nicht mehr oder sie gehoert nicht in diese
   * Queue dieses Scopes. Beides fuehrt an der Anwendungstuer zur selben
   * Ablehnung, und das ist Absicht: Ohne Besitzer gibt es nichts zu vergleichen,
   * und ein Vergleich, der ohne Gegenueber durchgeht, ist keiner.
   *
   * Eine eigene Methode und **nicht** ein Feld an `ProjectQueueTrace`: Der
   * Besitzer ist die Bedingung der Anwendungstuer und nicht Teil der Spur. Haengte
   * er an der Spur, stuende er in jeder Antwort der Admin-Route, also waere eine
   * Nutzerkennung aus Project Auth in einer Betriebsansicht, in der sie nichts
   * beantwortet.
   */
  findTraceMessageOwner(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
  ): Promise<string | null>;
  /**
   * Die Nachrichten einer Spur-Id (2.131), ueber alle Queues **eines** Scopes.
   *
   * Ohne Queue-Parameter, und das ist die Entscheidung: Eine fremde Spur laeuft
   * durch die Umgebung und nicht durch eine Queue. Ueber die Umgebung hinaus
   * laeuft sie nie, und das traegt nicht ein Filter in der Anfrage, sondern der
   * Scope, den der Dienst setzt, und die Zeilensicherheit unter ihm; der Index aus
   * 0085 fuehrt dieselben drei Spalten vorn.
   *
   * `cursor` ist die Nachrichten-Id der letzten gezeigten Zeile. Ihre Position
   * liest der Port selbst nach; die Begruendung steht an
   * `ProjectQueueTraceSearchPage`.
   */
  searchTraces(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    input: { traceId: string; limit: number; cursor: string | null },
  ): Promise<ProjectQueueTraceSearchPage>;
}

/**
 * Eine Station, bevor sie eine Zeile ist. Sequenz und Frist rechnet der Port
 * aus, weil nur er weiss, wie viele Zeilen schon stehen.
 */
export type ProjectQueueTraceRecord = {
  station: ProjectQueueTraceStation;
  attempt: number;
  workerId: string | null;
  failureCode: ProjectQueueMessage["lastFailureCode"];
  occurredAt: Date;
  trace?: ProjectQueueTraceAnchor | null;
  sourceMessageId?: string | null;
};

export class MemoryProjectQueueRepository implements ProjectQueueRepository {
  readonly durability = "ephemeral" as const;
  private readonly queues = new Map<string, ProjectQueue>();
  private readonly messages = new Map<string, ProjectQueueMessage>();
  private readonly locks = new Map<string, Promise<void>>();
  /**
   * Die Stationen, je Nachricht. Eine eigene Ablage und nicht ein Feld an der
   * Nachricht: Der Postgres-Port haelt sie aus demselben Grund in einer
   * eigenen Tabelle ohne Fremdschluessel, und eine Spur, die mit ihrer
   * Nachricht aus der Map faellt, waere ein Port, der etwas anderes zusagt als
   * das Produkt.
   */
  private readonly traces = new Map<string, StoredTraceStation[]>();

  async listQueues(principal: ProjectQueuePrincipal, scope: ProjectQueueScope) {
    return [...this.queues.values()].filter((queue) => queue.organizationId === principal.organizationId &&
      sameProjectQueueScope(queue, scope)).sort((a, b) => a.name.localeCompare(b.name)).map(cloneQueue);
  }

  async findQueue(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, queueIdOrName: string) {
    const queue = [...this.queues.values()].find((candidate) => candidate.organizationId === principal.organizationId &&
      sameProjectQueueScope(candidate, scope) && (candidate.id === queueIdOrName || candidate.name === queueIdOrName));
    return queue ? cloneQueue(queue) : null;
  }

  async createQueue(principal: ProjectQueuePrincipal, queue: ProjectQueue) {
    return await this.exclusive({ ...queue, id: "__definitions__" }, async () => {
      if (principal.organizationId !== queue.organizationId || this.queues.has(queue.id) ||
          [...this.queues.values()].some((candidate) => sameProjectQueueScope(candidate, queue) &&
            candidate.name === queue.name)) throw new ProjectQueueConflictError("QUEUE_CONFLICT");
      this.queues.set(queue.id, cloneQueue(queue));
      return cloneQueue(queue);
    });
  }

  async enqueue(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    message: ProjectQueueMessage,
    now: Date,
    meter?: ProjectQueueMeter,
    trace?: ProjectQueueTraceAnchor | null,
  ) {
    return await this.exclusive(queue, async () => {
      this.assertQueue(principal, scope, queue);
      this.cleanupCompleted(queue, now);
      this.pruneTraces(queue, now);
      if (message.dedupeKeyHash && queue.dedupeWindowSeconds > 0) {
        const earliest = now.getTime() - queue.dedupeWindowSeconds * 1_000;
        const duplicate = [...this.messages.values()].find((candidate) => sameProjectQueueScope(candidate, scope) &&
          candidate.queueId === queue.id && candidate.dedupeKeyHash === message.dedupeKeyHash &&
          candidate.createdAt.getTime() >= earliest);
        if (duplicate) {
          await meter?.();
          // Die Station gehoert dem Zwilling: Die zweite Anfrage hat keine
          // eigene Nachricht, und sie bekommt auch keine eigene Spur.
          this.record(queue, duplicate.id, {
            station: "deduplicated", attempt: duplicate.attemptCount,
            workerId: null, failureCode: null, occurredAt: now,
          });
          return { message: cloneMessage(duplicate), deduplicated: true };
        }
      }
      const pending = [...this.messages.values()].filter((candidate) => sameProjectQueueScope(candidate, scope) &&
        candidate.queueId === queue.id && ["available", "in_flight"].includes(candidate.status)).length;
      if (pending >= queue.maxPendingMessages) throw new ProjectQueueConflictError("QUEUE_CAPACITY_EXCEEDED");
      if (this.messages.has(message.id) || !sameProjectQueueScope(message, queue)) {
        throw new ProjectQueueConflictError("QUEUE_CONFLICT");
      }
      // Ohne Transaktion bleibt nur die Reihenfolge: erst messen, dann
      // ablegen. Wirft der Haken, entsteht die Nachricht nicht. Das ist
      // schwächer als ein Rollback und für einen Entwicklungsport genug.
      await meter?.();
      this.messages.set(message.id, cloneMessage(message));
      this.record(queue, message.id, {
        station: "enqueued", attempt: 0, workerId: null, failureCode: null,
        occurredAt: message.createdAt, trace,
      });
      return { message: cloneMessage(message), deduplicated: false };
    });
  }

  async claim(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    input: { workerId: string; limit: number; now: Date; leases: Array<{ token: string; tokenHash: string }> },
  ) {
    return await this.exclusive(queue, async () => {
      this.assertQueue(principal, scope, queue);
      this.recoverExpiredLeases(queue, input.now);
      const ready = [...this.messages.values()].filter((message) => sameProjectQueueScope(message, scope) &&
        message.queueId === queue.id && message.status === "available" && message.availableAt <= input.now)
        .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).slice(0, input.limit);
      return ready.map((message, index) => {
        const lease = input.leases[index];
        message.status = "in_flight";
        message.attemptCount += 1;
        message.leaseSequence += 1;
        message.leaseWorkerId = input.workerId;
        message.leaseTokenHash = lease.tokenHash;
        message.leaseExpiresAt = new Date(input.now.getTime() + queue.visibilityTimeoutSeconds * 1_000);
        this.messages.set(message.id, message);
        const spanId = this.record(queue, message.id, {
          station: "claimed", attempt: message.attemptCount,
          workerId: input.workerId, failureCode: null, occurredAt: input.now,
        });
        return {
          id: message.id,
          queue: queue.name,
          payload: structuredClone(message.payload),
          attempt: message.attemptCount,
          leaseSequence: message.leaseSequence,
          leaseToken: lease.token,
          leaseExpiresAt: message.leaseExpiresAt.toISOString(),
          createdAt: message.createdAt.toISOString(),
          // Spur-Id von der ersten Station, Eltern-Span von der gerade
          // geschriebenen. Ohne Anschluss bleibt es `null`; siehe 0082.
          traceparent: projectQueueClaimTraceparent(
            this.traceIdOf(message.id), spanId,
          ),
        };
      });
    });
  }

  async acknowledge(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    now: Date,
  ) {
    return await this.exclusive(queue, async () => {
      const message = this.leasedMessage(principal, scope, queue, messageId, workerId, leaseTokenHash, now);
      message.status = "completed";
      message.completedAt = new Date(now);
      clearLease(message);
      this.messages.set(message.id, message);
      this.record(queue, message.id, {
        station: "completed", attempt: message.attemptCount,
        workerId, failureCode: null, occurredAt: now,
      });
      return cloneMessage(message);
    });
  }

  async fail(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    failureCode: Exclude<ProjectQueueFailureCode, "LEASE_EXPIRED">,
    now: Date,
  ) {
    return await this.exclusive(queue, async () => {
      const message = this.leasedMessage(principal, scope, queue, messageId, workerId, leaseTokenHash, now);
      message.lastFailureCode = failureCode;
      clearLease(message);
      if (message.attemptCount >= queue.maxAttempts || failureCode === "INVALID_PAYLOAD") {
        message.status = "dead_lettered";
        message.deadLetteredAt = new Date(now);
      } else {
        const delay = Math.min(queue.retryMaxSeconds,
          queue.retryBaseSeconds * (2 ** Math.min(message.attemptCount - 1, 20)));
        message.status = "available";
        message.availableAt = new Date(now.getTime() + delay * 1_000);
      }
      this.messages.set(message.id, message);
      this.record(queue, message.id, {
        station: message.status === "dead_lettered" ? "dead_lettered" : "retry_scheduled",
        attempt: message.attemptCount, workerId, failureCode, occurredAt: now,
      });
      return cloneMessage(message);
    });
  }

  async renewLease(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    now: Date,
  ) {
    return await this.exclusive(queue, async () => {
      const message = this.leasedMessage(principal, scope, queue, messageId, workerId, leaseTokenHash, now);
      message.leaseExpiresAt = new Date(now.getTime() + queue.visibilityTimeoutSeconds * 1_000);
      this.messages.set(message.id, message);
      return cloneMessage(message);
    });
  }

  async status(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, queue: ProjectQueue, now: Date) {
    return await this.exclusive(queue, async () => {
      this.assertQueue(principal, scope, queue);
      this.recoverExpiredLeases(queue, now);
      this.cleanupCompleted(queue, now);
      this.pruneTraces(queue, now);
      const messages = [...this.messages.values()].filter((message) => sameProjectQueueScope(message, scope) &&
        message.queueId === queue.id);
      const ready = messages.filter((message) => message.status === "available" && message.availableAt <= now);
      return {
        queue: queue.name,
        available: ready.length,
        scheduled: messages.filter((message) => message.status === "available" && message.availableAt > now).length,
        inFlight: messages.filter((message) => message.status === "in_flight").length,
        completed: messages.filter((message) => message.status === "completed").length,
        deadLettered: messages.filter((message) => message.status === "dead_lettered").length,
        oldestAvailableAt: ready.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())[0]
          ?.availableAt.toISOString() ?? null,
      };
    });
  }

  async listDeadLetters(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    limit: number,
  ): Promise<ProjectQueueDeadLetter[]> {
    return await this.exclusive(queue, async () => {
      this.assertQueue(principal, scope, queue);
      return [...this.messages.values()]
        .filter((message) => sameProjectQueueScope(message, scope) && message.queueId === queue.id &&
          message.status === "dead_lettered")
        .sort((left, right) => right.deadLetteredAt!.getTime() - left.deadLetteredAt!.getTime() ||
          left.id.localeCompare(right.id))
        .slice(0, limit)
        .map((message) => ({
          id: message.id,
          queue: queue.name,
          attempt: message.attemptCount,
          failureCode: message.lastFailureCode!,
          createdAt: message.createdAt.toISOString(),
          deadLetteredAt: message.deadLetteredAt!.toISOString(),
          replayed: [...this.messages.values()].some((candidate) =>
            sameProjectQueueScope(candidate, scope) && candidate.replayedFromMessageId === message.id),
        }));
    });
  }

  async replayDeadLetter(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    replayId: string,
    now: Date,
  ) {
    return await this.exclusive(queue, async () => {
      this.assertQueue(principal, scope, queue);
      const existing = [...this.messages.values()].find((candidate) =>
        sameProjectQueueScope(candidate, scope) && candidate.queueId === queue.id &&
        candidate.replayedFromMessageId === messageId);
      if (existing) return { message: cloneMessage(existing), created: false };
      const source = this.messages.get(messageId);
      if (!source || !sameProjectQueueScope(source, scope) || source.queueId !== queue.id ||
          source.status !== "dead_lettered") throw new ProjectQueueConflictError("QUEUE_CONFLICT");
      const replay: ProjectQueueMessage = {
        ...cloneMessage(source),
        id: replayId,
        status: "available",
        dedupeKeyHash: null,
        attemptCount: 0,
        availableAt: new Date(now),
        leaseWorkerId: null,
        leaseTokenHash: null,
        leaseSequence: 0,
        leaseExpiresAt: null,
        lastFailureCode: null,
        createdAt: new Date(now),
        completedAt: null,
        deadLetteredAt: null,
        replayedFromMessageId: source.id,
      };
      this.messages.set(replay.id, replay);
      // Die neue Nachricht erbt den Anschluss der alten: Eine Kette durch ein
      // Dead Letter bleibt damit draussen eine Spur.
      this.record(queue, replay.id, {
        station: "replayed", attempt: 0, workerId: null, failureCode: null,
        occurredAt: new Date(now), sourceMessageId: source.id,
        trace: this.anchorOf(source.id),
      });
      return { message: cloneMessage(replay), created: true };
    });
  }

  async readTrace(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
  ): Promise<ProjectQueueTrace | null> {
    return await this.exclusive(queue, async () => {
      this.assertQueue(principal, scope, queue);
      const stored = (this.traces.get(messageId) ?? []).filter((station) =>
        station.organizationId === scope.organizationId && station.projectId === scope.projectId &&
        station.environment === scope.environment && station.queueId === queue.id);
      const message = this.messages.get(messageId);
      const owned = message !== undefined && sameProjectQueueScope(message, scope) &&
        message.queueId === queue.id;
      if (stored.length === 0 && !owned) return null;
      const ordered = [...stored].sort((left, right) => left.sequence - right.sequence);
      const first = ordered[0];
      const replay = [...this.traces.values()].flat().find((station) =>
        station.station === "replayed" && station.sourceMessageId === messageId &&
        station.organizationId === scope.organizationId && station.projectId === scope.projectId &&
        station.environment === scope.environment && station.queueId === queue.id);
      return Object.freeze({
        messageId,
        queue: queue.name,
        traceId: first?.traceId ?? null,
        parentSpanId: first?.parentSpanId ?? null,
        sourceMessageId: first?.sourceMessageId ?? null,
        replayedIntoMessageId: replay?.messageId ?? null,
        messageExists: owned,
        complete: ordered.length < PROJECT_QUEUE_TRACE_MAX_STATIONS,
        stations: Object.freeze(ordered.map(publicTraceEntry)),
      });
    });
  }

  async findTraceMessageOwner(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
  ): Promise<string | null> {
    return await this.exclusive(queue, async () => {
      this.assertQueue(principal, scope, queue);
      const message = this.messages.get(messageId);
      if (!message || !sameProjectQueueScope(message, scope) || message.queueId !== queue.id) return null;
      return message.ownerSubject;
    });
  }

  /**
   * Dieselbe Ordnung und dieselbe Seitenform wie der Postgres-Port, in
   * JavaScript gerechnet: Zeitpunkt, dann Nachrichten-Id, aufsteigend, und der
   * Cursor ist die Id der letzten gezeigten Zeile.
   *
   * Gelesen werden nur die Stationen mit einem Anschluss, und das sind nach 0081
   * genau die ersten je Nachricht. Der Port filtert darum auf `traceId` und nicht
   * zusaetzlich auf `sequence === 1`: Eine zweite Bedingung fuer dieselbe Zusage
   * waere eine, die irgendwann von der Tabelle abweicht.
   */
  async searchTraces(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    input: { traceId: string; limit: number; cursor: string | null },
  ): Promise<ProjectQueueTraceSearchPage> {
    if (principal.organizationId !== scope.organizationId) throw new ProjectQueueConflictError("QUEUE_CONFLICT");
    const queues = new Map([...this.queues.values()]
      .filter((queue) => queue.organizationId === scope.organizationId && sameProjectQueueScope(queue, scope))
      .map((queue) => [queue.id, queue.name] as const));
    const anchors = [...this.traces.values()].flat()
      .filter((station) => station.traceId === input.traceId &&
        station.organizationId === scope.organizationId && station.projectId === scope.projectId &&
        station.environment === scope.environment && queues.has(station.queueId))
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() ||
        left.messageId.localeCompare(right.messageId));
    let start = 0;
    if (input.cursor !== null) {
      const position = anchors.findIndex((station) => station.messageId === input.cursor);
      // Ein Cursor, dessen Zeile es nicht mehr gibt, liefert nichts. Dieselbe
      // Antwort wie im Postgres-Port, wo die nachgelesene Position NULL ist.
      if (position < 0) return Object.freeze({ traceId: input.traceId, messages: Object.freeze([]), nextCursor: null });
      start = position + 1;
    }
    const page = anchors.slice(start, start + input.limit + 1);
    const messages = page.slice(0, input.limit).map((station) => searchEntry(station, queues.get(station.queueId)!));
    return Object.freeze({
      traceId: input.traceId,
      messages: Object.freeze(messages),
      nextCursor: page.length > input.limit ? messages[messages.length - 1]!.messageId : null,
    });
  }

  /**
   * Haengt eine Station an und schweigt, wenn die Grenze erreicht ist.
   *
   * Schweigen und nicht werfen: Eine Spur ist Beobachtung und keine
   * Ausfuehrungsgewalt. Dass die Grenze erreicht wurde, sagt der Leser ueber
   * `complete`, und das ist die Stelle, an der es jemanden interessiert.
   */
  private record(queue: ProjectQueue, messageId: string, record: ProjectQueueTraceRecord): string | null {
    const existing = this.traces.get(messageId) ?? [];
    if (existing.length >= PROJECT_QUEUE_TRACE_MAX_STATIONS) return null;
    const anchor = existing.length === 0 ? record.trace ?? null : null;
    const spanId = projectQueueTraceSpanId();
    existing.push({
      organizationId: queue.organizationId,
      projectId: queue.projectId,
      environment: queue.environment,
      queueId: queue.id,
      messageId,
      sequence: existing.length + 1,
      station: record.station,
      attempt: record.attempt,
      workerId: record.workerId,
      failureCode: record.failureCode,
      traceId: anchor?.traceId ?? null,
      parentSpanId: anchor?.parentSpanId ?? null,
      spanId,
      sourceMessageId: record.sourceMessageId ?? null,
      occurredAt: new Date(record.occurredAt),
      expiresAt: projectQueueTraceExpiresAt(queue, record.occurredAt),
    });
    this.traces.set(messageId, existing);
    return spanId;
  }

  /** Die Spur-Id einer Nachricht, also der Wert auf ihrer ersten Station. */
  private traceIdOf(messageId: string): string | null {
    return (this.traces.get(messageId) ?? []).find((station) => station.sequence === 1)?.traceId ?? null;
  }

  /**
   * Der Anschluss der ersten Station einer Nachricht, falls sie einen hat.
   *
   * Eine wiedereingereihte Nachricht erbt ihn vollstaendig, Eltern-Span
   * inklusive. Warum nicht die letzte Station der Quelle: siehe `traceAnchor` im
   * Postgres-Port, dort steht die Begruendung in voller Laenge.
   */
  private anchorOf(messageId: string): ProjectQueueTraceAnchor | null {
    const first = (this.traces.get(messageId) ?? []).find((station) => station.sequence === 1);
    return first?.traceId ? Object.freeze({ traceId: first.traceId, parentSpanId: first.parentSpanId! }) : null;
  }

  /** Geschnitten wird am Ablauf der Station. Siehe `trace.ts`. */
  private pruneTraces(queue: ProjectQueue, now: Date) {
    for (const [messageId, stations] of this.traces) {
      const kept = stations.filter((station) =>
        station.queueId !== queue.id || station.expiresAt > now);
      if (kept.length === stations.length) continue;
      if (kept.length === 0) this.traces.delete(messageId);
      else this.traces.set(messageId, kept);
    }
  }

  private assertQueue(principal: ProjectQueuePrincipal, scope: ProjectQueueScope, queue: ProjectQueue) {
    const current = this.queues.get(queue.id);
    if (!current || principal.organizationId !== scope.organizationId || !sameProjectQueueScope(current, scope)) {
      throw new ProjectQueueConflictError("QUEUE_CONFLICT");
    }
  }

  private leasedMessage(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    messageId: string,
    workerId: string,
    leaseTokenHash: string,
    now: Date,
  ) {
    this.assertQueue(principal, scope, queue);
    const message = this.messages.get(messageId);
    if (!message || !sameProjectQueueScope(message, scope) || message.queueId !== queue.id ||
        message.status !== "in_flight" || message.leaseWorkerId !== workerId ||
        message.leaseTokenHash !== leaseTokenHash || !message.leaseExpiresAt || message.leaseExpiresAt <= now) {
      throw new ProjectQueueConflictError("QUEUE_LEASE_LOST");
    }
    return message;
  }

  private recoverExpiredLeases(queue: ProjectQueue, now: Date) {
    for (const message of this.messages.values()) {
      if (message.queueId !== queue.id || message.status !== "in_flight" ||
          !message.leaseExpiresAt || message.leaseExpiresAt > now) continue;
      // Der Wirt, der die Pacht verloren hat, steht in der Station. Gelesen
      // wird er **vor** `clearLease`, danach ist er weg.
      const workerId = message.leaseWorkerId;
      clearLease(message);
      message.lastFailureCode = "LEASE_EXPIRED";
      if (message.attemptCount >= queue.maxAttempts) {
        message.status = "dead_lettered";
        message.deadLetteredAt = new Date(now);
      } else {
        message.status = "available";
        message.availableAt = new Date(now);
      }
      this.messages.set(message.id, message);
      this.record(queue, message.id, {
        station: message.status === "dead_lettered" ? "dead_lettered" : "lease_expired",
        attempt: message.attemptCount, workerId,
        failureCode: "LEASE_EXPIRED", occurredAt: now,
      });
    }
  }

  private cleanupCompleted(queue: ProjectQueue, now: Date) {
    const cutoff = now.getTime() - queue.retentionSeconds * 1_000;
    for (const [id, message] of this.messages) {
      if (message.queueId === queue.id && message.status === "completed" &&
          message.completedAt && message.completedAt.getTime() < cutoff &&
          (!message.dedupeKeyHash || message.createdAt.getTime() + queue.dedupeWindowSeconds * 1_000 <= now.getTime())) {
        this.messages.delete(id);
      }
    }
  }

  private async exclusive<T>(queue: Pick<ProjectQueue, "organizationId" | "projectId" | "environment" | "id">, work: () => Promise<T>) {
    const key = `${queue.organizationId}\u0000${queue.projectId}\u0000${queue.environment}\u0000${queue.id}`;
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const gate = previous.then(() => current);
    this.locks.set(key, gate);
    await previous;
    try { return await work(); }
    finally { release(); if (this.locks.get(key) === gate) this.locks.delete(key); }
  }
}

/** Eine Station im Speicher-Port, in der Form, die die Tabelle aus 0081 hat. */
type StoredTraceStation = {
  organizationId: string;
  projectId: string;
  environment: ProjectQueueScope["environment"];
  queueId: string;
  messageId: string;
  sequence: number;
  station: ProjectQueueTraceStation;
  attempt: number;
  workerId: string | null;
  failureCode: ProjectQueueMessage["lastFailureCode"];
  traceId: string | null;
  spanId: string;
  parentSpanId: string | null;
  sourceMessageId: string | null;
  occurredAt: Date;
  expiresAt: Date;
};

/**
 * Was eine Station nach draussen zeigt. Der Scope, die Queue-Id, der Ablauf,
 * der Anschluss und die Herkunft bleiben drinnen: Scope und Queue kennt der
 * Aufrufer schon, und Anschluss, Herkunft und Ablauf stehen einmal am Kopf der
 * Spur statt an jeder Zeile.
 */
function publicTraceEntry(station: StoredTraceStation): ProjectQueueTraceEntry {
  return Object.freeze({
    sequence: station.sequence,
    station: station.station,
    attempt: station.attempt,
    workerId: station.workerId,
    failureCode: station.failureCode,
    spanId: station.spanId,
    occurredAt: station.occurredAt.toISOString(),
  });
}

/**
 * Eine Trefferzeile der Suche. Kein Wirt, und nicht weil er weggelassen wird:
 * Die erste Station einer Nachricht hat per CHECK keinen.
 */
function searchEntry(station: StoredTraceStation, queue: string): ProjectQueueTraceSearchEntry {
  return Object.freeze({
    messageId: station.messageId,
    queue,
    station: station.station,
    spanId: station.spanId,
    parentSpanId: station.parentSpanId,
    sourceMessageId: station.sourceMessageId,
    occurredAt: station.occurredAt.toISOString(),
  });
}

function clearLease(message: ProjectQueueMessage) {
  message.leaseWorkerId = null;
  message.leaseTokenHash = null;
  message.leaseExpiresAt = null;
}

function cloneQueue(queue: ProjectQueue): ProjectQueue {
  return { ...queue, createdAt: new Date(queue.createdAt), updatedAt: new Date(queue.updatedAt) };
}

function cloneMessage(message: ProjectQueueMessage): ProjectQueueMessage {
  return {
    ...message,
    payload: structuredClone(message.payload),
    availableAt: new Date(message.availableAt),
    createdAt: new Date(message.createdAt),
    leaseExpiresAt: message.leaseExpiresAt ? new Date(message.leaseExpiresAt) : null,
    completedAt: message.completedAt ? new Date(message.completedAt) : null,
    deadLetteredAt: message.deadLetteredAt ? new Date(message.deadLetteredAt) : null,
  };
}
