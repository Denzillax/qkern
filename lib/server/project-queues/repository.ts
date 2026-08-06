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
}

export class MemoryProjectQueueRepository implements ProjectQueueRepository {
  readonly durability = "ephemeral" as const;
  private readonly queues = new Map<string, ProjectQueue>();
  private readonly messages = new Map<string, ProjectQueueMessage>();
  private readonly locks = new Map<string, Promise<void>>();

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
  ) {
    return await this.exclusive(queue, async () => {
      this.assertQueue(principal, scope, queue);
      this.cleanupCompleted(queue, now);
      if (message.dedupeKeyHash && queue.dedupeWindowSeconds > 0) {
        const earliest = now.getTime() - queue.dedupeWindowSeconds * 1_000;
        const duplicate = [...this.messages.values()].find((candidate) => sameProjectQueueScope(candidate, scope) &&
          candidate.queueId === queue.id && candidate.dedupeKeyHash === message.dedupeKeyHash &&
          candidate.createdAt.getTime() >= earliest);
        if (duplicate) {
          await meter?.();
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
        return {
          id: message.id,
          queue: queue.name,
          payload: structuredClone(message.payload),
          attempt: message.attemptCount,
          leaseSequence: message.leaseSequence,
          leaseToken: lease.token,
          leaseExpiresAt: message.leaseExpiresAt.toISOString(),
          createdAt: message.createdAt.toISOString(),
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
      return { message: cloneMessage(replay), created: true };
    });
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
