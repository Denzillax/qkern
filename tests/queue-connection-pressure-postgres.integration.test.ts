import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { ProjectQueueError, ProjectQueueService } from "@/lib/server/project-queues/service";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Was passiert, wenn der Verbindungspool leer ist.
 *
 * In Release 1.63 ist der Lastfall der Queue-Zertifizierung einmal in drei
 * Läufen gescheitert, mit einem `PersistenceError` beim Einreihen. Die Ursache
 * war keine Datenbank: `pg` meldet den Zeitablauf beim **Holen** einer
 * Verbindung ohne SQLSTATE, er landete deshalb im Sammelzweig — und der
 * Queue-Dienst hat daraus ein `QUEUE_CONFLICT` gemacht, die HTTP-Grenze eine
 * 409.
 *
 * Ein Aufrufer las damit: „jemand anderes war schneller." Die Warteschlange war
 * in Ordnung, die Abfrage nie gelaufen, und der Prozess hatte schlicht mehr
 * gleichzeitige Arbeit angenommen, als sein Pool tragen kann.
 *
 * Der Druck wird hier hergestellt, nicht abgewartet: ein Pool mit einer
 * Verbindung und einer sehr kurzen Wartezeit. Ein Fall, der auf eine
 * Zufallslast wartet, belegt nichts.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Queue connection pressure PostgreSQL certification", () => {
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

  let owner: SqlPool;
  const pools: SqlPool[] = [];

  function service(options: { max: number; connectionTimeoutMillis?: number }) {
    const pool = verifyDatabaseBoundary(createPostgresPool({
      connectionString: runtimeUrl!, ...options,
    }), "runtime");
    pools.push(pool);
    return new ProjectQueueService({
      repository: new PostgresProjectQueueRepository(new PostgresControlPlane(pool)),
    });
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `queue-pressure-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
      VALUES ($1,'Queue Pressure',$2,$3)`, [organizationId, `queue-pressure-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Queue Pressure',$3,'test','ready',$4)`,
    [projectId, organizationId, `queue-pressure-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`, [organizationId, projectId, `managed:${projectId}`]);
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([...pools.map((pool) => pool.end()), owner?.end()]);
  });

  it("names an exhausted pool instead of calling it a queue conflict", async () => {
    const roomy = service({ max: 6 });
    const queue = `pressure-${randomUUID().slice(0, 8)}`;
    await roomy.createQueue(admin, scope, { name: queue, maxPendingMessages: 400 });

    // Erst der Gegenbeweis: Mit genug Verbindungen laeuft derselbe Aufruf
    // durch. Ohne ihn koennte der Fall auch einen kaputten Aufbau belegen.
    await expect(roomy.enqueue(worker, scope, queue, { payload: { probe: "roomy" } }))
      .resolves.toMatchObject({ queue });

    const tight = service({ max: 1, connectionTimeoutMillis: 50 });
    const results = await Promise.allSettled(Array.from({ length: 60 }, (_, index) =>
      tight.enqueue(worker, scope, queue, { payload: { index } })));
    const rejected = results.filter((result) => result.status === "rejected");

    expect(rejected.length, "Der Pool war nicht unter Druck").toBeGreaterThan(0);
    for (const failure of rejected as PromiseRejectedResult[]) {
      const error = failure.reason as ProjectQueueError;
      expect(error).toBeInstanceOf(ProjectQueueError);
      // Der Kern: nicht `QUEUE_CONFLICT`. Die Warteschlange ist in Ordnung.
      expect(error.code).toBe("QUEUE_UNAVAILABLE");
      expect((error.cause as { code?: string; retryable?: boolean }).code).toBe("CONNECTION_UNAVAILABLE");
      expect((error.cause as { retryable?: boolean }).retryable).toBe(true);
    }
  }, 120_000);
});
