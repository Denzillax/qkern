import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { PostgresComputeDefinitionRepository } from
  "@/lib/server/compute/definitions-postgres-repository";
import { PostgresFunctionConcurrency } from "@/lib/server/compute/function-concurrency";
import { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
import { FunctionInvocationError } from "@/lib/server/compute/functions";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { ProjectQueuePrincipal } from "@/lib/server/project-queues/model";

/**
 * Function-Definitionen gegen echtes PostgreSQL.
 *
 * Der Kern ist derselbe wie bei Cron und Webhooks: Die Unveränderlichkeit von
 * Bild, Entrypoint und Grenzen trägt das Spaltenrecht aus Migration 0033, nicht
 * eine Prüfung im Dienst. Ein Test gegen einen Memory-Port könnte das nicht
 * belegen.
 *
 * Dazu der Auflösungsweg eines Aufrufs: Eine abgeschaltete Function ist kein
 * Ziel mehr, und zwar sofort — nicht erst nach einem Neustart.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

const pinnedImage = `registry.example.com/qkern/probe@sha256:${"a".repeat(64)}`;

describe.runIf(enabled)("Function definitions PostgreSQL certification", () => {
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
  let service: ComputeDefinitionService;
  let repository: PostgresComputeDefinitionRepository;
  const invoked: string[] = [];
  let invocation: FunctionInvocationService;

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
    [controlUser, `functions-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Functions', $2, $3)`,
    [organizationId, `functions-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Functions', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `functions-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);

    repository = new PostgresComputeDefinitionRepository(new PostgresControlPlane(pool()));
    service = new ComputeDefinitionService({ repository });
    invocation = new FunctionInvocationService({
      repository,
      invocationLog: repository,
      // Die Sandbox selbst ist in `test:functions:docker` zertifiziert. Hier
      // zaehlt der Weg dorthin: Wird die richtige, aktive Definition aufgeloest?
      invoker: {
        async invoke(definition) {
          invoked.push(definition.image);
          return Object.freeze({ statusCode: 200, headers: {}, body: { ok: true } });
        },
      },
    });
  });

  afterAll(async () => {
    await Promise.allSettled([...pools.map((entry) => entry.end()), owner?.end()]);
  });

  async function define(overrides: { name?: string; enabled?: boolean } = {}) {
    return await service.createFunction(admin, scope, {
      name: overrides.name ?? uniqueName("fn"),
      image: pinnedImage,
      entrypoint: "handler.mjs",
      secretRefs: ["vault:functions/probe"],
      enabled: overrides.enabled ?? true,
    });
  }

  it("creates, lists and pauses a function through the unprivileged runtime role", async () => {
    const created = await define();
    expect(created.enabled).toBe(true);
    expect((await service.listFunctions(admin, scope)).some((entry) => entry.id === created.id))
      .toBe(true);

    const paused = await service.setFunctionEnabled(admin, scope, created.id, false);
    expect(paused.enabled).toBe(false);
    expect(paused.image).toBe(pinnedImage);
  });

  it("denies the runtime role any change beyond the enabled flag", async () => {
    // Der Kern: Die Unveraenderlichkeit traegt das Spaltenrecht, nicht der
    // Dienst — und nur ein echter Server kann das zeigen.
    const created = await define();
    const runtime = pool();
    await expect(runtime.query(
      "UPDATE project_functions SET image=$2 WHERE id=$1",
      [created.id, `registry.example.com/qkern/other@sha256:${"b".repeat(64)}`],
    )).rejects.toMatchObject({ message: expect.stringContaining("permission denied") });

    await expect(runtime.query(
      "UPDATE project_functions SET memory_mib=2048 WHERE id=$1", [created.id],
    )).rejects.toMatchObject({ message: expect.stringContaining("permission denied") });
  });

  it("refuses an image that is not pinned to a digest", async () => {
    await expect(owner.query(
      `INSERT INTO project_functions
         (organization_id, project_id, environment, name, runtime, image, entrypoint)
       VALUES ($1,$2,'development',$3,'nodejs24','registry.example.com/qkern/probe:latest','handler.mjs')`,
      [organizationId, projectId, uniqueName("tagged")],
    )).rejects.toMatchObject({ message: expect.stringContaining("project_functions_image_check") });
  });

  it("refuses a second function with the same name", async () => {
    const name = uniqueName("duplicate");
    await define({ name });
    await expect(define({ name })).rejects.toMatchObject({ code: "COMPUTE_CONFLICT" });
  });

  it("resolves an enabled function for a service role and stops resolving a paused one", async () => {
    // Ein zwischengespeichertes Bild wuerde nach dem Abschalten weiterlaufen.
    // Der Aufrufweg liest die Definition bei jedem Aufruf neu.
    const created = await define();
    invoked.length = 0;
    await invocation.invoke(serviceRole, scope, created.name, { probe: true });
    expect(invoked).toEqual([pinnedImage]);

    await service.setFunctionEnabled(admin, scope, created.id, false);
    await expect(invocation.invoke(serviceRole, scope, created.name, {}))
      .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
  });

  /**
   * Das Aufrufprotokoll (1.89) mit der Laufzeitrolle: ein gelungener und ein
   * gescheiterter Aufruf, neueste zuerst, der gescheiterte nur mit festem
   * Code — nie mit einer Meldung. Die Mutationsprobe dieses Releases
   * protokolliert nur noch Erfolge; dann fehlt der gescheiterte Eintrag, und
   * dieser Fall faellt.
   */
  it("records completed and failed invocations and lists them newest first", async () => {
    const created = await define();
    await invocation.invoke(serviceRole, scope, created.name, { step: 1 });
    const failing = new FunctionInvocationService({
      repository, invocationLog: repository,
      // Dieselbe echte Uhr wie der erste Aufruf: "neueste zuerst" ist nur mit
      // einer gemeinsamen Uhr eine pruefbare Aussage (Lektion aus 1.85).
      invoker: { async invoke() { throw new FunctionInvocationError("FUNCTION_TIMEOUT"); } },
    });
    await expect(failing.invoke(serviceRole, scope, created.name, { step: 2 }))
      .rejects.toMatchObject({ code: "FUNCTION_TIMEOUT" });

    const entries = await service.listFunctionInvocations(admin, scope, created.id);
    expect(entries.map((entry) => [entry.outcome, entry.statusCode, entry.errorCode])).toEqual([
      ["failed", null, "FUNCTION_TIMEOUT"],
      ["completed", 200, null],
    ]);
    expect(entries.every((entry) => entry.invokedBy === serviceRole.actorRef)).toBe(true);
    // Nur feste Codes im festen Alphabet und nur die Record-Schluessel — keine
    // Meldung, kein Stack, kein Feld, das eine Sandbox-Zeile tragen koennte.
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(
        ["durationMs", "errorCode", "invocationId", "invokedBy", "outcome", "startedAt", "statusCode"]);
      if (entry.errorCode !== null) expect(entry.errorCode).toMatch(/^[A-Z_]{3,64}$/);
    }
    await expect(service.listFunctionInvocations(admin, scope, created.id, 0))
      .rejects.toMatchObject({ code: "COMPUTE_INVALID_INPUT" });
  });

  it("hides functions of a different organization", async () => {
    const created = await define();
    const outsider: ProjectQueuePrincipal = { ...admin, organizationId: randomUUID() };
    const foreign = { ...scope, organizationId: outsider.organizationId };
    expect(await service.listFunctions(outsider, foreign)).toEqual([]);
    await expect(invocation.invoke(
      { ...serviceRole, organizationId: outsider.organizationId }, foreign, created.name, {},
    )).rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
  });

  it("deletes a function", async () => {
    const created = await define();
    await service.deleteFunction(admin, scope, created.id);
    await expect(service.getFunction(admin, scope, created.id))
      .rejects.toMatchObject({ code: "COMPUTE_NOT_FOUND" });
  });
});

/**
 * Die Nebenlaeufigkeitsgrenze ueber Prozessgrenzen hinweg.
 *
 * Bis Release 1.35 zaehlte jede Instanz fuer sich; die tatsaechliche Obergrenze
 * war `maxConcurrency × Instanzen`. Zwei getrennte Dienste in derselben Datei
 * sind der naechstliegende ehrliche Ersatz fuer zwei Prozesse: Sie teilen
 * nichts ausser der Datenbank — genau wie zwei Web-Instanzen.
 */
describe.runIf(enabled)("Function concurrency across instances", () => {
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
  const image = `registry.example.com/qkern/probe@sha256:${"b".repeat(64)}`;

  let owner: SqlPool;
  const pools: SqlPool[] = [];
  let definitions: ComputeDefinitionService;
  let shared: PostgresFunctionConcurrency;

  /** Ein Aufruf, der haengt, bis er freigegeben wird — der Platz bleibt belegt. */
  function gate() {
    let open!: () => void;
    const held = new Promise<void>((resolve) => { open = resolve; });
    return { held, open };
  }

  function instance(name: string, invoker: () => Promise<void>) {
    const repository = new PostgresComputeDefinitionRepository(new PostgresControlPlane(pool()));
    return new FunctionInvocationService({
      repository,
      concurrency: new PostgresFunctionConcurrency(
        new PostgresControlPlane(pool()), `instance:${name}`,
      ),
      invoker: {
        async invoke() {
          await invoker();
          return Object.freeze({ statusCode: 200, headers: {}, body: { ok: true } });
        },
      },
    });
  }

  function pool() {
    const created = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime",
    );
    pools.push(created);
    return created;
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id, email, password_hash, status)
      VALUES ($1, $2, '$argon2id$integration-only', 'active')`,
    [controlUser, `slots-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id, name, slug, created_by)
      VALUES ($1, 'Function Slots', $2, $3)`,
    [organizationId, `slots-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
      VALUES ($1, $2, 'Slots', $3, 'test', 'ready', $4)`,
    [projectId, organizationId, `slots-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id, project_id, environment, database_instance_ref)
      VALUES ($1, $2, 'development', $3)`, [organizationId, projectId, `managed:${projectId}`]);

    definitions = new ComputeDefinitionService({
      repository: new PostgresComputeDefinitionRepository(new PostgresControlPlane(pool())),
    });
    shared = new PostgresFunctionConcurrency(new PostgresControlPlane(pool()), "instance:observer");
  });

  afterAll(async () => {
    await Promise.allSettled([...pools.map((entry) => entry.end()), owner?.end()]);
  });

  async function define(maxConcurrency: number) {
    return await definitions.createFunction(admin, scope, {
      name: `slots-${randomUUID().slice(0, 8)}`,
      image, entrypoint: "handler.mjs", maxConcurrency, timeoutMs: 1_000,
    });
  }

  it("stops a second instance once the shared limit is reached", async () => {
    const created = await define(1);
    const first = gate();
    const running = instance("a", () => first.held).invoke(serviceRole, scope, created.name, {});
    for (let attempt = 0; attempt < 60 && await shared.active(scope, created.id) === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    // Die zweite Instanz hat einen eigenen, leeren Zaehler. Nur der geteilte
    // Platz haelt sie auf.
    await expect(instance("b", async () => undefined).invoke(serviceRole, scope, created.name, {}))
      .rejects.toMatchObject({ code: "COMPUTE_AT_CAPACITY" });

    first.open();
    await running;
    expect(await shared.active(scope, created.id)).toBe(0);
  }, 30_000);

  it("hands the place on once the first instance is done", async () => {
    const created = await define(1);
    await instance("a", async () => undefined).invoke(serviceRole, scope, created.name, {});
    await expect(instance("b", async () => undefined).invoke(serviceRole, scope, created.name, {}))
      .resolves.toMatchObject({ statusCode: 200 });
  }, 30_000);

  it("reclaims the place of an instance that never came back", async () => {
    // Ein abgestuerzter Prozess gibt nichts frei. Ohne Ablauf bliebe die
    // Function dauerhaft voll — derselbe Fehler, den Release 1.24 schon einmal
    // prozesslokal behoben hat.
    const created = await define(1);
    await owner.query(
      `INSERT INTO project_function_slots
         (organization_id, project_id, environment, function_id, holder, claimed_at, expires_at)
       VALUES ($1,$2,$3,$4,'instance:crashed', now() - interval '10 minutes', now() - interval '1 minute')`,
      [organizationId, projectId, "development", created.id],
    );
    expect(await shared.active(scope, created.id)).toBe(0);

    await expect(instance("b", async () => undefined).invoke(serviceRole, scope, created.name, {}))
      .resolves.toMatchObject({ statusCode: 200 });
  }, 30_000);

  it("counts the places of one definition only", async () => {
    const busy = await define(1);
    const other = await define(1);
    const first = gate();
    const running = instance("a", () => first.held).invoke(serviceRole, scope, busy.name, {});
    for (let attempt = 0; attempt < 60 && await shared.active(scope, busy.id) === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    // Eine belegte Function darf keine andere blockieren.
    await expect(instance("b", async () => undefined).invoke(serviceRole, scope, other.name, {}))
      .resolves.toMatchObject({ statusCode: 200 });

    first.open();
    await running;
  }, 30_000);

  it("refuses to change a place instead of extending it", async () => {
    // Kein UPDATE-Recht und ein Trigger dahinter. Eine verlaengerbare Zeile
    // waere ein Weg, die Grenze zu umgehen, ohne sie zu verletzen.
    const created = await define(1);
    await owner.query(
      `INSERT INTO project_function_slots
         (organization_id, project_id, environment, function_id, holder, expires_at)
       VALUES ($1,$2,$3,$4,'instance:probe', now() + interval '5 minutes')`,
      [organizationId, projectId, "development", created.id],
    );
    await expect(owner.query(
      `UPDATE project_function_slots SET expires_at = now() + interval '1 hour'
        WHERE organization_id=$1 AND function_id=$2`, [organizationId, created.id],
    )).rejects.toMatchObject({ message: expect.stringContaining("immutable") });
  }, 30_000);
});
