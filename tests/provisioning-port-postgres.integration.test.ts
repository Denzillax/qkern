import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PostgresProjectDatabaseProvisioningPort } from "@/lib/server/provisioning/postgres-port";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Der Provisionierungs-Port gegen echtes PostgreSQL, mit der echten Rolle.
 *
 * Release 1.59 hat den Versuch abgebrochen, den Provisioner **als Prozess** zu
 * belegen: Er meldet `claim_failed`, und dahinter steckt ein `PersistenceError`,
 * dessen Ursache verpackt bleibt. Die naheliegende Vermutung war, dass eine der
 * beiden Abfragen im selben Block scheitert — Uebernehmen oder Aufraeumen.
 *
 * Diese Faelle zeigen, dass **beide** gegen eine echte Datenbank funktionieren,
 * ausgefuehrt von `qkern_provisioner_app` und nicht von einer Eigentuemerrolle.
 * Damit ist die Vermutung widerlegt und die offene Frage kleiner geworden: Der
 * Grund liegt woanders.
 *
 * Das ist die schwaechere Aussage als ein Prozessnachweis — und sie ist belegt,
 * waehrend der Prozessnachweis es nicht ist.
 */

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const provisionerUrl = process.env.QKERN_TEST_PROVISIONER_DATABASE_URL;
const enabled = Boolean(ownerUrl && provisionerUrl);

describe.runIf(enabled)("Provisioning port PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();

  let owner: SqlPool;
  let provisioner: SqlPool;
  let port: PostgresProjectDatabaseProvisioningPort;

  /** Legt ein Projekt an, das noch auf seine Datenbank wartet. */
  async function pendingJob(target = organizationId) {
    const projectId = randomUUID();
    const jobId = randomUUID();
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Provisioning',$3,'test','provisioning',$4)`,
    [projectId, target, `provisioning-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`, [target, projectId, `pending:${projectId}`]);
    await owner.query(`INSERT INTO project_database_provisioning_jobs
      (id,organization_id,project_id,environment,requested_by,status)
      VALUES ($1,$2,$3,'development','certification','pending')`, [jobId, target, projectId]);
    return { projectId, jobId };
  }

  beforeAll(async () => {
    owner = createPostgresPool({ connectionString: ownerUrl!, max: 2 });
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `provisioning-port-${controlUser}@qkern.test`]);
    for (const [id, name] of [[organizationId, "Provisioning Port"],
      [foreignOrganizationId, "Provisioning Port Foreign"]] as const) {
      await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
        VALUES ($1,$2,$3,$4)`, [id, name, `provisioning-port-${id}`, controlUser]);
    }
    // Die Rolle des Prozesses, nicht die des Eigentuemers: Was hier gelingt,
    // gelingt mit genau den Rechten, die der Provisioner im Betrieb hat.
    provisioner = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: provisionerUrl!, max: 4 }), "provisioner",
    );
    port = new PostgresProjectDatabaseProvisioningPort(
      new PostgresControlPlane(provisioner), organizationId,
    );
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([provisioner?.end(), owner?.end()]);
  });

  it("claims a pending job and takes a lease", async () => {
    const { jobId } = await pendingJob();
    const claimed = await port.claimNext("certification-provisioner-1", 60_000);

    expect(claimed, "Kein Auftrag uebernommen").not.toBeNull();
    expect(claimed?.job.status).toBe("running");
    expect(claimed?.job.leaseOwner).toContain("certification-provisioner-1");
    expect(claimed?.job.attemptCount).toBe(1);
    // Der Auftrag dieses Falls kann von einem parallelen Fall stammen; belegt
    // wird die Uebernahme, nicht welcher der beiden zuerst drankam.
    expect(jobId).toBeTruthy();
  });

  it("leaves a fresh lease alone when it looks for expired ones", async () => {
    // Direkt nach dem Uebernehmen ist keine Lease abgelaufen. Ein Aufraeumer,
    // der hier etwas faende, naehme laufende Arbeit weg.
    const quarantined = await port.quarantineExpired("certification-provisioner-1");
    expect(quarantined).toEqual([]);
  });

  it("does not see another organization's job", async () => {
    const { jobId } = await pendingJob(foreignOrganizationId);
    const foreign = new PostgresProjectDatabaseProvisioningPort(
      new PostgresControlPlane(provisioner), organizationId,
    );

    // Der Port ist an seine Organisation gebunden. Ein fremder Auftrag ist fuer
    // ihn nicht vorhanden — nicht bloss ungeeignet.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const claimed = await foreign.claimNext("certification-provisioner-2", 60_000);
      if (!claimed) break;
      expect(claimed.job.id).not.toBe(jobId);
      expect(claimed.job.organizationId).toBe(organizationId);
    }
    const row = await owner.query<{ status: string }>(
      "SELECT status FROM project_database_provisioning_jobs WHERE id=$1", [jobId]);
    expect(row.rows[0]?.status).toBe("pending");
  });
});
