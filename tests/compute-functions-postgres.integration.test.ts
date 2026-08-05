import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComputeDefinitionService } from "@/lib/server/compute/definitions";
import { PostgresComputeDefinitionRepository } from
  "@/lib/server/compute/definitions-postgres-repository";
import { FunctionInvocationService } from "@/lib/server/compute/function-invocation";
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
