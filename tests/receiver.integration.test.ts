import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { PostgresComputeDefinitionRepository } from
  "@/lib/server/compute/definitions-postgres-repository";
import { MediatedFunctionEgress, isEgressRejection } from "@/lib/server/compute/function-egress";
import { WebhookDeliveryRuntime } from "@/lib/server/compute/webhook-delivery-runtime";
import { WebhookOutbox } from "@/lib/server/compute/webhook-outbox";
import { PostgresWebhookOutboxRepository } from "@/lib/server/compute/webhook-postgres-repository";
import { EnvWebhookSecretProvider, HmacWebhookSigner } from "@/lib/server/compute/webhook-signer";
import { FetchWebhookTransport } from "@/lib/server/compute/webhook-transport";
import { WebhookDeliverer } from "@/lib/server/compute/webhooks";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { createGuardedFetch } from "@/lib/server/net/guarded-fetch";
import type { SqlPool } from "@/lib/server/db/sql";
import type { FunctionDefinition } from "@/lib/server/compute/model";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

/**
 * Der ausgehende Weg gegen einen **echten** HTTPS-Server.
 *
 * Bis Release 1.27 war jede Zusage dieses Wegs gegen ein eingespeistes `fetch`
 * belegt. Signatur, Bestätigung, Weiterleitungsverbot, Grössengrenze und
 * Adressprüfung hatten nie eine TLS-Verbindung gesehen. Jede Release-Notiz seit
 * `1.20.0` führte diese Lücke offen mit.
 *
 * Der Empfänger in diesem Stack rechnet den HMAC selbst nach. Ein Empfänger,
 * der jede Nachricht bestätigt, würde nur belegen, dass irgendetwas ankam.
 *
 * Was hier **nicht** belegt wird: Der Container startet nicht mit, weil ein Test
 * im Container keine Container starten kann. Die Naht Sandbox ↔ Runtime ist seit
 * `1.26.0` eigens zertifiziert; neu ist hier ausschliesslich das Stück Weg
 * zwischen Runtime und Gegenstelle.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = process.env.QKERN_TEST_RECEIVER_E2E === "true" &&
  Boolean(ownerUrl && runtimeUrl);

const ORIGIN = "https://receiver.qkern.test";
const SECRET_REF = "webhook/certification";
/** Formgültige Registry-Referenz; hier wird kein Container gestartet. */
const IMAGE = `registry.example.com/qkern/probe@sha256:${"b".repeat(64)}`;

describe.runIf(enabled)("Receiver certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const admin: ProjectQueuePrincipal = {
    organizationId, actorRef: "owner@qkern.test", role: "admin", subject: controlUser,
  };

  let owner: SqlPool;
  let runtime: SqlPool;
  let definitions: ComputeDefinitionService;
  let outbox: WebhookOutbox;
  let outboxRepository: PostgresWebhookOutboxRepository;
  let deliverer: WebhookDeliverer;

  const uniqueName = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `receiver-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Receiver', $2, $3)`,
    [organizationId, `receiver-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Receiver', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `receiver-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);

    runtime = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    const controlPlane = new PostgresControlPlane(runtime);
    definitions = new ComputeDefinitionService({
      repository: new PostgresComputeDefinitionRepository(controlPlane),
    });
    outboxRepository = new PostgresWebhookOutboxRepository(controlPlane);
    outbox = new WebhookOutbox({ repository: outboxRepository });
    // Beide Adapter sind die aus dem Betrieb: der echte Signierer über den
    // Umgebungs-Provider und der echte Transport über den geprüften Weg aus
    // 1.27. Nichts an diesem Aufbau ist für den Test eingespeist.
    deliverer = new WebhookDeliverer(
      new HmacWebhookSigner(new EnvWebhookSecretProvider()),
      new FetchWebhookTransport(),
    );
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.end(), owner?.end()]);
  });

  async function defineWebhook(path: string, host = "receiver.qkern.test") {
    return await definitions.createWebhook(admin, scope, {
      name: uniqueName("hook"),
      url: `https://${host}${path}`,
      eventTypes: ["order.created"],
      signingSecretRef: SECRET_REF,
      timeoutMs: 10_000,
      maxAttempts: 3,
    });
  }

  /** Genau ein Stapel, mit den echten Adaptern, und dann der Zustand aus der Datenbank. */
  async function deliverOnce(webhookId: string) {
    const entry = await outbox.enqueue(scope, {
      webhookId, eventType: "order.created", payload: { orderId: "A-1" },
    });
    const worker = new WebhookDeliveryRuntime({
      outbox, deliverer, definitions: outboxRepository, scope,
      workerId: "receiver-certification", batchSize: 1,
    });
    const result = await worker.runOnce();
    const row = await owner.query<{ status: string; last_failure_code: string | null }>(
      "SELECT status, last_failure_code FROM project_webhook_deliveries WHERE id=$1",
      [entry.id],
    );
    return { result, row: row.rows[0] };
  }

  it("delivers a signed webhook over real TLS and takes the receiver's acknowledgement", async () => {
    const hook = await defineWebhook("/hooks");
    const { result, row } = await deliverOnce(hook.id);

    // Der Empfänger hat die Signatur nachgerechnet. Ohne gültigen HMAC hätte er
    // mit 401 geantwortet und die Zustellung wäre fehlgeschlagen.
    expect(result).toMatchObject({ delivered: 1, failed: 0 });
    expect(row.status).toBe("delivered");
  });

  it("fails when the receiver answers 200 without reflecting the delivery id", async () => {
    const hook = await defineWebhook("/hooks/no-echo");
    const { result, row } = await deliverOnce(hook.id);

    // Ein 200 allein genügt nicht. Sonst hakte ein Proxy die Zustellung ab.
    expect(result).toMatchObject({ delivered: 0, failed: 1 });
    expect(row.status).toBe("pending");
    expect(row.last_failure_code).toBe("WEBHOOK_REJECTED");
  });

  it("refuses to follow a redirect the receiver sends", async () => {
    const hook = await defineWebhook("/hooks/redirect");
    const { result, row } = await deliverOnce(hook.id);

    expect(result).toMatchObject({ delivered: 0, failed: 1 });
    expect(row.status).toBe("pending");
  });

  it("refuses a receiver whose certificate does not carry the requested name", async () => {
    // Derselbe Container, ein zweiter Netzwerk-Alias. Das Zertifikat trägt nur
    // receiver.qkern.test. Wäre das Festhalten der Adresse aus 1.27 an der
    // Identitätsprüfung vorbeigegangen, ginge dieser Fall durch.
    const hook = await defineWebhook("/hooks", "wrong.qkern.test");
    const { result, row } = await deliverOnce(hook.id);

    expect(result).toMatchObject({ delivered: 0, failed: 1 });
    expect(row.status).toBe("pending");
  });

  it("names the reason for the rejected certificate", async () => {
    // Der Zusteller trägt bewusst keine Ursache nach aussen. Damit der Fall
    // oben nicht aus irgendeinem Grund rot ist, wird der Grund hier einmal
    // direkt am geprüften Transport festgestellt.
    await expect(createGuardedFetch()("https://wrong.qkern.test/hooks", { method: "GET" }))
      .rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  });

  describe("function egress", () => {
    const egress = new MediatedFunctionEgress();
    let stored: FunctionDefinition;

    beforeAll(async () => {
      const record = await definitions.createFunction(admin, scope, {
        name: uniqueName("egress"),
        image: IMAGE,
        entrypoint: "handler.mjs",
        egressOrigins: [ORIGIN],
        timeoutMs: 10_000,
      });
      // Die Allowlist kommt aus der Datenbank, nicht aus dem Test.
      stored = record as unknown as FunctionDefinition;
      expect(stored.egressOrigins).toEqual([ORIGIN]);
    });

    it("reaches an allowed origin over real TLS", async () => {
      const outcome = await egress.request(stored, { url: `${ORIGIN}/api/ping`, method: "POST" });
      expect(isEgressRejection(outcome)).toBe(false);
      if (isEgressRejection(outcome)) return;
      expect(outcome.status).toBe(200);
      expect(JSON.parse(outcome.body)).toMatchObject({ pong: true, method: "POST" });
      // Der Empfänger setzt `set-cookie` und einen eigenen Header. Zurück kommen
      // nur die vier festgelegten.
      expect(Object.keys(outcome.headers)).toEqual(["content-type"]);
    });

    it("stops a response that exceeds the size limit", async () => {
      const outcome = await egress.request(stored, { url: `${ORIGIN}/api/flood` });
      expect(outcome).toEqual({ error: "EGRESS_LIMIT" });
    });

    it("refuses a redirect instead of handing the function a new target", async () => {
      // Auf dem Zustellweg fiele eine 302 schon durch die Statusprüfung. Hier
      // nicht: Ohne das Verbot käme die Umleitung samt `location` als gültige
      // Antwort bei der Function an — mit einem Ziel, das nie auf der
      // Allowlist stand.
      const outcome = await egress.request(stored, { url: `${ORIGIN}/hooks/redirect` });
      expect(outcome).toEqual({ error: "EGRESS_BLOCKED" });
    });

    it("refuses an origin that is not on the stored allowlist", async () => {
      const outcome = await egress.request(stored, { url: "https://wrong.qkern.test/api/ping" });
      expect(outcome).toEqual({ error: "EGRESS_NOT_ALLOWED" });
    });

    it("blocks a name that a real resolver maps to a private address", async () => {
      // `internal.qkern.test` steht im Stack und löst auf 172.31.240.x auf.
      // Die Allowlist erlaubt die Origin ausdrücklich — abgewiesen wird sie
      // trotzdem, denn die Adressprüfung steht hinter der Allowlist, nicht
      // vor ihr.
      const permissive = { ...stored, egressOrigins: ["https://internal.qkern.test"] };
      const outcome = await egress.request(permissive, {
        url: "https://internal.qkern.test/api/ping",
      });
      expect(outcome).toEqual({ error: "EGRESS_BLOCKED" });
    });
  });
});
