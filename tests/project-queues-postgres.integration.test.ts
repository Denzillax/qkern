import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";
import { ProjectQueueFunctionDispatch } from "@/lib/server/project-queues/function-dispatch";
import { ProjectQueueHostRuntime } from "@/lib/server/project-queues/host-runtime";
import { ComputeDefinitionError } from "@/lib/server/compute/definitions";
import type { ProjectQueueJson } from "@/lib/server/project-queues/model";
import type { FunctionInvocationResult } from "@/lib/server/compute/model";

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Project Queues PostgreSQL certification", () => {
  let owner: SqlPool;
  let runtime: SqlPool;
  let repository: PostgresProjectQueueRepository;
  let service: ProjectQueueService;
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const admin: ProjectQueuePrincipal = {
    organizationId, actorRef: "queue-owner@qkern.test", role: "admin", subject: controlUser,
  };
  const worker: ProjectQueuePrincipal = {
    organizationId, actorRef: "service-role:queue-worker", role: "service_role", subject: "queue-worker",
  };

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    runtime = verifyDatabaseBoundary(createPostgresPool({ connectionString: runtimeUrl!, max: 8 }), "runtime");
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `project-queues-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Project Queues Integration', $2, $3)`,
    [organizationId, `project-queues-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Project Queues', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `project-queues-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);
    repository = new PostgresProjectQueueRepository(new PostgresControlPlane(runtime));
    service = new ProjectQueueService({ repository });
  });

  afterAll(async () => {
    // Nothing is deleted here. audit_logs is append-only by design, and
    // organizations cannot be removed while audit entries reference them.
    // Every run uses fresh random identifiers, and the certification stack is
    // a disposable container, so residue is expected rather than a leak.
    await Promise.all([owner?.end(), runtime?.end()]);
  });

  it("persists only the dedupe verifier and returns the same durable receipt", async () => {
    await service.createQueue(admin, scope, { name: "durable-dedupe", dedupeWindowSeconds: 600 });
    const first = await service.enqueue(worker, scope, "durable-dedupe", {
      payload: { payment: "p-1" }, dedupeKey: "raw-secret-idempotency-key",
    });
    const replay = await service.enqueue(worker, scope, "durable-dedupe", {
      payload: { payment: "changed-but-deduplicated" }, dedupeKey: "raw-secret-idempotency-key",
    });
    expect(replay).toMatchObject({ id: first.id, deduplicated: true });
    const stored = await owner.query<{ dedupe_key_hash: string; payload: unknown }>(
      "SELECT dedupe_key_hash,payload FROM project_queue_messages WHERE id=$1", [first.id],
    );
    expect(stored.rows[0]?.dedupe_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored.rows[0])).not.toContain("raw-secret-idempotency-key");
  });

  it("claims each ready row at most once across concurrent workers", async () => {
    await service.createQueue(admin, scope, { name: "claim-race" });
    await Promise.all(Array.from({ length: 4 }, (_, index) => service.enqueue(worker, scope, "claim-race", {
      payload: { index },
    })));
    const [left, right] = await Promise.all([
      service.claim(worker, scope, "claim-race", { workerId: "worker-left", limit: 4 }),
      service.claim(worker, scope, "claim-race", { workerId: "worker-right", limit: 4 }),
    ]);
    const ids = [...left, ...right].map((claim) => claim.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("keeps lease verifiers durable and fences the wrong or stale worker", async () => {
    await service.createQueue(admin, scope, { name: "lease-fence", visibilityTimeoutSeconds: 5 });
    const receipt = await service.enqueue(worker, scope, "lease-fence", { payload: { task: "once" } });
    const claim = (await service.claim(worker, scope, "lease-fence", { workerId: "worker-one" }))[0];
    const verifier = await owner.query<{ lease_token_hash: string }>(
      "SELECT lease_token_hash FROM project_queue_messages WHERE id=$1", [receipt.id],
    );
    expect(verifier.rows[0]?.lease_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier.rows[0]?.lease_token_hash).not.toBe(claim.leaseToken);
    await expect(service.acknowledge(worker, scope, "lease-fence", receipt.id, {
      workerId: "worker-two", leaseToken: claim.leaseToken,
    })).rejects.toMatchObject({ code: "QUEUE_LEASE_LOST" });
    const restarted = new ProjectQueueService({
      repository: new PostgresProjectQueueRepository(new PostgresControlPlane(runtime)),
    });
    await expect(restarted.acknowledge(worker, scope, "lease-fence", receipt.id, {
      workerId: "worker-one", leaseToken: claim.leaseToken,
    })).resolves.toMatchObject({ status: "completed" });
  });

  it("persists one audited replay binding for concurrent dead-letter requests", async () => {
    await service.createQueue(admin, scope, { name: "dlq-replay", maxAttempts: 1 });
    const receipt = await service.enqueue(worker, scope, "dlq-replay", { payload: { task: "repair" } });
    const claim = (await service.claim(worker, scope, "dlq-replay", { workerId: "worker-dlq" }))[0];
    await service.fail(worker, scope, "dlq-replay", receipt.id, {
      workerId: "worker-dlq", leaseToken: claim.leaseToken, failureCode: "HANDLER_ERROR",
    });
    const [left, right] = await Promise.all([
      service.replayDeadLetter(admin, scope, "dlq-replay", receipt.id),
      service.replayDeadLetter(admin, scope, "dlq-replay", receipt.id),
    ]);
    expect(left.id).toBe(right.id);
    expect([left.deduplicated, right.deduplicated].sort()).toEqual([false, true]);
    const bindings = await owner.query<{ count: number }>(`SELECT count(*)::int AS count
      FROM project_queue_messages WHERE replayed_from_message_id=$1`, [receipt.id]);
    expect(bindings.rows[0]?.count).toBe(1);
  });

  it("lets tenant RLS hide every queue from a different organization", async () => {
    const otherOrganizationId = randomUUID();
    await expect(repository.listQueues({
      organizationId: otherOrganizationId,
      actorRef: "admin:other-tenant",
      role: "admin",
      subject: randomUUID(),
    }, { ...scope, organizationId: otherOrganizationId })).resolves.toEqual([]);
  });
});

/**
 * Der Wirt verarbeitet wirklich — gegen echtes PostgreSQL.
 *
 * `ProjectQueueWorker` war seit Alpha 1 gebaut und getestet, und kein Prozess
 * startete ihn: Nachrichten liessen sich einreihen, niemand nahm sie heraus.
 * Gefunden hat das der Erreichbarkeitsvertrag, nicht Handarbeit.
 *
 * Gemessen wird deshalb die Wirkung: Nach einem echten `enqueue` ist die
 * Nachricht verarbeitet und die Function gerufen — ohne dass der Test selbst
 * `runOnce` aufruft. Die Sandbox ist eigens zertifiziert; hier steht der Weg
 * von der Queue zur Function auf dem Pruefstand.
 */
describe.runIf(enabled)("Project queue host PostgreSQL certification", () => {
  let owner2: SqlPool;
  let runtime2: SqlPool;
  let service2: ProjectQueueService;

  const controlUser2 = randomUUID();
  const org2 = randomUUID();
  const project2 = randomUUID();
  const scope2 = { organizationId: org2, projectId: project2, environment: "development" as const };
  const admin2: ProjectQueuePrincipal = {
    organizationId: org2, actorRef: "host-owner@qkern.test", role: "admin", subject: controlUser2,
  };
  const service_role2: ProjectQueuePrincipal = {
    organizationId: org2, actorRef: "service-role:host", role: "service_role", subject: "host",
  };

  beforeAll(async () => {
    owner2 = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    runtime2 = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 6 }), "runtime",
    );
    await owner2.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser2, `queue-host-${controlUser2}@qkern.test`]);
    await owner2.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Queue Host', $2, $3)`, [org2, `queue-host-${org2}`, controlUser2]);
    await owner2.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Queue Host', $3, 'test', 'ready', $4)`,
    [project2, org2, `queue-host-${project2}`, controlUser2]);
    await owner2.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [org2, project2, `managed:${project2}`]);
    service2 = new ProjectQueueService({
      repository: new PostgresProjectQueueRepository(new PostgresControlPlane(runtime2)),
    });
  });

  afterAll(async () => {
    await Promise.allSettled([owner2?.end(), runtime2?.end()]);
  });

  /**
   * Ruft den Wirt mit einer festen Rundenzahl statt endlos. Eine echte
   * Endlosschleife waere in einem Test nur ueber einen Timeout zu beenden, und
   * ein Timeout ist keine Zusage.
   */
  function host(
    queue: string,
    functionName: string,
    invoke: (name: string, payload: ProjectQueueJson) => Promise<FunctionInvocationResult>,
  ) {
    const handler = new ProjectQueueFunctionDispatch({
      functions: {
        invoke: (_principal: unknown, _scope: unknown, name: string, payload: ProjectQueueJson) =>
          invoke(name, payload),
      } as never,
      principal: service_role2,
      scope: { organizationId: org2, projectId: project2, environment: "development" },
      functionName,
    });
    return new ProjectQueueHostRuntime({
      service: service2,
      entries: [{
        binding: { ...scope2, queue, functionName },
        handler, principal: service_role2, workerId: `host-${randomUUID()}`,
      }],
      idleDelayMs: 10, errorDelayMs: 10, maxIterations: 4,
    });
  }

  it("consumes an enqueued message and calls the function", async () => {
    const calls: ProjectQueueJson[] = [];
    await service2.createQueue(admin2, scope2, { name: "host-happy" });
    const receipt = await service2.enqueue(service_role2, scope2, "host-happy", {
      payload: { order: "o-1" },
    });

    await host("host-happy", "settle-order", async (name, payload) => {
      expect(name).toBe("settle-order");
      calls.push(payload);
      return { statusCode: 200, headers: {}, body: { ok: true } };
    }).run();

    // Die Nachricht ist verarbeitet, ohne dass dieser Test `runOnce` gerufen
    // haette — genau das war bis 1.42 unmoeglich.
    expect(calls).toEqual([{ order: "o-1" }]);
    expect(receipt.id).toBeTruthy();
    const status = await service2.status(admin2, scope2, "host-happy");
    expect(status.completed).toBe(1);
    expect(status.available + status.inFlight).toBe(0);
  });

  it("retries when the function is unavailable", async () => {
    await service2.createQueue(admin2, scope2, { name: "host-unavailable" });
    const receipt = await service2.enqueue(service_role2, scope2, "host-unavailable", {
      payload: { order: "o-2" },
    });

    let attempts = 0;
    await host("host-unavailable", "missing-function", async () => {
      attempts += 1;
      throw new ComputeDefinitionError("COMPUTE_NOT_FOUND");
    }).run();

    // Eine fehlende Function ist ein Zustand der Umgebung, kein Fehler der
    // Nachricht: Sie bleibt erhalten und wird spaeter erneut versucht.
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(receipt.id).toBeTruthy();
    const status = await service2.status(admin2, scope2, "host-unavailable");
    expect(status.completed).toBe(0);
    expect(status.available + status.scheduled + status.deadLettered).toBe(1);
  });

  it("keeps a foreign queue untouched", async () => {
    await service2.createQueue(admin2, scope2, { name: "host-mine" });
    await service2.createQueue(admin2, scope2, { name: "host-other" });
    const mine = await service2.enqueue(service_role2, scope2, "host-mine", { payload: { n: 1 } });
    const other = await service2.enqueue(service_role2, scope2, "host-other", { payload: { n: 2 } });

    const seen: ProjectQueueJson[] = [];
    await host("host-mine", "only-mine", async (_name, payload) => {
      seen.push(payload);
      return { statusCode: 200, headers: {}, body: { ok: true } };
    }).run();

    // Eine Bindung bedient genau ihre Queue. Sonst zoege ein Wirt Nachrichten
    // aus Queues, die ihm niemand gegeben hat.
    expect(seen).toEqual([{ n: 1 }]);
    expect(mine.id).not.toBe(other.id);
    expect((await service2.status(admin2, scope2, "host-mine")).completed).toBe(1);
    const untouched = await service2.status(admin2, scope2, "host-other");
    expect(untouched.completed).toBe(0);
    expect(untouched.available).toBe(1);
  });
});
