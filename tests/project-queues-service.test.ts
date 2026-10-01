import { describe, expect, it } from "vitest";
import type {
  ProjectQueue,
  ProjectQueueMessage,
  ProjectQueuePrincipal,
  ProjectQueueScope,
} from "@/lib/server/project-queues/model";
import {
  MemoryProjectQueueRepository,
  type ProjectQueueMeter,
} from "@/lib/server/project-queues/repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";
import type { ProjectQueueTraceAnchor } from "@/lib/server/project-queues/trace";

/**
 * Memory-Port mit dem CHECK der echten Tabelle.
 *
 * `project_queue_messages_dedupe_pair` (Migration 0026) verlangt: entweder
 * beide Dedupe-Spalten leer, oder Verifikator **und** Frist gesetzt, und die
 * Frist echt nach `created_at`. Der Memory-Port kennt die Frist gar nicht, der
 * Fehler dieser Scheibe war darum in Unit-Tests unsichtbar und fiel erst gegen
 * echtes PostgreSQL auf. Hier steht dieselbe Bedingung einmal nach.
 */
class DedupePairCheckingRepository extends MemoryProjectQueueRepository {
  lastWritten: ProjectQueueMessage | null = null;

  override async enqueue(
    principal: ProjectQueuePrincipal,
    scope: ProjectQueueScope,
    queue: ProjectQueue,
    message: ProjectQueueMessage,
    now: Date,
    meter?: ProjectQueueMeter,
    // Der Anschluss an eine fremde Spur (2.121) muss durch: Ein Port, der ihn
    // auf dem Weg verliert, waere eine Attrappe, die den Fehler versteckt.
    trace?: ProjectQueueTraceAnchor | null,
  ) {
    // Genau die Rechnung des Postgres-Ports: ohne Fenster keine Frist.
    const dedupeExpiresAt = message.dedupeKeyHash && queue.dedupeWindowSeconds > 0
      ? new Date(now.getTime() + queue.dedupeWindowSeconds * 1_000)
      : null;
    const pair = (message.dedupeKeyHash === null && dedupeExpiresAt === null) ||
      (message.dedupeKeyHash !== null && dedupeExpiresAt !== null && dedupeExpiresAt > message.createdAt);
    if (!pair) {
      throw new Error('new row for relation "project_queue_messages" violates check constraint ' +
        '"project_queue_messages_dedupe_pair"');
    }
    this.lastWritten = message;
    return await super.enqueue(principal, scope, queue, message, now, meter, trace);
  }
}

const scope: ProjectQueueScope = {
  organizationId: "org-queues", projectId: "project-queues", environment: "development",
};

function principal(
  role: ProjectQueuePrincipal["role"],
  subject = role === "authenticated" ? "alice" : `${role}-principal`,
  organizationId = scope.organizationId,
): ProjectQueuePrincipal {
  return { organizationId, actorRef: `${role}:${subject}`, role, subject };
}

function fixture(options: { maxPayloadBytes?: number } = {}) {
  let now = new Date("2026-08-04T15:00:00.000Z");
  let id = 0;
  let token = 0;
  const repository = new MemoryProjectQueueRepository();
  const service = new ProjectQueueService({
    repository,
    now: () => new Date(now),
    id: () => `queue-record-${++id}`,
    leaseToken: () => `qk_lease_${String(++token).padStart(43, "A")}`,
    maxPayloadBytes: options.maxPayloadBytes,
  });
  return {
    service, repository,
    advance(milliseconds: number) { now = new Date(now.getTime() + milliseconds); },
    now: () => new Date(now),
  };
}

async function createQueue(service: ProjectQueueService, input: Parameters<ProjectQueueService["createQueue"]>[2] = {
  name: "orders",
}) {
  return await service.createQueue(principal("admin"), scope, input);
}

describe("Project Queues service", () => {
  it("creates one scoped queue atomically and exposes no organization data", async () => {
    const { service } = fixture();
    const concurrent = await Promise.allSettled([
      createQueue(service), createQueue(service),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")[0])
      .toMatchObject({ reason: { code: "QUEUE_CONFLICT" } });
    const queues = await service.listQueues(principal("admin"), scope);
    expect(queues).toHaveLength(1);
    expect(queues[0]).toMatchObject({
      name: "orders", enqueuePolicy: "authenticated", maxAttempts: 5,
      visibilityTimeoutSeconds: 30, retryBaseSeconds: 5, retryMaxSeconds: 300,
    });
    expect(queues[0]).not.toHaveProperty("organizationId");
  });

  it("enforces enqueue policies and complete tenant/project/environment isolation", async () => {
    const { service } = fixture();
    await createQueue(service);
    await service.createQueue(principal("admin"), scope, { name: "internal", enqueuePolicy: "service" });
    await expect(service.enqueue(principal("authenticated"), scope, "orders", { payload: { orderId: "1" } }))
      .resolves.toMatchObject({ queue: "orders", deduplicated: false });
    await expect(service.enqueue(principal("anon"), scope, "orders", { payload: {} }))
      .rejects.toMatchObject({ code: "QUEUE_ACCESS_DENIED" });
    await expect(service.enqueue(principal("authenticated"), scope, "internal", { payload: {} }))
      .rejects.toMatchObject({ code: "QUEUE_ACCESS_DENIED" });
    await expect(service.enqueue(principal("service_role"), scope, "internal", { payload: { task: "sync" } }))
      .resolves.toMatchObject({ queue: "internal" });

    const otherScope = { ...scope, organizationId: "org-other" };
    await expect(service.enqueue(
      principal("authenticated", "alice", otherScope.organizationId), otherScope, "orders", { payload: {} },
    )).rejects.toMatchObject({ code: "QUEUE_RESOURCE_NOT_FOUND" });
  });

  it("deduplicates concurrent enqueue requests without persisting the raw idempotency key", async () => {
    const { service } = fixture();
    await createQueue(service, { name: "payments", dedupeWindowSeconds: 600 });
    const worker = principal("service_role");
    const [first, second] = await Promise.all([
      service.enqueue(worker, scope, "payments", { payload: { payment: "p-1" }, dedupeKey: "secret-idempotency-key" }),
      service.enqueue(worker, scope, "payments", { payload: { payment: "p-1" }, dedupeKey: "secret-idempotency-key" }),
    ]);
    expect(first.id).toBe(second.id);
    expect([first.deduplicated, second.deduplicated].sort()).toEqual([false, true]);
    expect(JSON.stringify([first, second])).not.toContain("secret-idempotency-key");
  });

  it("enqueues into a queue without a dedupe window instead of breaking its dedupe pair", async () => {
    // Der Memory-Port kennt keinen CHECK; ohne diesen Spiegel faellt der Fehler
    // erst gegen echtes PostgreSQL auf. Der Spiegel bildet genau
    // `project_queue_messages_dedupe_pair` aus Migration 0026 nach und rechnet
    // die Frist so aus, wie es der Postgres-Port tut.
    const repository = new DedupePairCheckingRepository();
    const service = new ProjectQueueService({ repository });
    await service.createQueue(principal("admin"), scope, { name: "zero", dedupeWindowSeconds: 0 });
    const worker = principal("service_role");

    const first = await service.enqueue(worker, scope, "zero", {
      payload: { task: "a" }, dedupeKey: "cron:zero:1",
    });
    expect(first).toMatchObject({ queue: "zero", deduplicated: false });
    // Ohne Fenster wird kein Verifikator abgelegt: Ein Hash ohne Frist waere
    // eine Zeile, die die Queue weder deduplizieren noch je wieder aufraeumen
    // kann (der Sperrindex und der Loeschwaechter aus 0026 haengen an ihm).
    expect(repository.lastWritten?.dedupeKeyHash).toBeNull();

    // Und ohne Fenster dedupliziert nichts, auch nicht bei gleichem Schluessel.
    const second = await service.enqueue(worker, scope, "zero", {
      payload: { task: "b" }, dedupeKey: "cron:zero:1",
    });
    expect(second.deduplicated).toBe(false);
    expect(second.id).not.toBe(first.id);
  });

  it("deduplicates at the smallest and the largest accepted dedupe window", async () => {
    const built = fixture();
    const worker = principal("service_role");
    await createQueue(built.service, { name: "narrow", dedupeWindowSeconds: 1 });
    await createQueue(built.service, { name: "wide", dedupeWindowSeconds: 86_400 });

    const narrow = await built.service.enqueue(worker, scope, "narrow", {
      payload: { task: "a" }, dedupeKey: "boundary",
    });
    await expect(built.service.enqueue(worker, scope, "narrow", { payload: { task: "a" }, dedupeKey: "boundary" }))
      .resolves.toMatchObject({ id: narrow.id, deduplicated: true });
    // Eine Millisekunde hinter dem Fenster, nicht genau darauf: Der Memory-Port
    // vergleicht einschliessend, der Postgres-Port ueber `dedupe_expires_at >
    // now` ausschliessend. Genau auf der Kante urteilen sie verschieden, und
    // diese Kante ist nicht die Frage dieses Falls.
    built.advance(1_001);
    await expect(built.service.enqueue(worker, scope, "narrow", { payload: { task: "a" }, dedupeKey: "boundary" }))
      .resolves.toMatchObject({ deduplicated: false });

    const wide = await built.service.enqueue(worker, scope, "wide", {
      payload: { task: "a" }, dedupeKey: "boundary",
    });
    built.advance(86_399_000);
    await expect(built.service.enqueue(worker, scope, "wide", { payload: { task: "a" }, dedupeKey: "boundary" }))
      .resolves.toMatchObject({ id: wide.id, deduplicated: true });

    // Ueber dem Maximum bleibt es eine abgewiesene Eingabe, nicht ein Fenster.
    await expect(createQueue(built.service, { name: "too-wide", dedupeWindowSeconds: 86_401 }))
      .rejects.toMatchObject({ code: "QUEUE_INVALID_INPUT" });
  });

  it("retains a completed message until both retention and its dedupe window expire", async () => {
    const built = fixture();
    await createQueue(built.service, {
      name: "retained", retentionSeconds: 60, dedupeWindowSeconds: 120,
    });
    const worker = principal("service_role");
    const first = await built.service.enqueue(worker, scope, "retained", {
      payload: { task: "once" }, dedupeKey: "retention-boundary",
    });
    const claim = (await built.service.claim(worker, scope, "retained", { workerId: "worker-1" }))[0];
    await built.service.acknowledge(worker, scope, "retained", claim.id, {
      workerId: "worker-1", leaseToken: claim.leaseToken,
    });

    built.advance(61_000);
    await expect(built.service.enqueue(worker, scope, "retained", {
      payload: { task: "duplicate" }, dedupeKey: "retention-boundary",
    })).resolves.toMatchObject({ id: first.id, deduplicated: true });

    built.advance(60_000);
    await expect(built.service.enqueue(worker, scope, "retained", {
      payload: { task: "new" }, dedupeKey: "retention-boundary",
    })).resolves.toMatchObject({ deduplicated: false });
  });

  it("keeps scheduled jobs unavailable until their server-validated time", async () => {
    const built = fixture();
    await createQueue(built.service);
    await built.service.enqueue(principal("service_role"), scope, "orders", {
      payload: { orderId: "scheduled" }, scheduledAt: "2026-08-04T15:01:00.000Z",
    });
    await expect(built.service.claim(principal("service_role"), scope, "orders", {
      workerId: "worker-1",
    })).resolves.toEqual([]);
    built.advance(60_000);
    await expect(built.service.claim(principal("service_role"), scope, "orders", {
      workerId: "worker-1",
    })).resolves.toMatchObject([{ payload: { orderId: "scheduled" }, attempt: 1 }]);
  });

  it("claims in order and acknowledges only the exact active worker lease", async () => {
    const built = fixture();
    await createQueue(built.service);
    const worker = principal("service_role");
    await built.service.enqueue(worker, scope, "orders", { payload: { index: 1 } });
    await built.service.enqueue(worker, scope, "orders", { payload: { index: 2 } });
    const claims = await built.service.claim(worker, scope, "orders", { workerId: "worker-1", limit: 2 });
    expect(claims.map((claim) => claim.payload)).toEqual([{ index: 1 }, { index: 2 }]);
    expect(claims[0].leaseToken).toMatch(/^qk_lease_/);
    await expect(built.service.acknowledge(worker, scope, "orders", claims[0].id, {
      workerId: "worker-2", leaseToken: claims[0].leaseToken,
    })).rejects.toMatchObject({ code: "QUEUE_LEASE_LOST" });
    await expect(built.service.acknowledge(worker, scope, "orders", claims[0].id, {
      workerId: "worker-1", leaseToken: claims[0].leaseToken,
    })).resolves.toMatchObject({ status: "completed" });
    expect(await built.service.status(principal("admin"), scope, "orders"))
      .toMatchObject({ inFlight: 1, completed: 1 });
  });

  it("uses bounded exponential retries and dead-letters at the configured attempt ceiling", async () => {
    const built = fixture();
    await createQueue(built.service, {
      name: "deliveries", maxAttempts: 3, retryBaseSeconds: 2, retryMaxSeconds: 3,
    });
    const worker = principal("service_role");
    await built.service.enqueue(worker, scope, "deliveries", { payload: { delivery: "d-1" } });
    const first = (await built.service.claim(worker, scope, "deliveries", { workerId: "worker-1" }))[0];
    const failed1 = await built.service.fail(worker, scope, "deliveries", first.id, {
      workerId: "worker-1", leaseToken: first.leaseToken, failureCode: "DEPENDENCY_UNAVAILABLE",
    });
    expect(new Date(failed1.availableAt).getTime() - built.now().getTime()).toBe(2_000);
    expect(await built.service.claim(worker, scope, "deliveries", { workerId: "worker-1" })).toEqual([]);

    built.advance(2_000);
    const second = (await built.service.claim(worker, scope, "deliveries", { workerId: "worker-1" }))[0];
    const failed2 = await built.service.fail(worker, scope, "deliveries", second.id, {
      workerId: "worker-1", leaseToken: second.leaseToken, failureCode: "HANDLER_ERROR",
    });
    expect(new Date(failed2.availableAt).getTime() - built.now().getTime()).toBe(3_000);
    built.advance(3_000);
    const third = (await built.service.claim(worker, scope, "deliveries", { workerId: "worker-1" }))[0];
    await expect(built.service.fail(worker, scope, "deliveries", third.id, {
      workerId: "worker-1", leaseToken: third.leaseToken, failureCode: "HANDLER_TIMEOUT",
    })).resolves.toMatchObject({ status: "dead_lettered", attempt: 3 });
    expect(await built.service.status(principal("admin"), scope, "deliveries"))
      .toMatchObject({ available: 0, inFlight: 0, deadLettered: 1 });
  });

  it("lists redacted dead letters and replays one source exactly once", async () => {
    const built = fixture();
    await createQueue(built.service, { name: "operator-dlq", maxAttempts: 1 });
    const worker = principal("service_role");
    const receipt = await built.service.enqueue(worker, scope, "operator-dlq", {
      payload: { secret: "must-not-appear-in-dlq-list" },
    });
    const claim = (await built.service.claim(worker, scope, "operator-dlq", { workerId: "worker-1" }))[0];
    await built.service.fail(worker, scope, "operator-dlq", receipt.id, {
      workerId: "worker-1", leaseToken: claim.leaseToken, failureCode: "HANDLER_ERROR",
    });
    const listed = await built.service.listDeadLetters(principal("admin"), scope, "operator-dlq");
    expect(listed).toMatchObject([{
      id: receipt.id, attempt: 1, failureCode: "HANDLER_ERROR", replayed: false,
    }]);
    expect(JSON.stringify(listed)).not.toContain("must-not-appear-in-dlq-list");

    const [first, duplicate] = await Promise.all([
      built.service.replayDeadLetter(principal("admin"), scope, "operator-dlq", receipt.id),
      built.service.replayDeadLetter(principal("admin"), scope, "operator-dlq", receipt.id),
    ]);
    expect(first.id).toBe(duplicate.id);
    expect([first.deduplicated, duplicate.deduplicated].sort()).toEqual([false, true]);
    expect(await built.service.listDeadLetters(principal("admin"), scope, "operator-dlq"))
      .toMatchObject([{ replayed: true }]);
    expect(await built.service.status(principal("admin"), scope, "operator-dlq"))
      .toMatchObject({ available: 1, deadLettered: 1 });
  });

  it("fences expired leases, increments the claim generation and dead-letters exhausted work", async () => {
    const built = fixture();
    await createQueue(built.service, { name: "fenced", maxAttempts: 2, visibilityTimeoutSeconds: 5 });
    const worker = principal("service_role");
    await built.service.enqueue(worker, scope, "fenced", { payload: { task: "once" } });
    const first = (await built.service.claim(worker, scope, "fenced", { workerId: "worker-1" }))[0];
    built.advance(6_000);
    const second = (await built.service.claim(worker, scope, "fenced", { workerId: "worker-2" }))[0];
    expect(second).toMatchObject({ id: first.id, attempt: 2, leaseSequence: 2 });
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(built.service.acknowledge(worker, scope, "fenced", first.id, {
      workerId: "worker-1", leaseToken: first.leaseToken,
    })).rejects.toMatchObject({ code: "QUEUE_LEASE_LOST" });
    built.advance(6_000);
    expect(await built.service.status(principal("admin"), scope, "fenced"))
      .toMatchObject({ inFlight: 0, deadLettered: 1 });
  });

  it("renews one exact lease and rejects unsafe or oversized JSON payloads", async () => {
    const built = fixture({ maxPayloadBytes: 256 });
    await createQueue(built.service, { name: "renewable", visibilityTimeoutSeconds: 5 });
    const worker = principal("service_role");
    const receipt = await built.service.enqueue(worker, scope, "renewable", { payload: { task: "renew" } });
    const claim = (await built.service.claim(worker, scope, "renewable", { workerId: "worker-1" }))[0];
    built.advance(4_000);
    const renewed = await built.service.renewLease(worker, scope, "renewable", receipt.id, {
      workerId: "worker-1", leaseToken: claim.leaseToken,
    });
    expect(new Date(renewed.leaseExpiresAt).getTime() - built.now().getTime()).toBe(5_000);
    built.advance(4_000);
    await expect(built.service.acknowledge(worker, scope, "renewable", receipt.id, {
      workerId: "worker-1", leaseToken: claim.leaseToken,
    })).resolves.toMatchObject({ status: "completed" });

    await expect(built.service.enqueue(worker, scope, "renewable", { payload: { data: "x".repeat(300) } }))
      .rejects.toMatchObject({ code: "QUEUE_INVALID_INPUT" });
    await expect(built.service.enqueue(worker, scope, "renewable", {
      payload: JSON.parse('{"__proto__":"blocked"}'),
    })).rejects.toMatchObject({ code: "QUEUE_INVALID_INPUT" });
  });
});
