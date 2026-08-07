import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { PostgresComputeDefinitionRepository } from
  "@/lib/server/compute/definitions-postgres-repository";
import { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import { DockerFunctionSandbox } from "@/lib/server/compute/function-sandbox-docker";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { ProjectQueueFunctionDispatch } from "@/lib/server/project-queues/function-dispatch";
import { ProjectQueueHostRuntime } from "@/lib/server/project-queues/host-runtime";
import { PostgresProjectQueueRepository } from "@/lib/server/project-queues/postgres-repository";
import { ProjectQueueService } from "@/lib/server/project-queues/service";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

/**
 * Die ganze Kette in **einem** Lauf: echte Datenbank, echter Container.
 *
 * Release 1.23 hat Definitionen und Sandbox getrennt zertifiziert und offen
 * ausgewiesen, dass die Naht dazwischen ungeprüft bleibt. Genau an solchen
 * Nähten hat dieser Sprint mehrfach Fehler gefunden — der Poller, den niemand
 * rief; das Event-Log, das niemand benutzte; der Container, der seinen Timeout
 * überlebte. Diese Datei schliesst die letzte davon.
 *
 * **Seit Release 1.35 ist keine Stelle mehr ersetzt.** Bis dahin trug die
 * Definition eine erfundene Registry-Referenz, und beim Start des Containers
 * wurde genau dieser eine Argumentwert gegen die lokale Image-Id getauscht.
 * Jetzt läuft im Stack eine echte Registry: Das Test-Image wird gebaut,
 * gepusht, lokal gelöscht — und der Lauf holt es über seinen Digest zurück.
 *
 * Was die Registry ausschliesst, ist der stille Zwischenspeicher. Läge das
 * Image noch lokal, beantwortete der Cache die Frage und die Registry wäre
 * Kulisse.
 */

const image = process.env.QKERN_TEST_FUNCTION_IMAGE;
const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(image && ownerUrl && runtimeUrl);


describe.runIf(enabled)("Function chain certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const admin: ProjectQueuePrincipal = {
    organizationId, actorRef: "owner@qkern.test", role: "admin", subject: controlUser,
  };
  const serviceRole: ProjectQueuePrincipal = {
    organizationId, actorRef: "service-role:functions", role: "service_role", subject: "key-1",
  };

  let owner: SqlPool;
  const pools: SqlPool[] = [];
  let definitions: ComputeDefinitionService;
  let repository: PostgresComputeDefinitionRepository;
  let invocation: FunctionInvocationService;
  let queues: ProjectQueueService;

  const uniqueName = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `chain-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Function Chain', $2, $3)`,
    [organizationId, `chain-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Chain', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `chain-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);

    const pool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    pools.push(pool);
    repository = new PostgresComputeDefinitionRepository(new PostgresControlPlane(pool));
    definitions = new ComputeDefinitionService({ repository });
    // Nichts wird mehr getauscht. Die Sandbox ist die der Produktion, und der
    // Bezug, den sie bekommt, ist der aus der Registry.
    const sandbox = new DockerFunctionSandbox();
    invocation = new FunctionInvocationService({
      repository,
      invoker: {
        async invoke(definition, request) {
          return await sandbox.invoke(definition, request, {
            signal: AbortSignal.timeout(definition.timeoutMs),
          });
        },
      },
    });
    queues = new ProjectQueueService({
      repository: new PostgresProjectQueueRepository(new PostgresControlPlane(pool)),
    });
  });

  afterAll(async () => {
    await Promise.allSettled([...pools.map((entry) => entry.end()), owner?.end()]);
  });

  /** Legt die Definition genau so an, wie ein Betreiber es täte. */
  async function define(overrides: { maxConcurrency?: number; timeoutMs?: number } = {}) {
    return await definitions.createFunction(admin, scope, {
      name: uniqueName("chain"),
      image: image!,
      entrypoint: "handler.mjs",
      maxConcurrency: overrides.maxConcurrency ?? 1,
      timeoutMs: overrides.timeoutMs ?? 30_000,
      secretRefs: ["vault:functions/chain"],
    });
  }

  it("carries a stored definition all the way into a real container", async () => {
    const created = await define();
    const result = await invocation.invoke(serviceRole, scope, created.name, {
      mode: "echo", value: "chain",
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ received: "chain" });
    // Die Referenzen kommen aus der Datenbank und erreichen den Container als
    // Referenzen — nie als Werte.
    expect(result.body).toMatchObject({ secretRefs: ["vault:functions/chain"] });
  });

  it("still denies egress when the definition came from the database", async () => {
    const created = await define();
    const result = await invocation.invoke(serviceRole, scope, created.name, { mode: "egress" });
    expect(result.body).toMatchObject({ reached: false });
  });

  it("stops running a function the moment it is disabled", async () => {
    const created = await define();
    await invocation.invoke(serviceRole, scope, created.name, { mode: "echo" });

    await definitions.setFunctionEnabled(admin, scope, created.id, false);
    await expect(invocation.invoke(serviceRole, scope, created.name, { mode: "echo" }))
      .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
  });

  it("enforces the concurrency limit stored with the definition", async () => {
    // Die Grenze steht in der Datenbank und wird beim Aufruf durchgesetzt.
    // Ohne sie startet ein Aufrufer beliebig viele Container, bis der Host steht.
    const created = await define({ maxConcurrency: 1, timeoutMs: 4_000 });
    const slow = invocation.invoke(serviceRole, scope, created.name, { mode: "sleep" });
    for (let attempt = 0; attempt < 40 && invocation.concurrency(created.id) === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await expect(invocation.invoke(serviceRole, scope, created.name, { mode: "echo" }))
      .rejects.toMatchObject({ code: "COMPUTE_AT_CAPACITY" });

    await expect(slow).rejects.toBeDefined();
    expect(invocation.concurrency(created.id)).toBe(0);
  }, 90_000);

  it("hides a function of another organization from the chain", async () => {
    const created = await define();
    await expect(invocation.invoke(
      { ...serviceRole, organizationId: randomUUID() },
      { ...scope, organizationId: randomUUID() },
      created.name, { mode: "echo" },
    )).rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
  });
  /**
   * Die Kette bis ans andere Ende: einreihen, und ein echter Container laeuft.
   *
   * Release 1.42 hat dem Queue-Worker einen Wirt gegeben und dabei ausdruecklich
   * offen gelassen, dass die Kette Queue → Container in einem Lauf unbelegt
   * bleibt: Die Real-DB-Faelle dort verwenden einen erfundenen Aufrufer.
   *
   * Hier ist nichts erfunden. Die Definition kommt aus der Datenbank, das Image
   * aus der Registry, der Aufruf aus dem Wirt — und was der Container antwortet,
   * entscheidet ueber den Zustand der Nachricht.
   */
  function host(queue: string, functionName: string, workerId: string) {
    const principal = serviceRole;
    return new ProjectQueueHostRuntime({
      service: queues,
      entries: [{
        binding: { ...scope, queue, functionName },
        principal,
        workerId,
        handler: new ProjectQueueFunctionDispatch({
          functions: invocation, principal, scope, functionName,
        }),
      }],
      idleDelayMs: 10, errorDelayMs: 10, maxIterations: 3,
    });
  }

  it("runs a real container for an enqueued message", async () => {
    const created = await define();
    const queue = uniqueName("chain-queue");
    await queues.createQueue(admin, scope, { name: queue });
    await queues.enqueue(serviceRole, scope, queue, {
      payload: { mode: "echo", value: "from-the-queue" },
    });

    await host(queue, created.name, uniqueName("worker")).run();

    // Nichts in diesem Fall ruft `invoke` selbst. Zwischen `enqueue` und dem
    // Container liegen der Wirt, der Worker und die Lease.
    const status = await queues.status(admin, scope, queue);
    expect(status.completed).toBe(1);
    expect(status.available + status.inFlight + status.deadLettered).toBe(0);
  }, 120_000);

  /**
   * Derselbe Weg, aber gestartet wie im Betrieb: als eigener Prozess.
   *
   * Release 1.43 hat die Kette bis in den Container belegt und offen gelassen,
   * dass der Wirt dabei als Objekt lief. `npm run worker:queues` selbst hatte
   * keinen Lauf — und genau der Unterschied zwischen „das Modul tut es" und
   * „der Prozess tut es" ist das Muster, das dieser Sprint siebenmal gefunden
   * hat.
   *
   * Gestartet wird deshalb nichts nachgebaut, sondern die Datei, die hinter
   * `npm run worker:queues` steht.
   */
  it("consumes a message when started as the shipped process", async () => {
    const created = await define();
    const queue = uniqueName("chain-process");
    await queues.createQueue(admin, scope, { name: queue });
    await queues.enqueue(serviceRole, scope, queue, {
      payload: { mode: "echo", value: "from-the-process" },
    });

    const child = spawn(process.execPath, ["--import", "tsx", "workers/project-queue-runtime.mts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QKERN_QUEUE_WORKER_ENABLED: "true",
        QKERN_PROJECT_QUEUES_ENABLED: "true",
        QKERN_FUNCTIONS_ENABLED: "true",
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_STATEMENT_ENCRYPTION_KEY: "0".repeat(64),
        QKERN_RUNTIME_DATABASE_URL: runtimeUrl!,
        QKERN_QUEUE_WORKER_IDLE_MS: "100",
        QKERN_QUEUE_WORKER_BINDINGS_JSON: JSON.stringify([{
          ...scope, queue, functionName: created.name,
        }]),
      },
    });
    let noise = "";
    child.stderr.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { noise += chunk.toString(); });

    try {
      const deadline = Date.now() + 100_000;
      let completed = 0;
      while (Date.now() < deadline && completed === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        completed = (await queues.status(admin, scope, queue)).completed;
      }
      expect(completed, `Prozessausgabe: ${noise.slice(-800)}`).toBe(1);
    } finally {
      child.kill();
    }

    // Der Prozess meldet die Zahl seiner Bindungen und sonst nichts aus der
    // Konfiguration. Ein Passwort in einem Worker-Log ueberlebt jede Rotation.
    expect(noise).toContain("binding(s)");
    expect(noise).not.toContain("qkern_runtime_local_only");
    expect(noise).not.toContain("from-the-process");
  }, 180_000);

  it("keeps the message when the container answers with a failure", async () => {
    const created = await define();
    const queue = uniqueName("chain-fail");
    await queues.createQueue(admin, scope, { name: queue });
    // Ein unbekannter Modus laesst die Testfunction mit 400 antworten. Der
    // Container laeuft also wirklich — er sagt nur Nein.
    await queues.enqueue(serviceRole, scope, queue, { payload: { mode: "kein-modus" } });

    await host(queue, created.name, uniqueName("worker")).run();

    const status = await queues.status(admin, scope, queue);
    expect(status.completed).toBe(0);
    expect(status.available + status.scheduled + status.deadLettered).toBe(1);
  }, 120_000);
});
