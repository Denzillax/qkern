import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { PostgresComputeDefinitionRepository } from
  "@/lib/server/compute/definitions-postgres-repository";
import { WebhookOutbox } from "@/lib/server/compute/webhook-outbox";
import { PostgresWebhookOutboxRepository } from "@/lib/server/compute/webhook-postgres-repository";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

/**
 * Die Definitionsfläche gegen echtes PostgreSQL.
 *
 * Bis Release 1.20 entstanden Cron-Jobs und Webhooks ausschliesslich über
 * direkten Datenbankzugriff. Diese Datei prüft die Fläche dort, wo Rechte, RLS
 * und Trigger wirklich gelten — insbesondere die Behauptung, dass nur das
 * Aktivierungsflag änderbar ist. Diese Behauptung trägt nicht der Dienst,
 * sondern das Spaltenrecht; ein Test gegen den Memory-Port könnte sie gar nicht
 * belegen.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Compute definitions PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const admin: ProjectQueuePrincipal = {
    organizationId, actorRef: "owner@qkern.test", role: "admin", subject: controlUser,
  };

  let owner: SqlPool;
  const pools: SqlPool[] = [];
  let service: ComputeDefinitionService;
  let outbox: WebhookOutbox;

  function pool() {
    const created = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    pools.push(created);
    return created;
  }

  const uniqueName = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `definitions-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Compute Definitions', $2, $3)`,
    [organizationId, `definitions-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Definitions', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `definitions-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);

    const control = new PostgresControlPlane(pool());
    service = new ComputeDefinitionService({
      repository: new PostgresComputeDefinitionRepository(control),
      queues: { async queueNames() { return ["report_jobs"]; } },
    });
    outbox = new WebhookOutbox({ repository: new PostgresWebhookOutboxRepository(control) });
  });

  afterAll(async () => {
    await Promise.allSettled([...pools.map((entry) => entry.end()), owner?.end()]);
  });

  async function webhook(overrides: { enabled?: boolean } = {}) {
    return await service.createWebhook(admin, scope, {
      name: uniqueName("hook"), url: "https://receiver.example.com/hooks",
      eventTypes: ["order.created"], signingSecretRef: "vault:webhook/definitions",
      enabled: overrides.enabled ?? true,
    });
  }

  it("creates, lists and pauses a cron definition through the unprivileged runtime role", async () => {
    const name = uniqueName("report");
    const created = await service.createCron(admin, scope, {
      name, expression: "*/15 * * * *", queue: "report_jobs", payload: { report: "daily" },
    });
    expect(created.enabled).toBe(true);
    expect((await service.listCron(admin, scope)).some((entry) => entry.id === created.id)).toBe(true);

    const paused = await service.setCronEnabled(admin, scope, created.id, false);
    expect(paused.enabled).toBe(false);
    expect(paused.expression).toBe("*/15 * * * *");
  });

  it("refuses a second definition with the same name", async () => {
    // Die Eindeutigkeit liegt als Constraint in der Datenbank, nicht als
    // Vorabpruefung im Dienst: Zwei gleichzeitige Anfragen wuerden eine solche
    // Pruefung sonst beide bestehen.
    const name = uniqueName("duplicate");
    await service.createCron(admin, scope, {
      name, expression: "*/15 * * * *", queue: "report_jobs",
    });
    await expect(service.createCron(admin, scope, {
      name, expression: "*/30 * * * *", queue: "report_jobs",
    })).rejects.toMatchObject({ code: "COMPUTE_CONFLICT" });
  });

  it("denies the runtime role any change beyond the enabled flag", async () => {
    // Der Kern dieser Datei. Die Unveraenderlichkeit traegt das Spaltenrecht,
    // nicht der Dienst — und nur ein echter Server kann das zeigen.
    const created = await service.createCron(admin, scope, {
      name: uniqueName("immutable"), expression: "*/15 * * * *", queue: "report_jobs",
    });
    const runtime = pool();
    await expect(runtime.query(
      "UPDATE project_cron_definitions SET expression='*/1 * * * *' WHERE id=$1", [created.id],
    )).rejects.toMatchObject({ message: expect.stringContaining("permission denied") });

    const hook = await webhook();
    await expect(runtime.query(
      "UPDATE project_webhooks SET url='https://elsewhere.example.com/hooks' WHERE id=$1", [hook.id],
    )).rejects.toMatchObject({ message: expect.stringContaining("permission denied") });
  });

  it("refuses to delete a webhook while it is still enabled", async () => {
    const hook = await webhook({ enabled: true });
    await expect(service.deleteWebhook(admin, scope, hook.id)).rejects.toMatchObject({
      code: "COMPUTE_PRECONDITION_FAILED",
    });
    expect(await service.getWebhook(admin, scope, hook.id)).toMatchObject({ id: hook.id });
  });

  it("deletes a disabled webhook together with its pending deliveries", async () => {
    // Genau deshalb verlangt der Dienst das Abschalten vorher: Loeschen ist
    // nicht nur das Ende der Definition, sondern auch der Verlust wartender
    // Zustellungen.
    const hook = await webhook({ enabled: true });
    const delivery = await outbox.enqueue(scope, {
      webhookId: hook.id, eventType: "order.created", payload: { id: 1 },
    });
    await service.setWebhookEnabled(admin, scope, hook.id, false);
    await service.deleteWebhook(admin, scope, hook.id);

    const remaining = await owner.query(
      "SELECT id FROM project_webhook_deliveries WHERE id=$1", [delivery.id],
    );
    expect(remaining.rows).toHaveLength(0);
  });

  it("lists delivery status without ever returning a payload", async () => {
    const hook = await webhook();
    await outbox.enqueue(scope, {
      webhookId: hook.id, eventType: "order.created", payload: { secret: "customer-address" },
    });
    const deliveries = await service.listDeliveries(admin, scope, hook.id, 10);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ eventType: "order.created", status: "pending", attemptCount: 0 });
    expect(JSON.stringify(deliveries)).not.toContain("customer-address");
  });

  it("hides definitions of a different organization", async () => {
    await service.createCron(admin, scope, {
      name: uniqueName("private"), expression: "*/15 * * * *", queue: "report_jobs",
    });
    const outsider: ProjectQueuePrincipal = { ...admin, organizationId: randomUUID() };
    const foreign = { ...scope, organizationId: outsider.organizationId };
    expect(await service.listCron(outsider, foreign)).toEqual([]);
    expect(await service.listWebhooks(outsider, foreign)).toEqual([]);
  });

  /**
   * Der Image-Deployment-Fluss — Sprosse 6 der Paritaetsleiter.
   *
   * Die Unveraenderlichkeit aus 0033 bleibt: Die Laufzeitrolle darf das Image
   * weiterhin nicht direkt schreiben. Neu ist die eine Tuer aus 0042, die den
   * Wechsel nur zusammen mit seiner Historienzeile zulaesst — genau diesen
   * Zusammenhang nimmt die Mutationsprobe dieses Releases heraus.
   */
  it("deploys images only through the door that writes their history", async () => {
    const imageA = `registry.example.com/qkern/app@sha256:${"a".repeat(64)}`;
    const imageB = `registry.example.com/qkern/app@sha256:${"b".repeat(64)}`;
    const fn = await service.createFunction(admin, scope, {
      name: uniqueName("deploy"), image: imageA, entrypoint: "index.mjs",
    });

    // Direkt bleibt verboten — das Spaltenrecht aus 0033 lebt.
    await expect(pool().query(
      "UPDATE project_functions SET image=$1 WHERE id=$2", [imageB, fn.id],
    )).rejects.toMatchObject({ message: expect.stringContaining("permission denied") });

    // Durch die Tuer: neues Image, Revision 1; Rollback ist Revision 2.
    const first = await service.deployFunction(admin, scope, fn.id, { image: imageB });
    expect(first.revision).toBe(1);
    const rolledBack = await service.deployFunction(admin, scope, fn.id, { image: imageA });
    expect(rolledBack.revision).toBe(2);

    const current = await service.getFunction(admin, scope, fn.id);
    expect(current.image).toBe(imageA);

    // Die Historie traegt jede Aenderung, neueste zuerst — wer heute liest,
    // sieht, was gestern lief.
    const history = await service.listFunctionDeployments(admin, scope, fn.id);
    expect(history.map((entry) => [entry.revision, entry.image])).toEqual([
      [2, imageA],
      [1, imageB],
    ]);
    expect(history.every((entry) => entry.deployedBy === "owner@qkern.test")).toBe(true);
  }, 30_000);
});