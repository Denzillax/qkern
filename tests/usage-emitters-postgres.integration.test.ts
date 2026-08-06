import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { PostgresComputeDefinitionRepository } from
  "@/lib/server/compute/definitions-postgres-repository";
import { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import { GeneratedDataApiService } from "@/lib/server/data-plane/generated-api";
import { PostgresProjectStorageRepository } from "@/lib/server/project-storage/postgres-repository";
import { MemoryProjectStorageProvider } from "@/lib/server/project-storage/provider";
import { ProjectStorageService } from "@/lib/server/project-storage/service";
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
import type {
  PublicUsageDecision, UsageMetric, UsagePrincipal, UsageScope,
} from "@/lib/server/usage/model";

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
const projectApiUrl = process.env.QKERN_TEST_PROJECT_API_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl && projectApiUrl);

const IMAGE = `registry.example.com/qkern/probe@sha256:${"c".repeat(64)}`;
const CHECKSUM = Buffer.alloc(32, 11).toString("base64");

describe.runIf(enabled)("Usage emitters PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();

  let owner: SqlPool;
  let runtime: SqlPool;
  let projectApi: SqlPool;
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
    projectApi = createPostgresPool({ connectionString: projectApiUrl!, max: 2 });
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
    await Promise.all([owner?.end(), runtime?.end(), projectApi?.end()]);
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

  it("does not spend quota on an enqueue the queue itself refused", async () => {
    // Seit Release 1.30 steht die Messung **hinter** den Konflikten der
    // Operation. Eine wegen voller Warteschlange abgewiesene Nachricht hat
    // nichts verbraucht — bis 1.29 zaehlte sie trotzdem.
    const scope = await freshScope();
    const service = queues(scope);
    await service.createQueue(admin, scope, { name: "full", maxPendingMessages: 1 });
    await service.enqueue(worker, scope, "full", { payload: { order: 1 } });

    await expect(service.enqueue(worker, scope, "full", { payload: { order: 2 } }))
      .rejects.toMatchObject({ code: "QUEUE_CAPACITY_EXCEEDED" });
    expect(await counter(scope, "queue_operations")).toBe(1n);
  });

  it("rolls back a message that was already written when the count is refused", async () => {
    // Der eigentliche Nachweis der Atomaritaet: Die Zeile **existiert**, als
    // gemessen wird — die Messung liest sie ueber dieselbe Transaktion. Danach
    // ist sie weg. Ohne gemeinsame Transaktion waere sie geblieben.
    const scope = await freshScope();
    let seenInsideTransaction: string | null = null;
    const refusing: Pick<UsageService, "record"> = {
      async record(_principal, _scope, _input, transaction) {
        const rows = await transaction!.query<{ id: string }>(
          "SELECT id FROM project_queue_messages WHERE organization_id=$1 AND project_id=$2",
          [scope.organizationId, scope.projectId],
        );
        seenInsideTransaction = rows.rows[0]?.id ?? null;
        // Der Emitter liest nur `accepted`; alles Weitere waere Beiwerk.
        return { accepted: false } as unknown as PublicUsageDecision;
      },
    };

    const service = queues(scope, { ledger: refusing });
    await service.createQueue(admin, scope, { name: "rolled-back" });
    await expect(service.enqueue(worker, scope, "rolled-back", { payload: { order: 1 } }))
      .rejects.toMatchObject({ code: "QUEUE_QUOTA_EXCEEDED" });

    expect(seenInsideTransaction).toMatch(/^[0-9a-f-]{36}$/);
    const remaining = await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM project_queue_messages
        WHERE organization_id=$1 AND project_id=$2`, [scope.organizationId, scope.projectId],
    );
    expect(remaining.rows[0].count).toBe("0");
  });

  it("counts every simultaneous enqueue across queues exactly once", async () => {
    // **Über vier Queues**, nicht über eine. Enqueues derselben Queue
    // serialisieren ohnehin auf deren Zeile und erreichen die Zählersperre nie;
    // ein Fall mit einer einzigen Queue wäre grün geblieben, auch ohne sie. Die
    // Mutationsprobe hat genau das aufgedeckt.
    //
    // Vier gleichzeitige Transaktionen treffen jetzt wirklich auf denselben
    // Monatszähler. Fehlt dort die Sperre, lesen mehrere denselben Stand und
    // schreiben ihn absolut zurück — der Zähler bleibt hinter den Nachrichten.
    const scope = await freshScope();
    const service = queues(scope);
    const names = ["fan-a", "fan-b", "fan-c", "fan-d"];
    for (const name of names) await service.createQueue(admin, scope, { name });

    await Promise.all(names.flatMap((name, queueIndex) => [0, 1].map((slot) =>
      service.enqueue(worker, scope, name, { payload: { queueIndex, slot } }))));

    expect(await counter(scope, "queue_operations")).toBe(8n);
    const messages = await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM project_queue_messages
        WHERE organization_id=$1 AND project_id=$2`, [scope.organizationId, scope.projectId],
    );
    expect(messages.rows[0].count).toBe("8");
  }, 30_000);

  describe("post-hoc metrics", () => {
    it("counts the rows a real read actually returned", async () => {
      const scope = await freshScope();
      const schema = `metered_${randomUUID().replaceAll("-", "_")}`;
      await owner.query(`CREATE SCHEMA "${schema}"`);
      await owner.query(`CREATE TABLE "${schema}".items (id uuid PRIMARY KEY, owner_id text NOT NULL)`);
      // Ohne RLS weist die Generated Data API die Tabelle ab — richtigerweise.
      // Der erste Lauf dieses Falls scheiterte genau daran.
      await owner.query(`ALTER TABLE "${schema}".items ENABLE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY metered_owner_isolation ON "${schema}".items
        USING (owner_id = current_setting('request.jwt.claim.sub', true))
        WITH CHECK (owner_id = current_setting('request.jwt.claim.sub', true))`);
      await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO qkern_project_api_app`);
      await owner.query(`GRANT SELECT, INSERT ON "${schema}".items TO qkern_project_api_app`);
      const subject = randomUUID();
      for (let index = 0; index < 3; index += 1) {
        await owner.query(`INSERT INTO "${schema}".items (id, owner_id) VALUES ($1,$2)`,
          [randomUUID(), subject]);
      }

      const api = new GeneratedDataApiService(
        { resolveTarget: async () => ({ databaseInstanceRef: "managed:certification" }) },
        { resolve: async () => ({
          pool: projectApi,
          expectedRole: "qkern_project_api_app",
          expectedDatabase: new URL(projectApiUrl!).pathname.slice(1),
          expectedLedgerOwner: "qkern",
        }) },
        new ServiceUsageEmitter({ service: usage, source: "generated_data_api" }),
      );
      const context = {
        organizationId, actorRef: "certification:reader",
        claims: { role: "authenticated" as const, subject },
      };

      const listed = await api.listRows(context, scope, { schema, table: "items" });
      expect(listed.rowCount).toBe(3);
      expect(await counter(scope, "database_row_reads")).toBe(3n);

      // Eine Lesung ohne Treffer zaehlt nicht. Die Metrik heisst
      // database_row_reads, nicht database_reads.
      const empty = await api.listRows(context, scope, {
        schema, table: "items", filters: [{ column: "owner_id", operator: "eq", value: randomUUID() }],
      });
      expect(empty.rowCount).toBe(0);
      expect(await counter(scope, "database_row_reads")).toBe(3n);

      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    });

    it("counts the bytes a real download grant released", async () => {
      const scope = await freshScope();
      const provider = new MemoryProjectStorageProvider();
      const storage = new ProjectStorageService({
        repository: new PostgresProjectStorageRepository(new PostgresControlPlane(runtime)),
        provider,
        scanner: { async scan() { return "clean" as const; } },
        usage: new ServiceUsageEmitter({ service: usage, source: "project_storage" }),
      });
      const storageAdmin = { organizationId, actorRef: "owner@qkern.test", role: "admin" as const, subject: controlUser };
      const user = { organizationId, actorRef: "project-auth-user:alice", role: "authenticated" as const, subject: randomUUID() };

      const bucket = await storage.createBucket(storageAdmin, scope, {
        name: `metered-${randomUUID().slice(0, 8)}`,
        readPolicy: "owner", writePolicy: "owner", maxObjectBytes: 100, quotaBytes: 100,
      });
      const prepared = await storage.prepareUpload(user, scope, bucket.id, {
        key: "owner/file.png", contentType: "image/png", sizeBytes: 42,
        checksumSha256: CHECKSUM,
      });
      provider.putForTest(prepared.upload.fields.key, {
        sizeBytes: 42, contentType: "image/png", checksumSha256: CHECKSUM, etag: "e",
      });
      await storage.completeUpload(user, scope, {
        uploadId: prepared.uploadId, completionToken: prepared.completionToken,
      });

      await storage.createDownloadGrant(user, scope, bucket.id, { key: "owner/file.png" });
      expect(await counter(scope, "storage_egress_bytes")).toBe(42n);
      await storage.createDownloadGrant(user, scope, bucket.id, { key: "owner/file.png" });
      expect(await counter(scope, "storage_egress_bytes")).toBe(84n);
    });

    it("refuses a hard limit on a metric it could never enforce", async () => {
      // Beide Mengen stehen erst fest, wenn die Arbeit getan ist. Ein
      // enforce-Limit koennte dort nichts verhindern und wuerde nur aufhoeren
      // zu zaehlen — ein Zaehler, der stehen bleibt, waehrend die Nutzung
      // weiterlaeuft, ist schlimmer als gar keiner.
      const scope = await freshScope();
      for (const metric of ["database_row_reads", "storage_egress_bytes"] as const) {
        await expect(usage.setQuota(operator, scope, {
          metric, limit: 10, mode: "enforce", expectedRevision: null,
        })).rejects.toMatchObject({ code: "USAGE_INVALID_INPUT" });
        await expect(usage.setQuota(operator, scope, {
          metric, limit: 10, mode: "observe", expectedRevision: null,
        })).resolves.toMatchObject({ mode: "observe" });
      }
    });
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
