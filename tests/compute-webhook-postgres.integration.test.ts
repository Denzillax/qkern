import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebhookOutbox, WebhookOutboxError } from "@/lib/server/compute/webhook-outbox";
import { PostgresWebhookOutboxRepository } from "@/lib/server/compute/webhook-postgres-repository";
import { WebhookRetentionRuntime } from "@/lib/server/compute/webhook-retention-runtime";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Webhook-Outbox gegen echtes PostgreSQL, über mehrere Instanzen.
 *
 * Dasselbe Muster wie bei Project Queues, deshalb dieselben Prüfpunkte:
 * disjunkte Claims, exakte Lease-Bindung, serverberechnetes Backoff und Dead
 * Letter. Der Nachweis ist nötig, weil das Muster hier neu verdrahtet ist —
 * dass es bei Queues hält, sagt nichts über diese Tabellen.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Webhook outbox PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };

  let owner: SqlPool;
  const pools: SqlPool[] = [];

  function instance(overrides = {}) {
    const pool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 5 }), "runtime",
    );
    pools.push(pool);
    return new WebhookOutbox({
      repository: new PostgresWebhookOutboxRepository(new PostgresControlPlane(pool)),
      ...overrides,
    });
  }

  async function defineWebhook(maxAttempts = 5) {
    const id = randomUUID();
    await owner.query(
      `INSERT INTO project_webhooks
         (id, organization_id, project_id, environment, name, url, event_types,
          signing_secret_ref, max_attempts)
       VALUES ($1,$2,$3,'development',$4,$5,$6,$7,$8)`,
      [id, organizationId, projectId, `hook-${id.slice(0, 8)}`,
        "https://receiver.example.com/hooks", ["order.created"], "vault:webhook/test",
        maxAttempts],
    );
    return id;
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `webhook-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Webhook Integration', $2, $3)`,
    [organizationId, `webhook-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Webhooks', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `webhook-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);
  });

  afterAll(async () => {
    await Promise.allSettled([...pools.map((pool) => pool.end()), owner?.end()]);
  });

  /**
   * Holt gezielt die eigene Zustellung. Die Outbox ist FIFO ueber den ganzen
   * Scope: ein einfacher claim liefert die aelteste faellige, also womoeglich
   * die eines frueheren Falls. Das ist richtiges Verhalten und der Test muss
   * sich danach richten, statt Reihenfolge anzunehmen.
   */
  async function claimOwn(service: WebhookOutbox, deliveryId: string, workerId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const claims = await service.claim(scope, { workerId, limit: 10 });
      const own = claims.find((claim) => claim.id === deliveryId);
      if (own) return own;
      if (claims.length === 0) break;
    }
    throw new Error("own delivery was not claimable");
  }

  it("persists a delivery and hands it to exactly one of many claimants", async () => {
    const webhookId = await defineWebhook();
    const setup = instance();
    const delivery = await setup.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { id: 1 },
    });

    const instances = Array.from({ length: 6 }, () => instance());
    const claims = (await Promise.all(instances.map((service, slot) =>
      service.claim(scope, { workerId: `hook-worker-${slot}`, limit: 1 })))).flat();

    const winners = claims.filter((claim) => claim.id === delivery.id);
    expect(winners).toHaveLength(1);
    expect(winners[0].attemptCount).toBe(1);
  });

  it("stores only the lease verifier, never the raw token", async () => {
    const webhookId = await defineWebhook();
    const service = instance();
    const delivery = await service.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { id: 2 },
    });
    const claim = await claimOwn(service, delivery.id, "verifier-check");

    const stored = await owner.query<{ lease_token_hash: string }>(
      "SELECT lease_token_hash FROM project_webhook_deliveries WHERE id=$1", [delivery.id],
    );
    expect(stored.rows[0]?.lease_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.lease_token_hash).not.toBe(claim.leaseToken);
  });

  it("refuses a settlement from the wrong worker or a stale token", async () => {
    const webhookId = await defineWebhook();
    const service = instance();
    const delivery = await service.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { id: 3 },
    });
    const claim = await claimOwn(service, delivery.id, "rightful");

    await expect(service.acknowledge(scope, delivery.id, {
      workerId: "impostor", leaseToken: claim.leaseToken,
    })).rejects.toBeInstanceOf(WebhookOutboxError);

    await expect(service.acknowledge(scope, delivery.id, {
      workerId: "rightful", leaseToken: "b".repeat(43),
    })).rejects.toBeInstanceOf(WebhookOutboxError);

    await expect(service.acknowledge(scope, delivery.id, {
      workerId: "rightful", leaseToken: claim.leaseToken,
    })).resolves.toMatchObject({ status: "delivered" });
  });

  it("schedules a retry with a server-computed delay", async () => {
    const webhookId = await defineWebhook();
    const service = instance({ retryBaseMs: 60_000, retryMaxMs: 600_000 });
    const delivery = await service.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { id: 4 },
    });
    const claim = await claimOwn(service, delivery.id, "retrying");

    await service.fail(scope, delivery.id, {
      webhookId, workerId: "retrying", leaseToken: claim.leaseToken,
      failureCode: "WEBHOOK_TIMEOUT", attemptCount: claim.attemptCount,
    });

    const state = await owner.query<{ status: string; available_at: Date; created_at: Date }>(
      "SELECT status, available_at, created_at FROM project_webhook_deliveries WHERE id=$1",
      [delivery.id],
    );
    expect(state.rows[0]?.status).toBe("pending");
    // Der Zusteller bestimmt die Wartezeit nicht; sie kommt vom Server.
    expect(new Date(state.rows[0].available_at).getTime())
      .toBeGreaterThan(new Date(state.rows[0].created_at).getTime());
  });

  it("dead-letters once the attempt limit of the definition is reached", async () => {
    const webhookId = await defineWebhook(1);
    const service = instance();
    const delivery = await service.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { id: 5 },
    });
    const claim = await claimOwn(service, delivery.id, "final");

    await service.fail(scope, delivery.id, {
      webhookId, workerId: "final", leaseToken: claim.leaseToken,
      failureCode: "WEBHOOK_REJECTED", attemptCount: claim.attemptCount,
    });

    const state = await owner.query<{ status: string; dead_lettered_at: Date | null }>(
      "SELECT status, dead_lettered_at FROM project_webhook_deliveries WHERE id=$1", [delivery.id],
    );
    expect(state.rows[0]?.status).toBe("dead_lettered");
    expect(state.rows[0]?.dead_lettered_at).not.toBeNull();
  });

  it("keeps the payload of a delivery immutable", async () => {
    // Sonst koennte ein Wiederholungsversuch etwas anderes senden als der
    // erste, und die Signatur wuerde eine andere Nachricht bestaetigen.
    const webhookId = await defineWebhook();
    const delivery = await instance().enqueue(scope, {
      webhookId, eventType: "order.created", payload: { id: 6 },
    });

    await expect(owner.query(
      `UPDATE project_webhook_deliveries SET payload='{"tampered":true}'::jsonb WHERE id=$1`,
      [delivery.id],
    )).rejects.toMatchObject({ message: expect.stringContaining("content is immutable") });
  });

  it("keeps a settled delivery final", async () => {
    const webhookId = await defineWebhook();
    const service = instance();
    const delivery = await service.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { id: 7 },
    });
    const claim = await claimOwn(service, delivery.id, "settler");
    await service.acknowledge(scope, delivery.id, {
      workerId: "settler", leaseToken: claim.leaseToken,
    });

    await expect(owner.query(
      "UPDATE project_webhook_deliveries SET status='pending' WHERE id=$1", [delivery.id],
    )).rejects.toMatchObject({ message: expect.stringContaining("is final") });
  });

  it("hides deliveries of a different organization", async () => {
    const webhookId = await defineWebhook();
    await instance().enqueue(scope, {
      webhookId, eventType: "order.created", payload: { id: 8 },
    });

    const foreign = instance();
    const claims = await foreign.claim(
      { ...scope, organizationId: randomUUID() }, { workerId: "outsider" },
    );
    expect(claims).toEqual([]);
  });
});

/**
 * Aufbewahrung abgeschlossener Zustellungen gegen echtes PostgreSQL.
 *
 * `project_webhook_deliveries` wuchs seit Release 1.19 unbegrenzt. Gemessen wird
 * hier die Wirkung: Was abgeschlossen und alt ist, verschwindet; was noch
 * aussteht, bleibt — unabhaengig von seinem Alter.
 */
describe.runIf(enabled)("Webhook retention PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };

  let owner: SqlPool;
  let runtimePool: SqlPool;
  let repository: PostgresWebhookOutboxRepository;
  let webhookId: string;

  async function delivery(status: string, ageDays: number) {
    const id = randomUUID();
    const stamp = status === "delivered" ? "delivered_at" : "dead_lettered_at";
    const extra = ["delivered", "dead_lettered"].includes(status)
      ? `, ${stamp} = now() - ($6 || ' days')::interval` : "";
    await owner.query(
      `INSERT INTO project_webhook_deliveries
         (id, organization_id, project_id, environment, webhook_id, event_type, payload,
          occurred_at, status, attempt_count, available_at, created_at${extra ? `, ${stamp}` : ""})
       VALUES ($1,$2,$3,'development',$4,'order.created','{}', now(), $5, 1, now(), now()`
       + (extra ? `, now() - ($6 || ' days')::interval)` : ")"),
      extra
        ? [id, organizationId, projectId, webhookId, status, String(ageDays)]
        : [id, organizationId, projectId, webhookId, status],
    );
    return id;
  }

  async function remaining() {
    const result = await owner.query<{ status: string; count: string }>(
      `SELECT status, count(*)::text AS count FROM project_webhook_deliveries
        WHERE organization_id=$1 AND project_id=$2 GROUP BY status`,
      [organizationId, projectId],
    );
    return new Map(result.rows.map((row) => [row.status, Number(row.count)]));
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    runtimePool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `retention-hook-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Webhook Retention', $2, $3)`,
    [organizationId, `hook-retention-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Webhook Retention', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `hook-retention-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);

    webhookId = randomUUID();
    await owner.query(
      `INSERT INTO project_webhooks
         (id, organization_id, project_id, environment, name, url, event_types,
          signing_secret_ref, max_attempts)
       VALUES ($1,$2,$3,'development','retention','https://receiver.example.com/hooks',
               $4,'vault:webhook/test',5)`,
      [webhookId, organizationId, projectId, ["order.created"]],
    );
    repository = new PostgresWebhookOutboxRepository(new PostgresControlPlane(runtimePool));
  });

  afterAll(async () => {
    await Promise.allSettled([owner?.end(), runtimePool?.end()]);
  });

  it("removes what is finished and old, and never what is still waiting", async () => {
    await delivery("delivered", 30);
    await delivery("delivered", 1);
    await delivery("pending", 0);

    const runtime = new WebhookRetentionRuntime({
      repository, scopes: [scope],
      deliveredRetentionMs: 7 * 86_400_000,
      deadLetterRetentionMs: 30 * 86_400_000,
    });
    await expect(runtime.runOnce()).resolves.toMatchObject({ delivered: 1 });

    const left = await remaining();
    expect(left.get("delivered")).toBe(1);
    // Eine ausstehende Zustellung ist keine Altlast. Sie zu loeschen waere der
    // stille Verlust genau der Nachricht, die noch ankommen soll.
    expect(left.get("pending")).toBe(1);
  });

  it("keeps a dead letter that a delivered row of the same age would lose", async () => {
    await delivery("dead_lettered", 10);
    await delivery("delivered", 10);

    const runtime = new WebhookRetentionRuntime({
      repository, scopes: [scope],
      deliveredRetentionMs: 7 * 86_400_000,
      deadLetterRetentionMs: 30 * 86_400_000,
    });
    await runtime.runOnce();

    const left = await remaining();
    expect(left.get("dead_lettered")).toBe(1);
  });
});
