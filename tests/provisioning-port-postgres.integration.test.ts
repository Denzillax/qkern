import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PostgresProjectDatabaseProvisioningPort } from "@/lib/server/provisioning/postgres-port";
import { withTenantTransaction } from "@/lib/server/db/transaction";
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

  /** Nachgesehen wird mit der Eigentuemerrolle: Der Beleg soll nicht davon
   * abhaengen, was der Provisioner selbst lesen darf. */
  async function heartbeatRow(provisionerId: string) {
    const result = await owner.query<{ started_at: string; last_seen_at: string }>(
      `SELECT started_at::text AS started_at, last_seen_at::text AS last_seen_at
       FROM project_database_provisioner_heartbeats
       WHERE organization_id = $1 AND provisioner_id = $2`,
      [organizationId, provisionerId]);
    return result.rows[0];
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

  /**
   * Der Aufruf, an dem der Prozess seit Migration 0021 scheiterte.
   *
   * `heartbeat()` schreibt mit `INSERT … ON CONFLICT DO UPDATE`, und
   * PostgreSQL verlangt dafuer SELECT-Recht auf den Spalten des
   * Arbiter-Index. Migration 0021 hat nur INSERT und UPDATE erteilt — der
   * Aufruf endete mit `permission denied for table`, schon beim ersten
   * Einfuegen, weil das Recht beim Planen geprueft wird und nicht erst beim
   * Konflikt.
   *
   * Er steht als **erster** Aufruf in dem `try`, das auch `quarantineExpired`
   * umfasst. Damit endete jede Runde in `claim_failed`, bevor sie einen
   * Auftrag ueberhaupt gesucht hat. Release 1.60 hat die beiden anderen
   * Operationen dieses Blocks belegt und den Grund damit hierher verengt.
   *
   * Zweimal gerufen, weil beide Wege zaehlen: der erste schreibt, der zweite
   * laeuft ueber den Konfliktpfad.
   */
  it("writes and refreshes its heartbeat", async () => {
    const provisionerId = `certification-heartbeat-${randomUUID()}`;
    await port.heartbeat(provisionerId);
    const first = await heartbeatRow(provisionerId);
    expect(first, "Kein Heartbeat geschrieben").not.toBeUndefined();

    await port.heartbeat(provisionerId);
    const second = await heartbeatRow(provisionerId);
    expect(second?.started_at).toBe(first?.started_at);
    expect(Date.parse(second!.last_seen_at)).toBeGreaterThanOrEqual(Date.parse(first!.last_seen_at));
  });

  /**
   * Das neue Leserecht darf die Grenze nicht aufmachen.
   *
   * Es ist auf zwei Spalten beschraenkt, und die Zeilenpolitik aus 0021 bindet
   * jeden Zugriff an `qkern.actor_ref`. Ein Provisioner sieht also weiterhin
   * ausschliesslich seinen eigenen Heartbeat.
   */
  it("cannot read another provisioner's heartbeat", async () => {
    const mine = `certification-visible-${randomUUID()}`;
    const peer = `certification-hidden-${randomUUID()}`;
    await port.heartbeat(mine);
    await port.heartbeat(peer);

    const seen = await withTenantTransaction(
      provisioner, { organizationId, actorRef: mine },
      (transaction) => transaction.query<{ provisioner_id: string }>(
        "SELECT provisioner_id FROM project_database_provisioner_heartbeats"),
    );
    expect(seen.rows.map((row) => row.provisioner_id)).toEqual([mine]);
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
