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
 * Eine Stelle bleibt ersetzt, und nur eine: Ein lokal gebautes Test-Image hat
 * keinen Registry-Digest. Die Definition trägt deshalb eine echte, formgültige
 * Registry-Referenz, und erst beim Start des Containers wird genau dieser eine
 * Argumentwert gegen die lokale Image-Id getauscht. Jede Produktregel bleibt in
 * Kraft — Validator, Spalten-Check und Sandbox-Prüfung sehen die Referenz, die
 * ein Betreiber auch hinterlegen würde. Was kein lokaler Lauf zeigen kann, ist
 * die Aufloesung dieser Referenz durch eine echte Registry.
 */

const image = process.env.QKERN_TEST_FUNCTION_IMAGE;
const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(image && ownerUrl && runtimeUrl);

/** Formgültige Registry-Referenz. Beim Containerstart gegen die lokale Id getauscht. */
const PINNED = `registry.example.com/qkern/probe@sha256:${"a".repeat(64)}`;

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
    // Genau ein Argumentwert wird getauscht: die Registry-Referenz gegen die
    // lokale Image-Id. Alle Flags, stdin, Timeout und das harte Beenden bleiben
    // die der Produktions-Sandbox.
    const sandbox = new DockerFunctionSandbox({
      spawnFn: ((command: string, args: readonly string[], options: never) =>
        spawn(command, args.map((argument) => argument === PINNED ? image! : argument), options)
      ) as unknown as typeof spawn,
    });
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
  });

  afterAll(async () => {
    await Promise.allSettled([...pools.map((entry) => entry.end()), owner?.end()]);
  });

  /** Legt die Definition genau so an, wie ein Betreiber es täte. */
  async function define(overrides: { maxConcurrency?: number; timeoutMs?: number } = {}) {
    return await definitions.createFunction(admin, scope, {
      name: uniqueName("chain"),
      image: PINNED,
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
});
