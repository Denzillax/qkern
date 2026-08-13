import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
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
const workerUrl = process.env.QKERN_TEST_WORKER_DATABASE_URL;
/**
 * Der Schluessel des Empfaengers — **dekodiert**.
 *
 * Der Empfaenger liest `QKERN_RECEIVER_SECRET` als base64url und rechnet mit den
 * Bytes. Der Projekt-Webhook-Signierer tut dasselbe; der Incident-Publisher
 * dagegen nimmt `QKERN_INCIDENT_WEBHOOK_HMAC_SECRET` als rohe Zeichenkette.
 * Beide sind in sich stimmig und passen nur zusammen, wenn man die eine Seite
 * dekodiert konfiguriert. Wer das uebersieht, bekommt 401 und keine Erklaerung.
 */
const RECEIVER_SECRET = Buffer
  .from("cXFrZXJuLWNlcnRpZmljYXRpb24tc2lnbmluZy1zZWNyZXQtMzJi", "base64url")
  .toString("utf8");
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

  async function defineWebhook(path: string, host = "receiver.qkern.test", maxAttempts = 3) {
    return await definitions.createWebhook(admin, scope, {
      name: uniqueName("hook"),
      url: `https://${host}${path}`,
      eventTypes: ["order.created"],
      signingSecretRef: SECRET_REF,
      timeoutMs: 10_000,
      maxAttempts,
    });
  }

  /** Startet den ausgelieferten Compute-Prozess mit eingeschaltetem Zustellzweig. */
  function computeProcess() {
    const child = spawn(process.execPath, ["--import", "tsx", "workers/compute-runtime.mts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QKERN_COMPUTE_RUNTIME_ENABLED: "true",
        QKERN_COMPUTE_CRON_ENABLED: "false",
        QKERN_COMPUTE_WEBHOOKS_ENABLED: "true",
        QKERN_COMPUTE_WEBHOOK_IDLE_MS: "200",
        QKERN_COMPUTE_SCOPES_JSON: JSON.stringify([scope]),
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_STATEMENT_ENCRYPTION_KEY: "0".repeat(64),
        QKERN_RUNTIME_DATABASE_URL: runtimeUrl!,
      },
    });
    let noise = "";
    child.stderr.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    return { child, output: () => noise };
  }

  /** Wartet auf einen Endzustand der Zustellung. */
  async function settledStatus(deliveryId: string, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    let status = "pending";
    while (Date.now() < deadline && status !== "delivered" && status !== "dead_lettered") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const row = await owner.query<{ status: string }>(
        "SELECT status FROM project_webhook_deliveries WHERE id=$1", [deliveryId]);
      status = row.rows[0]?.status ?? "pending";
    }
    return status;
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

  /**
   * Dieselbe Zustellung, aber ausgeloest vom **Prozess**.
   *
   * Release 1.53 hat den Webhook-Zweig verdrahtet und offen gelassen, dass er
   * nicht zertifiziert ist: Jener Lauf schaltet die Zustellung aus, weil sie
   * einen Signaturschluessel verlangt. Hier gibt es ihn — und einen echten
   * Empfaenger, der den HMAC selbst nachrechnet.
   *
   * Gemessen wird beides: dass die Zustellung ankommt und dass der Prozess es
   * sagt. Bis Release 1.54 gab es nur einen Fehlerhaken; ein Log, das nur
   * Fehler kennt, beantwortet die haeufigste Frage nicht — laeuft es?
   */
  it("delivers from the shipped process and reports it", async () => {
    const hook = await defineWebhook("/hooks");
    const entry = await outbox.enqueue(scope, {
      webhookId: hook.id, eventType: "order.created", payload: { orderId: "A-process" },
    });

    const runner = computeProcess();
    const { child } = runner;
    try {
      const status = await settledStatus(entry.id);
      const noise = runner.output();
      expect(status, `Prozessausgabe: ${noise.slice(-800)}`).toBe("delivered");

      // Auf die Meldung warten, nicht auf einen Moment: Der Zustand steht in
      // der Datenbank, bevor die Runde zu Ende ist.
      const logDeadline = Date.now() + 20_000;
      while (Date.now() < logDeadline && !runner.output().includes("compute.webhook_delivered")) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(runner.output()).toContain("compute.webhook_delivered");

      // Und sonst nichts: kein Endpunkt, kein Geheimnis, keine Id.
      expect(runner.output()).not.toContain("receiver.qkern.test");
      expect(runner.output()).not.toContain(SECRET_REF);
      expect(runner.output()).not.toContain(projectId);
    } finally {
      child.kill();
    }
  }, 180_000);

  /**
   * Derselbe Prozess, aber der Empfaenger sagt Nein.
   *
   * Release 1.54 hat die gelungene Zustellung belegt und offen gelassen, dass
   * der **Fehlschlag** verdrahtet und ungeprueft bleibt. `/hooks/no-echo`
   * antwortet mit 200, ohne die Zustell-Id zu spiegeln — fuer den Zusteller ein
   * Fehlschlag, und genau den soll der Prozess melden.
   */
  it("reports a refused delivery from the shipped process", async () => {
    // Ein einziger Versuch: Der Fall misst die Meldung, nicht die Geduld des
    // Wiederholens — die ist eigens zertifiziert.
    const hook = await defineWebhook("/hooks/no-echo", "receiver.qkern.test", 1);
    const entry = await outbox.enqueue(scope, {
      webhookId: hook.id, eventType: "order.created", payload: { orderId: "A-refused" },
    });

    const runner = computeProcess();
    try {
      const status = await settledStatus(entry.id);
      expect(status, `Prozessausgabe: ${runner.output().slice(-800)}`).toBe("dead_lettered");

      const logDeadline = Date.now() + 20_000;
      while (Date.now() < logDeadline && !runner.output().includes("compute.webhook_failed")) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(runner.output()).toContain("compute.webhook_failed");
      expect(runner.output()).toMatch(/"failureCode":"[A-Z_]+"/);

      // Ein fester Code, kein Endpunkt und keine Antwort des Empfaengers.
      expect(runner.output()).not.toContain("no-echo");
      expect(runner.output()).not.toContain(SECRET_REF);
    } finally {
      runner.child.kill();
    }
  }, 180_000);

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

  /**
   * Der Incident-Publisher — der vierte Prozess mit Arbeitsnachweis.
   *
   * Realtime, beide Publisher und der Provisioner hatten seit `1.44.0` keinen
   * Lauf, der sie arbeiten sieht; seit sieben Releases ist das die groesste
   * Luecke dieser Reihe. Dieser hier laesst sich schliessen, weil er an einen
   * Webhook liefert und der echte Empfaenger schon steht.
   *
   * Sein Bestaetigungsformat ist ein anderes als das des Projekt-Webhooks: Er
   * verlangt genau `{"status":"ack","eventId":"…"}` mit der Kennung, die er
   * geschickt hat. Deshalb hat der Empfaenger dafuer einen eigenen Pfad
   * bekommen — das Signaturschema ist dasselbe und wird auch dort nachgerechnet.
   */
  it("publishes an incident from the shipped process", async () => {
    const jobId = randomUUID();
    const changeSetId = randomUUID();
    const approvalId = randomUUID();
    const incidentId = randomUUID();
    const eventId = randomUUID();
    const ref = `managed:${projectId}`;

    await owner.query(`INSERT INTO change_sets
      (id,organization_id,project_id,environment,title,statement_sha256,encrypted_statement,risk,status,created_by)
      VALUES ($1,$2,$3,'development','incident',$4,$5,'low','approved',$6)`,
    [changeSetId, organizationId, projectId, "c".repeat(64), Buffer.alloc(1), controlUser]);
    await owner.query(`INSERT INTO approval_requests
      (id,organization_id,project_id,change_set_id,environment,action_hash,status,expires_at)
      VALUES ($1,$2,$3,$4,'development',$5,'approved',now() + interval '1 hour')`,
    [approvalId, organizationId, projectId, changeSetId, "d".repeat(64)]);
    await owner.query(`INSERT INTO migration_jobs
      (id,organization_id,project_id,environment,database_instance_ref,change_set_id,
       approval_request_id,status,attempt_count,max_attempts,finished_at,
       reconciliation_required,reconciliation_attempt_count,max_reconciliation_attempts,
       review_cycle_count,max_review_cycles)
      VALUES ($1,$2,$3,'development',$4,$5,$6,'review_required',3,5,now(),
              true,3,3,3,3)`,
    [jobId, organizationId, projectId, ref, changeSetId, approvalId]);
    await owner.query(`INSERT INTO migration_incidents
      (id,organization_id,migration_job_id,project_id,environment,change_set_id,
       detected_review_cycle,detected_reconciliation_attempt)
      VALUES ($1,$2,$3,$4,'development',$5,3,3)`,
    [incidentId, organizationId, jobId, projectId, changeSetId]);
    await owner.query(`INSERT INTO migration_incident_outbox
      (id,organization_id,migration_incident_id,event_type,status)
      VALUES ($1,$2,$3,'migration.incident.opened','pending')`,
    [eventId, organizationId, incidentId]);

    // Zuerst den Empfaenger selbst: Wer den Prozess misst, ohne die Gegenstelle
    // zu kennen, sucht den Fehler spaeter an der falschen Stelle.
    const probeBody = JSON.stringify({ probe: true });
    const probeStamp = Math.floor(Date.now() / 1_000).toString(10);
    const probeSignature = createHmac("sha256", RECEIVER_SECRET)
      .update(`${probeStamp}.${probeBody}`, "utf8").digest("hex");
    const probe = await fetch(`${ORIGIN}/incidents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qkern-event-id": eventId,
        "x-qkern-signature": `v1=${probeSignature}`,
        "x-qkern-timestamp": probeStamp,
      },
      body: probeBody,
    });
    expect(probe.status, `Empfaengerantwort: ${await probe.text()}`).toBe(200);

    const child = spawn(process.execPath, ["--import", "tsx", "workers/incident-outbox-runtime.mts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QKERN_INCIDENT_OUTBOX_PUBLISHER_ENABLED: "true",
        QKERN_INCIDENT_OUTBOX_PUBLISHER_ID: "certification-incident-1",
        QKERN_INCIDENT_OUTBOX_IDLE_MS: "200",
        QKERN_WORKER_ORGANIZATION_ID: organizationId,
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_WORKER_DATABASE_URL: workerUrl!,
        QKERN_INCIDENT_WEBHOOK_URL: `${ORIGIN}/incidents`,
        QKERN_INCIDENT_WEBHOOK_ALLOWED_HOSTS: "receiver.qkern.test",
        QKERN_INCIDENT_WEBHOOK_HMAC_KEY_ID: "cert-1",
        QKERN_INCIDENT_WEBHOOK_HMAC_SECRET: RECEIVER_SECRET,
      },
    });
    let noise = "";
    child.stderr.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { noise += chunk.toString(); });

    try {
      const deadline = Date.now() + 90_000;
      let status = "pending";
      while (Date.now() < deadline && status === "pending") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const row = await owner.query<{ status: string }>(
          "SELECT status FROM migration_incident_outbox WHERE id=$1", [eventId]);
        status = row.rows[0]?.status ?? "pending";
      }
      // Der Empfaenger hat die Signatur nachgerechnet und genau die Kennung
      // bestaetigt, die der Prozess geschickt hat. Ohne beides waere hier kein
      // `published`.
      expect(status, `Prozessausgabe: ${noise.slice(-800)}`).toBe("published");
    } finally {
      child.kill();
    }

    // Endpunkt und Geheimnis bleiben aus dem Log dieses Prozesses.
    expect(noise).not.toContain(RECEIVER_SECRET);
    expect(noise).not.toContain("receiver.qkern.test");
  }, 180_000);

  /**
   * Der Apply-Publisher — der sechste Prozess mit Arbeitsnachweis.
   *
   * Der „Broker" ist eine HTTPS-Gegenstelle mit demselben Format wie beim
   * Incident-Publisher: `v1=<hex>`, Schluesselkennung im eigenen Header und
   * eine Bestaetigung mit genau der gesendeten Kennung. Damit reicht dieselbe
   * Gegenstelle — dass er einen „Broker" braucht, war eine Annahme, kein
   * Hindernis.
   */
  it("publishes an apply request from the shipped process", async () => {
    const jobId = randomUUID();
    const changeSetId = randomUUID();
    const approvalId = randomUUID();
    const eventId = randomUUID();
    const ref = `managed:${projectId}`;

    await owner.query(`INSERT INTO change_sets
      (id,organization_id,project_id,environment,title,statement_sha256,encrypted_statement,risk,status,created_by)
      VALUES ($1,$2,$3,'development','apply',$4,$5,'low','approved',$6)`,
    [changeSetId, organizationId, projectId, "e".repeat(64), Buffer.alloc(1), controlUser]);
    await owner.query(`INSERT INTO approval_requests
      (id,organization_id,project_id,change_set_id,environment,action_hash,status,expires_at)
      VALUES ($1,$2,$3,$4,'development',$5,'approved',now() + interval '1 hour')`,
    [approvalId, organizationId, projectId, changeSetId, "f".repeat(64)]);
    await owner.query(`INSERT INTO migration_jobs
      (id,organization_id,project_id,environment,database_instance_ref,change_set_id,
       approval_request_id,status)
      VALUES ($1,$2,$3,'development',$4,$5,$6,'queued')`,
    [jobId, organizationId, projectId, ref, changeSetId, approvalId]);
    await owner.query(`INSERT INTO migration_outbox
      (id,organization_id,migration_job_id,event_type,status)
      VALUES ($1,$2,$3,'migration.apply.requested','pending')`,
    [eventId, organizationId, jobId]);

    const child = spawn(process.execPath, ["--import", "tsx", "workers/apply-outbox-runtime.mts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QKERN_OUTBOX_PUBLISHER_ENABLED: "true",
        QKERN_OUTBOX_PUBLISHER_ID: "certification-apply-1",
        QKERN_OUTBOX_IDLE_MS: "200",
        QKERN_WORKER_ORGANIZATION_ID: organizationId,
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_WORKER_DATABASE_URL: workerUrl!,
        QKERN_APPLY_BROKER_URL: `${ORIGIN}/apply`,
        QKERN_APPLY_BROKER_ALLOWED_HOSTS: "receiver.qkern.test",
        QKERN_APPLY_BROKER_HMAC_KEY_ID: "cert-1",
        QKERN_APPLY_BROKER_HMAC_SECRET: RECEIVER_SECRET,
      },
    });
    let noise = "";
    child.stderr.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { noise += chunk.toString(); });

    try {
      const deadline = Date.now() + 90_000;
      let status = "pending";
      while (Date.now() < deadline && status === "pending") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const row = await owner.query<{ status: string }>(
          "SELECT status FROM migration_outbox WHERE id=$1", [eventId]);
        status = row.rows[0]?.status ?? "pending";
      }
      expect(status, `Prozessausgabe: ${noise.slice(-800)}`).toBe("published");
    } finally {
      child.kill();
    }

    expect(noise).not.toContain(RECEIVER_SECRET);
    expect(noise).not.toContain("receiver.qkern.test");
  }, 180_000);
});
