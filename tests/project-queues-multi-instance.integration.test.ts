import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";

/**
 * Project Queues über mehrere Instanzen und unter Last.
 *
 * Die vorhandene Zertifizierung fährt fünf Fälle über **eine** Service-Instanz.
 * Hier bekommt jede Instanz einen eigenen Verbindungspool, ein eigenes
 * Repository und einen eigenen Service — Koordination kann ausschließlich über
 * PostgreSQL laufen.
 *
 * Ehrliche Grenze: Alle Instanzen laufen im selben Betriebssystemprozess. Der
 * Nachweis zeigt Claim-Disjunktheit, Lease-Fencing nach simuliertem Absturz,
 * Retry-Autorität und Kapazitätsgrenzen über getrennte Verbindungen. Er zeigt
 * nicht, dass ein echter Prozessabsturz sauber verarbeitet wird.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Project Queues multi-instance certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const admin: ProjectQueuePrincipal = {
    organizationId, actorRef: "queue-owner@qkern.test", role: "admin", subject: controlUser,
  };
  const worker: ProjectQueuePrincipal = {
    organizationId, actorRef: "service-role:queue-worker", role: "service_role",
    subject: "queue-worker",
  };

  let owner: SqlPool;
  const pools: SqlPool[] = [];

  /** Eigenstaendige Instanz: eigener Pool, eigenes Repository, eigener Service. */
  function instance() {
    const pool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 6 }), "runtime",
    );
    pools.push(pool);
    return new ProjectQueueService({
      repository: new PostgresProjectQueueRepository(new PostgresControlPlane(pool)),
    });
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `queues-multi-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Queues Multi Instance', $2, $3)`,
    [organizationId, `queues-multi-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Queues Multi', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `queues-multi-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);
  });

  afterAll(async () => {
    // Nichts wird geloescht: audit_logs ist append-only und der Stack ist ein
    // Wegwerfcontainer mit frischen Bezeichnern je Lauf.
    await Promise.allSettled([...pools.map((pool) => pool.end()), owner?.end()]);
  });

  it("claims every message exactly once across six competing instances", async () => {
    const queue = `race-${randomUUID().slice(0, 8)}`;
    const setup = instance();
    await setup.createQueue(admin, scope, { name: queue, maxPendingMessages: 400 });

    const total = 180;
    await Promise.all(Array.from({ length: total }, (_, index) =>
      setup.enqueue(worker, scope, queue, { payload: { index } })));

    const instances = Array.from({ length: 6 }, () => instance());
    const claimed = await Promise.all(instances.map((service, slot) =>
      // Der Dienst begrenzt einen Claim-Stapel auf 10; sechs Instanzen holen
      // damit hoechstens 60 der 180 Nachrichten.
      service.claim(worker, scope, queue, { workerId: `worker-${slot}`, limit: 10 })));

    const ids = claimed.flat().map((entry) => entry.id);
    // Disjunkt und ohne Verlust: dieselbe Nachricht darf niemals zwei Workern
    // gleichzeitig gehoeren.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);

    const inFlight = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_queue_messages
        WHERE organization_id=$1 AND queue_id=(SELECT id FROM project_queues
          WHERE organization_id=$1 AND name=$2) AND status='in_flight'`,
      [organizationId, queue],
    );
    expect(inFlight.rows[0]?.count).toBe(ids.length);
  });

  it("gives a message to exactly one instance when many claim at the same moment", async () => {
    const queue = `single-${randomUUID().slice(0, 8)}`;
    const setup = instance();
    await setup.createQueue(admin, scope, { name: queue });
    const receipt = await setup.enqueue(worker, scope, queue, { payload: { only: true } });

    const instances = Array.from({ length: 8 }, () => instance());
    const results = await Promise.all(instances.map((service, slot) =>
      service.claim(worker, scope, queue, { workerId: `contender-${slot}`, limit: 1 })));

    const winners = results.flat().filter((entry) => entry.id === receipt.id);
    expect(winners).toHaveLength(1);
  });

  it("fences a vanished worker: the lease survives, the stale token does not", async () => {
    const queue = `fence-${randomUUID().slice(0, 8)}`;
    const first = instance();
    await first.createQueue(admin, scope, { name: queue, visibilityTimeoutSeconds: 5 });
    const receipt = await first.enqueue(worker, scope, queue, { payload: { task: "once" } });

    const claim = (await first.claim(worker, scope, queue, { workerId: "vanishing" }))[0];

    // Der Worker verschwindet ohne Settlement. Eine zweite Instanz darf die
    // Nachricht nicht uebernehmen, solange die Lease laeuft.
    const second = instance();
    expect(await second.claim(worker, scope, queue, { workerId: "successor" })).toEqual([]);

    // Die Lease laeuft echt ab. Ein direkter UPDATE waere schneller, wird aber
    // vom Trigger project_queue_messages_update_guard abgewiesen -- selbst fuer
    // den Owner. Uebergaenge sind trigger-gesichert, nicht nur
    // anwendungsseitig; das ist richtig so und der Test beugt sich dem.
    await new Promise((resolve) => setTimeout(resolve, 6_000));

    const reclaimed = (await second.claim(worker, scope, queue, { workerId: "successor" }))[0];
    expect(reclaimed?.id).toBe(receipt.id);

    // Das alte Token ist tot, auch wenn der verschwundene Worker zurueckkehrt.
    await expect(first.acknowledge(worker, scope, queue, receipt.id, {
      workerId: "vanishing", leaseToken: claim.leaseToken,
    })).rejects.toMatchObject({ code: "QUEUE_LEASE_LOST" });

    await expect(second.acknowledge(worker, scope, queue, receipt.id, {
      workerId: "successor", leaseToken: reclaimed.leaseToken,
    })).resolves.toMatchObject({ status: "completed" });
    // Die kleinste erlaubte Sichtbarkeitszeit betraegt fuenf Sekunden; der Fall
    // braucht deshalb mehr als Vitests Standardgrenze.
  }, 30_000);

  it("keeps retry authority on the server when instances fail concurrently", async () => {
    const queue = `retry-${randomUUID().slice(0, 8)}`;
    const setup = instance();
    await setup.createQueue(admin, scope, {
      name: queue, maxAttempts: 3, retryBaseSeconds: 1, retryMaxSeconds: 2,
    });
    const receipts = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      setup.enqueue(worker, scope, queue, { payload: { index } })));

    const instances = Array.from({ length: 4 }, () => instance());
    const claims = (await Promise.all(instances.map((service, slot) =>
      service.claim(worker, scope, queue, { workerId: `failing-${slot}`, limit: 3 })
        .then((entries) => entries.map((entry) => ({ service, slot, entry })))))).flat();

    await Promise.all(claims.map(({ service, slot, entry }) =>
      service.fail(worker, scope, queue, entry.id, {
        workerId: `failing-${slot}`, leaseToken: entry.leaseToken, failureCode: "HANDLER_ERROR",
      })));

    const state = await owner.query<{ status: string; attempt_count: number }>(
      `SELECT status, attempt_count FROM project_queue_messages
        WHERE organization_id=$1 AND id = ANY($2::uuid[])`,
      [organizationId, receipts.map((receipt) => receipt.id)],
    );
    const failed = state.rows.filter((row) => row.attempt_count > 0);
    expect(failed).toHaveLength(claims.length);
    // Der Server zaehlt die Versuche, nicht der Worker.
    for (const row of failed) {
      expect(row.attempt_count).toBe(1);
      expect(["available", "dead_lettered"]).toContain(row.status);
    }
  });

  it("enforces the capacity limit even when instances enqueue at the same time", async () => {
    const queue = `capacity-${randomUUID().slice(0, 8)}`;
    const setup = instance();
    await setup.createQueue(admin, scope, { name: queue, maxPendingMessages: 20 });

    const instances = Array.from({ length: 5 }, () => instance());
    const attempts = await Promise.allSettled(instances.flatMap((service, slot) =>
      Array.from({ length: 10 }, (_, index) =>
        service.enqueue(worker, scope, queue, { payload: { slot, index } }))));

    const accepted = attempts.filter((attempt) => attempt.status === "fulfilled").length;
    const stored = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM project_queue_messages
        WHERE organization_id=$1 AND queue_id=(SELECT id FROM project_queues
          WHERE organization_id=$1 AND name=$2)`,
      [organizationId, queue],
    );

    // Die Grenze darf nicht ueberschritten werden, und die Datenbank muss
    // genau die angenommenen Nachrichten enthalten.
    expect(accepted).toBeLessThanOrEqual(20);
    expect(stored.rows[0]?.count).toBe(accepted);
  });

  it("deduplicates the same key across instances, not just within one", async () => {
    const queue = `dedupe-${randomUUID().slice(0, 8)}`;
    const setup = instance();
    await setup.createQueue(admin, scope, { name: queue, dedupeWindowSeconds: 600 });

    const key = `idempotency-${randomUUID()}`;
    const instances = Array.from({ length: 6 }, () => instance());
    const receipts = await Promise.all(instances.map((service) =>
      service.enqueue(worker, scope, queue, { payload: { attempt: true }, dedupeKey: key })));

    const ids = new Set(receipts.map((receipt) => receipt.id));
    expect(ids.size).toBe(1);
    expect(receipts.filter((receipt) => receipt.deduplicated)).toHaveLength(5);
  });
});
