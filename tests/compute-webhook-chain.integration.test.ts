import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebhookDeliveryRuntime } from "@/lib/server/compute/webhook-delivery-runtime";
import { WebhookOutbox } from "@/lib/server/compute/webhook-outbox";
import { PostgresWebhookOutboxRepository } from "@/lib/server/compute/webhook-postgres-repository";
import { HmacWebhookSigner, verifyWebhookSignature } from "@/lib/server/compute/webhook-signer";
import { WebhookDeliverer, type WebhookTransportPort } from "@/lib/server/compute/webhooks";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Die Zustellkette gegen echtes PostgreSQL: hinterlegen, holen, signieren,
 * senden, abschliessen.
 *
 * Bis Release 1.19 gab es jedes Stück einzeln und zertifiziert — Outbox,
 * Zusteller, Signaturport — aber nichts verband sie. Eine hinterlegte Zustellung
 * wurde nie gesendet. Genau das prüft diese Datei: nicht die Teile, sondern die
 * Kette, und zwar dort, wo Rechte, RLS und Trigger wirklich gelten.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

const secret = randomBytes(32);
const secretRef = "vault:webhook/chain";

describe.runIf(enabled)("Webhook delivery chain PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };

  let owner: SqlPool;
  const pools: SqlPool[] = [];

  type Attempt = {
    url: string; deliveryId: string | null; eventType: string | null; verified: boolean;
  };

  function repository() {
    const pool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    pools.push(pool);
    return new PostgresWebhookOutboxRepository(new PostgresControlPlane(pool));
  }

  /**
   * Ein Empfänger, der die Signatur wirklich prüft. Ein Stub, der jede Nachricht
   * bestätigt, würde nur beweisen, dass irgendetwas ankam.
   */
  function receiver(options: { attempts: Attempt[]; status?: number; echo?: boolean }): WebhookTransportPort {
    return {
      async send(request) {
        const body = request.body;
        const timestamp = request.headers["x-qkern-timestamp"];
        const signature = /v1=([A-Za-z0-9_-]+);key=/.exec(request.headers["x-qkern-signature"] ?? "")?.[1];
        const deliveryId = request.headers["x-qkern-delivery-id"] ?? null;
        options.attempts.push({
          url: request.url,
          deliveryId,
          eventType: request.headers["x-qkern-event"] ?? null,
          verified: Boolean(signature) && verifyWebhookSignature({
            secret, canonicalPayload: `${timestamp}.${body}`, signature: signature!,
          }),
        });
        return {
          status: options.status ?? 200,
          acknowledgementId: options.echo === false ? null : deliveryId,
        };
      },
    };
  }

  function runtimeFor(options: {
    attempts: Attempt[]; status?: number; echo?: boolean; workerId: string;
  }) {
    const store = repository();
    const outbox = new WebhookOutbox({ repository: store, visibilityMs: 60_000 });
    return {
      outbox,
      runtime: new WebhookDeliveryRuntime({
        outbox,
        deliverer: new WebhookDeliverer(
          new HmacWebhookSigner({ async resolve() { return { keyId: "chain-1", secret }; } }),
          receiver(options),
        ),
        definitions: store,
        scope,
        workerId: options.workerId,
        batchSize: 10,
      }),
    };
  }

  async function defineWebhook(overrides: { maxAttempts?: number; enabled?: boolean } = {}) {
    const id = randomUUID();
    await owner.query(
      `INSERT INTO project_webhooks
         (id, organization_id, project_id, environment, name, url, event_types,
          signing_secret_ref, max_attempts, enabled)
       VALUES ($1,$2,$3,'development',$4,$5,$6,$7,$8,$9)`,
      [id, organizationId, projectId, `chain-${id.slice(0, 8)}`,
        "https://receiver.example.com/hooks", ["order.created"], secretRef,
        overrides.maxAttempts ?? 5, overrides.enabled ?? true],
    );
    return id;
  }

  async function state(deliveryId: string) {
    const result = await owner.query<{
      status: string; attempt_count: number; last_failure_code: string | null;
      available_at: Date; delivered_at: Date | null;
    }>(
      `SELECT status, attempt_count, last_failure_code, available_at, delivered_at
         FROM project_webhook_deliveries WHERE id=$1`, [deliveryId],
    );
    return result.rows[0];
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `chain-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Webhook Chain', $2, $3)`,
    [organizationId, `chain-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Chain', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `chain-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);
  });

  afterAll(async () => {
    await Promise.allSettled([...pools.map((pool) => pool.end()), owner?.end()]);
  });

  /**
   * Arbeitet die Warteschlange leer, bis die eigene Zustellung abgeschlossen
   * ist. Die Outbox ist FIFO über den ganzen Scope, also holt ein Durchlauf
   * womöglich zuerst die Zustellung eines früheren Falls.
   */
  async function drainUntilSettled(runtime: WebhookDeliveryRuntime, deliveryId: string) {
    for (let pass = 0; pass < 20; pass += 1) {
      const result = await runtime.runOnce();
      const current = await state(deliveryId);
      if (current?.status !== "pending" && current?.status !== "in_flight") return;
      if (result.delivered + result.failed + result.skipped === 0) return;
    }
  }

  it("carries an enqueued event all the way to a verified, acknowledged delivery", async () => {
    const attempts: Attempt[] = [];
    const { outbox, runtime } = runtimeFor({ attempts, workerId: "chain-happy" });
    const webhookId = await defineWebhook();
    const delivery = await outbox.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { orderId: "A-1" },
    });

    await drainUntilSettled(runtime, delivery.id);

    const settled = await state(delivery.id);
    expect(settled?.status).toBe("delivered");
    expect(settled?.delivered_at).not.toBeNull();

    const own = attempts.find((attempt) => attempt.deliveryId === delivery.id);
    expect(own?.url).toBe("https://receiver.example.com/hooks");
    expect(own?.eventType).toBe("order.created");
    // Der Empfaenger konnte die Signatur mit dem geteilten Geheimnis pruefen.
    expect(own?.verified).toBe(true);
  });

  it("schedules a retry when the receiver rejects, without losing the delivery", async () => {
    const attempts: Attempt[] = [];
    const { outbox, runtime } = runtimeFor({ attempts, status: 500, workerId: "chain-retry" });
    const webhookId = await defineWebhook();
    const delivery = await outbox.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { orderId: "A-2" },
    });

    await drainUntilSettled(runtime, delivery.id);

    const settled = await state(delivery.id);
    expect(settled?.status).toBe("pending");
    expect(settled?.attempt_count).toBeGreaterThanOrEqual(1);
    expect(settled?.last_failure_code).toBe("WEBHOOK_REJECTED");
    // Die Wartezeit kommt vom Server, nicht vom Zusteller.
    expect(new Date(settled!.available_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("treats a receiver that does not echo the delivery id as a failure", async () => {
    // Sonst gaelte eine Zustellung als erfolgreich, weil irgendein Proxy mit 200
    // geantwortet hat.
    const attempts: Attempt[] = [];
    const { outbox, runtime } = runtimeFor({ attempts, echo: false, workerId: "chain-noecho" });
    const webhookId = await defineWebhook();
    const delivery = await outbox.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { orderId: "A-3" },
    });

    await drainUntilSettled(runtime, delivery.id);
    expect((await state(delivery.id))?.status).toBe("pending");
    expect((await state(delivery.id))?.last_failure_code).toBe("WEBHOOK_REJECTED");
  });

  it("dead-letters after the attempt limit of the definition", async () => {
    const attempts: Attempt[] = [];
    const { outbox, runtime } = runtimeFor({ attempts, status: 500, workerId: "chain-dead" });
    const webhookId = await defineWebhook({ maxAttempts: 1 });
    const delivery = await outbox.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { orderId: "A-4" },
    });

    await drainUntilSettled(runtime, delivery.id);
    expect((await state(delivery.id))?.status).toBe("dead_lettered");
  });

  it("does not send for a switched-off definition", async () => {
    // Abschalten heisst pausieren. Weiterzusenden waere gegen den Willen des
    // Betreibers, die Versuche bis zum Dead Letter zu verbrennen ebenso.
    const attempts: Attempt[] = [];
    const { outbox, runtime } = runtimeFor({ attempts, workerId: "chain-off" });
    const webhookId = await defineWebhook();
    const delivery = await outbox.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { orderId: "A-5" },
    });
    await owner.query("UPDATE project_webhooks SET enabled=false WHERE id=$1", [webhookId]);

    await runtime.runOnce();
    expect(attempts.some((attempt) => attempt.deliveryId === delivery.id)).toBe(false);
    const parked = await state(delivery.id);
    expect(parked?.status).toBe("pending");
    // Sie wurde gar nicht erst geholt — sonst waere ein Versuch verbraucht.
    expect(parked?.attempt_count).toBe(0);

    // Nach dem Wiedereinschalten laeuft dieselbe Zustellung weiter.
    await owner.query("UPDATE project_webhooks SET enabled=true WHERE id=$1", [webhookId]);
    await drainUntilSettled(runtime, delivery.id);
    expect((await state(delivery.id))?.status).toBe("delivered");
  });

  it("recovers a delivery whose deliverer died mid-attempt", async () => {
    // Ohne diesen Schritt bliebe eine Zustellung nach einem Absturz fuer immer
    // `in_flight`. Bis Release 1.19 fiel das nicht auf, weil niemand zustellte.
    const attempts: Attempt[] = [];
    const { outbox, runtime } = runtimeFor({ attempts, workerId: "chain-crash" });
    const webhookId = await defineWebhook();
    const delivery = await outbox.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { orderId: "A-6" },
    });

    const claimed = await outbox.claim(scope, { workerId: "crashing-worker", limit: 10 });
    expect(claimed.some((claim) => claim.id === delivery.id)).toBe(true);
    await owner.query(
      "UPDATE project_webhook_deliveries SET lease_expires_at=now() - interval '1 minute' WHERE id=$1",
      [delivery.id],
    );

    await drainUntilSettled(runtime, delivery.id);
    expect((await state(delivery.id))?.status).toBe("delivered");
    expect((await state(delivery.id))?.attempt_count).toBeGreaterThanOrEqual(2);
  });
});
