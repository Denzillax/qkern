import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CronDispatcher } from "@/lib/server/compute/cron";
import { PostgresCronRepository } from "@/lib/server/compute/cron-postgres-repository";
import { CronScheduler } from "@/lib/server/compute/cron-scheduler";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";

/**
 * Cron gegen echtes PostgreSQL, bis in die Queue hinein.
 *
 * Der Nachweis fährt die ganze Kette: persistierte Definition → Scheduler →
 * Dispatcher → Queue. Entscheidend ist der Fall, in dem zwei Scheduler
 * dasselbe Vorkommen auslösen: Es darf genau eine Nachricht entstehen, und
 * zwar ohne Lease — allein über den Occurrence-Dedupe-Key der Queue.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Cron PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const admin: ProjectQueuePrincipal = {
    organizationId, actorRef: "cron-owner@qkern.test", role: "admin", subject: controlUser,
  };
  const service: ProjectQueuePrincipal = {
    organizationId, actorRef: "service-role:cron", role: "service_role", subject: "cron",
  };

  let owner: SqlPool;
  const pools: SqlPool[] = [];

  function instance() {
    const pool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    pools.push(pool);
    const plane = new PostgresControlPlane(pool);
    const queues = new ProjectQueueService({
      repository: new PostgresProjectQueueRepository(plane),
    });
    return {
      queues,
      repository: new PostgresCronRepository(plane),
      dispatcher: new CronDispatcher(queues),
    };
  }

  async function defineCron(queue: string, expression: string, lastDispatchedAt: Date | null) {
    const id = randomUUID();
    await owner.query(
      `INSERT INTO project_cron_definitions
         (id, organization_id, project_id, environment, name, expression, queue, payload,
          last_dispatched_at)
       VALUES ($1,$2,$3,'development',$4,$5,$6,$7,$8)`,
      [id, organizationId, projectId, `cron-${id.slice(0, 8)}`, expression, queue,
        { task: "run" }, lastDispatchedAt],
    );
    return id;
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `cron-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Cron Integration', $2, $3)`,
    [organizationId, `cron-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Cron', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `cron-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);
  });

  afterAll(async () => {
    await Promise.allSettled([...pools.map((pool) => pool.end()), owner?.end()]);
  });

  it("dispatches a due occurrence into the queue and advances the progress", async () => {
    const node = instance();
    const queue = `cron-jobs-${randomUUID().slice(0, 8)}`;
    await node.queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 3600 });

    const boundary = new Date("2026-08-04T12:05:00.000Z");
    const id = await defineCron(queue, "*/5 * * * *", new Date("2026-08-04T12:00:00.000Z"));

    const scheduler = new CronScheduler({
      repository: node.repository, dispatcher: node.dispatcher,
      now: () => new Date("2026-08-04T12:06:00.000Z"),
    });
    const result = await scheduler.run(service, scope);
    expect(result.dispatched).toBeGreaterThanOrEqual(1);

    const progress = await owner.query<{ last_dispatched_at: Date }>(
      "SELECT last_dispatched_at FROM project_cron_definitions WHERE id=$1", [id],
    );
    expect(new Date(progress.rows[0].last_dispatched_at).toISOString())
      .toBe(boundary.toISOString());

    const messages = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_queue_messages
        WHERE organization_id=$1 AND queue_id=(SELECT id FROM project_queues
          WHERE organization_id=$1 AND name=$2)`,
      [organizationId, queue],
    );
    expect(messages.rows[0]?.count).toBe(1);
  });

  it("produces exactly one message when two schedulers fire the same occurrence", async () => {
    // Der eigentliche Pruefpunkt: Einmaligkeit ohne Lease, allein ueber den
    // Occurrence-Dedupe-Key der Queue.
    const setup = instance();
    const queue = `cron-race-${randomUUID().slice(0, 8)}`;
    await setup.queues.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 3600 });
    await defineCron(queue, "*/5 * * * *", new Date("2026-08-04T12:00:00.000Z"));

    const schedulers = Array.from({ length: 4 }, () => {
      const node = instance();
      return new CronScheduler({
        repository: node.repository, dispatcher: node.dispatcher,
        onError: () => undefined,
        now: () => new Date("2026-08-04T12:06:00.000Z"),
      });
    });

    await Promise.all(schedulers.map((scheduler) => scheduler.run(service, scope)));

    const messages = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_queue_messages
        WHERE organization_id=$1 AND queue_id=(SELECT id FROM project_queues
          WHERE organization_id=$1 AND name=$2)`,
      [organizationId, queue],
    );
    expect(messages.rows[0]?.count).toBe(1);
  });

  it("refuses progress that moves backwards", async () => {
    // Ein Ruecksprung wuerde vergangene Vorkommen erneut ausloesen.
    const queue = `cron-back-${randomUUID().slice(0, 8)}`;
    const id = await defineCron(queue, "*/5 * * * *", new Date("2026-08-04T12:05:00.000Z"));

    await expect(owner.query(
      "UPDATE project_cron_definitions SET last_dispatched_at=$2 WHERE id=$1",
      [id, new Date("2026-08-04T11:00:00.000Z")],
    )).rejects.toMatchObject({ message: expect.stringContaining("must not move backwards") });
  });

  it("keeps the identity of a definition immutable", async () => {
    const queue = `cron-id-${randomUUID().slice(0, 8)}`;
    const id = await defineCron(queue, "*/5 * * * *", null);

    await expect(owner.query(
      "UPDATE project_cron_definitions SET project_id=$2 WHERE id=$1", [id, randomUUID()],
    )).rejects.toMatchObject({ message: expect.stringContaining("identity is immutable") });
  });

  it("hides definitions of a different organization", async () => {
    const queue = `cron-tenant-${randomUUID().slice(0, 8)}`;
    await defineCron(queue, "*/5 * * * *", null);

    const node = instance();
    const foreign = await node.repository.listActive(
      { ...service, organizationId: randomUUID() },
      { ...scope, organizationId: randomUUID() },
    );
    expect(foreign).toEqual([]);
  });
});
