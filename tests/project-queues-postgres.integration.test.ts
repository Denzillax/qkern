import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";

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
    if (owner) await owner.query("DELETE FROM users WHERE id = $1", [controlUser]);
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
