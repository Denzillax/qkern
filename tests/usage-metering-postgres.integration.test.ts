import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import type { SqlPool } from "@/lib/server/db/sql";
import type { UsagePrincipal } from "@/lib/server/usage/model";
import { PostgresUsageRepository } from "@/lib/server/usage/postgres-repository";
import { UsageService } from "@/lib/server/usage/service";

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Usage Metering PostgreSQL certification", () => {
  let owner: SqlPool;
  let runtime: SqlPool;
  let repository: PostgresUsageRepository;
  let service: UsageService;
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const scope = { organizationId, projectId, environment: "development" as const };
  const operator: UsagePrincipal = {
    organizationId, actorRef: "operator:integration", subject: "operator-integration", role: "operator",
  };
  const meter: UsagePrincipal = {
    organizationId, actorRef: "meter:project-queues", subject: "meter-project-queues", role: "meter",
  };
  const reader: UsagePrincipal = {
    organizationId, actorRef: "usage-owner@qkern.test", subject: controlUser, role: "reader",
  };

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    runtime = verifyDatabaseBoundary(createPostgresPool({ connectionString: runtimeUrl!, max: 8 }), "runtime");
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `usage-owner-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
      VALUES ($1,'Usage Integration',$2,$3)`, [organizationId, `usage-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Usage',$3,'test','ready',$4)`,
    [projectId, organizationId, `usage-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`, [organizationId, projectId, `managed:${projectId}`]);
    repository = new PostgresUsageRepository(new PostgresControlPlane(runtime));
    service = new UsageService({ repository });
  });

  afterAll(async () => {
    // The organization must go first: organizations.created_by deliberately
    // restricts deleting its owner, while everything below it cascades.
    if (owner) {
      await owner.query("DELETE FROM audit_logs WHERE organization_id = $1", [organizationId]);
      await owner.query("DELETE FROM organizations WHERE id=$1", [organizationId]);
      await owner.query("DELETE FROM users WHERE id=$1", [controlUser]);
    }
    await Promise.all([owner?.end(), runtime?.end()]);
  });

  it("serializes concurrent hard-quota decisions and persists verifier-only events", async () => {
    await service.setQuota(operator, scope, {
      metric: "queue_operations", limit: 10, mode: "enforce", expectedRevision: null,
    });
    const decisions = await Promise.all([
      service.record(meter, scope, {
        metric: "queue_operations", source: "project_queues", quantity: 6,
        idempotencyKey: "postgres-usage-left",
      }),
      service.record(meter, scope, {
        metric: "queue_operations", source: "project_queues", quantity: 6,
        idempotencyKey: "postgres-usage-right",
      }),
    ]);
    expect(decisions.filter((item) => item.accepted)).toHaveLength(1);
    expect(decisions.filter((item) => !item.accepted)).toHaveLength(1);
    const stored = await owner.query<{ event_key_hash: string; count: number }>(`SELECT min(event_key_hash) AS event_key_hash,
      count(*)::int AS count FROM usage_events WHERE organization_id=$1 AND project_id=$2`, [organizationId, projectId]);
    expect(stored.rows[0]?.count).toBe(2);
    expect(stored.rows[0]?.event_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored.rows)).not.toMatch(/postgres-usage-(left|right)/);
  });

  it("returns the original denied decision after a repository restart", async () => {
    const first = await service.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 7,
      idempotencyKey: "postgres-denied-replay",
    });
    const restarted = new UsageService({
      repository: new PostgresUsageRepository(new PostgresControlPlane(runtime)),
    });
    const replay = await restarted.record(meter, scope, {
      metric: "queue_operations", source: "project_queues", quantity: 7,
      idempotencyKey: "postgres-denied-replay",
    });
    expect(first.accepted).toBe(false);
    expect(replay).toMatchObject({ accepted: false, deduplicated: true, used: first.used });
  });

  it("keeps the durable projection consistent with the accepted counter", async () => {
    const projection = await service.readProjection(reader, scope);
    expect(projection.metrics.find((item) => item.metric === "queue_operations"))
      .toMatchObject({ used: "6", limit: "10", mode: "enforce" });
  });

  it("lets tenant RLS project no policy or usage for another organization", async () => {
    const otherOrganizationId = randomUUID();
    const projection = await service.readProjection({
      organizationId: otherOrganizationId, actorRef: "reader:other", subject: randomUUID(), role: "reader",
    }, { ...scope, organizationId: otherOrganizationId });
    expect(projection.metrics.every((item) => item.used === "0" && item.limit === null)).toBe(true);
  });
});
