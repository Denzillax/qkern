import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { withTenantTransaction } from "@/lib/server/db/transaction";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Das Einreihen eines Apply-Auftrags — mit der Rolle, die es im Betrieb tut.
 *
 * Seit Migration 0019 war dieser Weg tot. `enqueueApproved()` schreibt das
 * Auftragsereignis mit `INSERT … ON CONFLICT (organization_id,
 * migration_job_id, event_type) DO NOTHING`, und ein **benannter** Arbiter
 * verlangt Leserecht auf genau diesen Spalten. 0019 hat der Laufzeit
 * `SELECT ON migration_outbox` entzogen — richtig gedacht, denn sie soll
 * weder Lease noch Broker-Zustand sehen — und damit das Einreihen
 * abgeschaltet.
 *
 * Auftrag und Ereignis stehen in einer Transaktion: Es entstand nicht ein
 * Auftrag ohne Ereignis, sondern gar nichts. Jede Freigabe mit automatischer
 * Einreihung scheiterte, seit es 0019 gibt.
 *
 * Gefunden hat das kein Prozesslauf, sondern der Rechteklausel-Vertrag aus
 * demselben Release — bevor jemand darueber gestolpert ist.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && runtimeUrl);

describe.runIf(enabled)("Migration enqueue PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();

  let owner: SqlPool;
  let runtime: SqlPool;
  let plane: PostgresControlPlane;

  /** Ein freigegebenes Change Set mit seiner Freigabe, bereit zum Einreihen. */
  async function approvedChange() {
    const changeSetId = randomUUID();
    const approvalId = randomUUID();
    await owner.query(`INSERT INTO change_sets
      (id,organization_id,project_id,environment,title,statement_sha256,encrypted_statement,risk,status,created_by)
      VALUES ($1,$2,$3,'development','enqueue',$4,$5,'low','approved',$6)`,
    [changeSetId, organizationId, projectId, randomUUID().replace(/-/g, "") + "a".repeat(32),
      Buffer.alloc(1), controlUser]);
    await owner.query(`INSERT INTO approval_requests
      (id,organization_id,project_id,change_set_id,environment,action_hash,status,expires_at)
      VALUES ($1,$2,$3,$4,'development',$5,'approved',now() + interval '1 hour')`,
    [approvalId, organizationId, projectId, changeSetId,
      randomUUID().replace(/-/g, "") + "b".repeat(32)]);
    return { changeSetId, approvalId };
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `enqueue-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
      VALUES ($1,'Enqueue',$2,$3)`, [organizationId, `enqueue-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Enqueue',$3,'test','ready',$4)`,
    [projectId, organizationId, `enqueue-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`, [organizationId, projectId, `managed:${projectId}`]);

    // Die Rolle der Laufzeit, nicht die des Eigentuemers.
    runtime = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: runtimeUrl!, max: 4 }), "runtime");
    plane = new PostgresControlPlane(runtime);
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([runtime?.end(), owner?.end()]);
  });

  it("queues an approved change set and its outbox event", async () => {
    const { changeSetId, approvalId } = await approvedChange();
    const result = await plane.withTenant(
      { organizationId, actorRef: "owner@qkern.test" },
      (repositories) => repositories.migrationJobs.enqueueApproved(changeSetId, approvalId));

    expect(result.created).toBe(true);
    expect(result.job.status).toBe("queued");

    // Nachgesehen wird mit der Eigentuemerrolle: Der Beleg soll nicht davon
    // abhaengen, was die Laufzeit selbst lesen darf.
    const event = await owner.query<{ event_type: string; status: string }>(
      `SELECT event_type, status FROM migration_outbox
       WHERE organization_id = $1 AND migration_job_id = $2`, [organizationId, result.job.id]);
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]?.event_type).toBe("migration.apply.requested");
  });

  it("stays idempotent when the same change set is queued twice", async () => {
    const { changeSetId, approvalId } = await approvedChange();
    const first = await plane.withTenant({ organizationId, actorRef: "owner@qkern.test" },
      (repositories) => repositories.migrationJobs.enqueueApproved(changeSetId, approvalId));
    const second = await plane.withTenant({ organizationId, actorRef: "owner@qkern.test" },
      (repositories) => repositories.migrationJobs.enqueueApproved(changeSetId, approvalId));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    // Genau **ein** Ereignis: Der benannte Arbiter ist der Grund, warum der
    // zweite Aufruf nichts schreibt statt zu scheitern.
    const events = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM migration_outbox
       WHERE organization_id = $1 AND migration_job_id = $2`, [organizationId, first.job.id]);
    expect(events.rows[0]?.n).toBe(1);
  });

  /**
   * Das neue Leserecht darf die Absicht von 0019 nicht aufheben.
   *
   * Erteilt sind die drei Arbiter-Spalten. Lease- und Broker-Zustand bleiben
   * fuer die Laufzeit unlesbar — sonst waere aus einer Reparatur eine
   * Rechteerweiterung geworden.
   */
  it("still hides lease and broker state from the runtime", async () => {
    for (const column of ["status", "lease_owner", "lease_token", "lease_expires_at",
      "failure_count", "available_at"]) {
      await expect(withTenantTransaction(
        runtime, { organizationId, actorRef: "owner@qkern.test" },
        (transaction) => transaction.query(`SELECT ${column} FROM migration_outbox`),
      ), `Die Laufzeit darf migration_outbox.${column} nicht lesen`).rejects.toThrow();
    }
  });
});
