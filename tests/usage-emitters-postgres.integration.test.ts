import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { PostgresComputeDefinitionRepository } from
  "@/lib/server/compute/definitions-postgres-repository";
import { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";
import { ServiceUsageEmitter } from "@/lib/server/usage/emitter";
import { PostgresUsageRepository } from "@/lib/server/usage/postgres-repository";
import { UsageService } from "@/lib/server/usage/service";
import type { SqlPool } from "@/lib/server/db/sql";
import type { FunctionInvocationResult } from "@/lib/server/compute/model";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";
import type { UsageMetric, UsagePrincipal, UsageScope } from "@/lib/server/usage/model";

/**
 * Produktoperationen zählen sich selbst — gegen echtes PostgreSQL.
 *
 * Bis Release 1.28 war Usage Metering vollständig gebaut und zertifiziert und
 * zeigte trotzdem null, weil keine einzige Produktoperation je ein Ereignis
 * meldete. Dieselbe Lücke wie beim Realtime-Poller, beim Event-Log, bei der
 * Webhook-Outbox und bei der Functions-Sandbox: gebaut, belegt, wirkungslos.
 *
 * Gemessen wird deshalb nicht der Emitter, sondern die Wirkung: nach einem
 * echten `enqueue` beziehungsweise einem echten `invoke` steht eine Zahl in
 * `usage_counters`, und ein hartes Limit verhindert die Operation wirklich.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

const IMAGE = `registry.example.com/qkern/probe@sha256:${"c".repeat(64)}`;

describe.runIf(enabled)("Usage emitters PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();

  let owner: SqlPool;
  let runtime: SqlPool;
  let usage: UsageService;
  let queueRepository: PostgresProjectQueueRepository;
  let definitionRepository: PostgresComputeDefinitionRepository;
  let definitions: ComputeDefinitionService;

  const admin: ProjectQueuePrincipal = {
    organizationId, actorRef: "owner@qkern.test", role: "admin", subject: controlUser,
  };
  const worker: ProjectQueuePrincipal = {
    organizationId, actorRef: "service-role:emitter", role: "service_role", subject: "emitter",
  };
  const operator: UsagePrincipal = {
    organizationId, actorRef: "operator:emitter", subject: "operator-emitter", role: "operator",
  };

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    runtime = verifyDatabaseBoundary(createPostgresPool({ connectionString: runtimeUrl!, max: 8 }), "runtime");
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `emitter-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
      VALUES ($1,'Usage Emitters',$2,$3)`, [organizationId, `emitters-${organizationId}`, controlUser]);

    const controlPlane = new PostgresControlPlane(runtime);
    usage = new UsageService({ repository: new PostgresUsageRepository(controlPlane) });
    queueRepository = new PostgresProjectQueueRepository(controlPlane);
    definitionRepository = new PostgresComputeDefinitionRepository(controlPlane);
    definitions = new ComputeDefinitionService({ repository: definitionRepository });
  });

  afterAll(async () => {
    await Promise.all([owner?.end(), runtime?.end()]);
  });

  /**
   * Jeder Fall bekommt sein eigenes Projekt.
   *
   * Zähler sind monatlich und kumulativ. Teilten sich zwei Fälle einen Scope,
   * hinge jede Zahl an der Reihenfolge — und ein Fall wäre grün, weil ein
   * anderer vorher lief.
   */
  async function freshScope(): Promise<UsageScope> {
    const projectId = randomUUID();
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Emitters',$3,'test','ready',$4)`,
    [projectId, organizationId, `emitters-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`, [organizationId, projectId, `managed:${projectId}`]);
    return { organizationId, projectId, environment: "development" };
  }

  async function counter(scope: UsageScope, metric: UsageMetric): Promise<bigint> {
    const result = await owner.query<{ quantity: string }>(
      `SELECT quantity FROM usage_counters
        WHERE organization_id=$1 AND project_id=$2 AND environment=$3 AND metric=$4`,
      [scope.organizationId, scope.projectId, scope.environment, metric],
    );
    return BigInt(result.rows[0]?.quantity ?? "0");
  }

  function queues(scope: UsageScope, options: { ledger?: Pick<UsageService, "record">;
    onFailure?: "admit" | "reject" } = {}) {
    void scope;
    return new ProjectQueueService({
      repository: queueRepository,
      usage: new ServiceUsageEmitter({
        service: options.ledger ?? usage, source: "project_queues", onFailure: options.onFailure,
      }),
    });
  }

  function functions(calls: string[]) {
    return new FunctionInvocationService({
      repository: definitionRepository,
      usage: new ServiceUsageEmitter({ service: usage, source: "compute" }),
      // Kein Container: Dieser Lauf hat kein Docker. Belegt wird die Messung um
      // den Aufruf herum, nicht die Sandbox — die ist eigens zertifiziert.
      invoker: {
        async invoke(_definition, request): Promise<FunctionInvocationResult> {
          calls.push(request.id);
          return { statusCode: 200, headers: {}, body: { ok: true } };
        },
      },
    });
  }

  async function defineFunction(scope: UsageScope) {
    return await definitions.createFunction(admin, { ...scope, environment: "development" }, {
      name: `meter-${randomUUID().slice(0, 8)}`,
      image: IMAGE,
      entrypoint: "handler.mjs",
      maxConcurrency: 4,
    });
  }

  it("counts a real enqueue in the durable ledger", async () => {
    const scope = await freshScope();
    const service = queues(scope);
    await service.createQueue(admin, scope, { name: "metered" });
    await service.enqueue(worker, scope, "metered", { payload: { order: 1 } });
    await service.enqueue(worker, scope, "metered", { payload: { order: 2 } });

    expect(await counter(scope, "queue_operations")).toBe(2n);
    const events = await owner.query<{ source: string; accepted: boolean }>(
      `SELECT source,accepted FROM usage_events
        WHERE organization_id=$1 AND project_id=$2 AND metric='queue_operations'`,
      [scope.organizationId, scope.projectId],
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows.every((row) => row.source === "project_queues" && row.accepted)).toBe(true);
  });

  it("stops the enqueue when the hard limit is reached and writes no message", async () => {
    const scope = await freshScope();
    const service = queues(scope);
    await service.createQueue(admin, scope, { name: "capped" });
    await usage.setQuota(operator, scope, {
      metric: "queue_operations", limit: 1, mode: "enforce", expectedRevision: null,
    });

    await service.enqueue(worker, scope, "capped", { payload: { order: 1 } });
    await expect(service.enqueue(worker, scope, "capped", { payload: { order: 2 } }))
      .rejects.toMatchObject({ code: "QUEUE_QUOTA_EXCEEDED" });

    // Die entscheidende Zusage: Nicht nur die Antwort ist ein Fehler, es ist
    // auch nichts geschrieben worden.
    const messages = await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM project_queue_messages
        WHERE organization_id=$1 AND project_id=$2`, [scope.organizationId, scope.projectId],
    );
    expect(messages.rows[0].count).toBe("1");
    expect(await counter(scope, "queue_operations")).toBe(1n);
  });

  it("lets an observed limit run over instead of blocking", async () => {
    const scope = await freshScope();
    const service = queues(scope);
    await service.createQueue(admin, scope, { name: "observed" });
    await usage.setQuota(operator, scope, {
      metric: "queue_operations", limit: 1, mode: "observe", expectedRevision: null,
    });

    await service.enqueue(worker, scope, "observed", { payload: { order: 1 } });
    await service.enqueue(worker, scope, "observed", { payload: { order: 2 } });
    expect(await counter(scope, "queue_operations")).toBe(2n);
  });

  it("counts a deduplicated enqueue as its own operation", async () => {
    // Bewusst so: Gezählt werden Operationen, nicht entstandene Nachrichten.
    // Die Deduplizierung erspart die Nachricht, nicht den Aufruf.
    const scope = await freshScope();
    const service = queues(scope);
    await service.createQueue(admin, scope, { name: "deduped", dedupeWindowSeconds: 600 });
    const first = await service.enqueue(worker, scope, "deduped", {
      payload: { order: 1 }, dedupeKey: "same-key",
    });
    const replay = await service.enqueue(worker, scope, "deduped", {
      payload: { order: 1 }, dedupeKey: "same-key",
    });

    expect(replay).toMatchObject({ id: first.id, deduplicated: true });
    expect(await counter(scope, "queue_operations")).toBe(2n);
  });

  it("counts a real function invocation", async () => {
    const scope = await freshScope();
    const calls: string[] = [];
    const created = await defineFunction(scope);
    const result = await functions(calls).invoke(worker, { ...scope }, created.name, { mode: "echo" });

    expect(result.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(await counter(scope, "function_invocations")).toBe(1n);
  });

  it("refuses the invocation when the quota is exhausted and never starts it", async () => {
    const scope = await freshScope();
    const calls: string[] = [];
    const created = await defineFunction(scope);
    await usage.setQuota(operator, scope, {
      metric: "function_invocations", limit: 1, mode: "enforce", expectedRevision: null,
    });
    const service = functions(calls);

    await service.invoke(worker, { ...scope }, created.name, { mode: "echo" });
    await expect(service.invoke(worker, { ...scope }, created.name, { mode: "echo" }))
      .rejects.toMatchObject({ code: "COMPUTE_QUOTA_EXCEEDED" });

    // Ein abgewiesener Aufruf darf keinen Container gestartet haben.
    expect(calls).toHaveLength(1);
    expect(await counter(scope, "function_invocations")).toBe(1n);
  });

  it("keeps working when the ledger is unavailable, and can be told not to", async () => {
    const scope = await freshScope();
    const broken: Pick<UsageService, "record"> = {
      async record() { throw new Error("ledger unavailable"); },
    };

    const lenient = queues(scope, { ledger: broken });
    await lenient.createQueue(admin, scope, { name: "degraded" });
    await lenient.enqueue(worker, scope, "degraded", { payload: { order: 1 } });
    expect(await counter(scope, "queue_operations")).toBe(0n);

    const strict = queues(scope, { ledger: broken, onFailure: "reject" });
    await expect(strict.enqueue(worker, scope, "degraded", { payload: { order: 2 } }))
      .rejects.toMatchObject({ code: "QUEUE_QUOTA_EXCEEDED" });
  });
});
