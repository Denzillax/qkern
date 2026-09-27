import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PostgresProjectDatabaseProvisioningPort } from "@/lib/server/provisioning/postgres-port";
// Einstellungen -> Compute und Disk (2.88): derselbe Dienst, den die Route
// benutzt, und der feste Vertragsabdruck, ohne den eine Bindung nicht
// ausdrueckbar ist.
import { PostgresProjectDatabaseProvisioningService } from "@/lib/server/provisioning/services";
import { PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256 } from "@/lib/server/provisioning/contract";
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
// Seit 2.88 liest auch die Web-Laufzeit hier mit: Einstellungen -> Compute
// und Disk fragt den Zustand eines Auftrags, und die Grenze dieser Rolle ist
// die Aussage der Seite.
const runtimeUrl = process.env.QKERN_TEST_RUNTIME_DATABASE_URL;
const enabled = Boolean(ownerUrl && provisionerUrl);

describe.runIf(enabled)("Provisioning port PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();

  let owner: SqlPool;
  let provisioner: SqlPool;
  let runtime: SqlPool | undefined;
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
    // Die Rolle der Web-Laufzeit, fuer den Fall (2.88). Sie steht hier neben
    // der des Provisionierers, weil der Unterschied zwischen beiden genau die
    // Aussage ist, die belegt werden soll.
    if (runtimeUrl) {
      runtime = verifyDatabaseBoundary(
        createPostgresPool({ connectionString: runtimeUrl, max: 2 }), "runtime",
      );
    }
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([provisioner?.end(), runtime?.end(), owner?.end()]);
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

  it.runIf(Boolean(runtimeUrl))(
    "(2.88) hands the web runtime the order of its own tenant and never a field of the binding",
    async () => {
      // Einstellungen -> Compute und Disk (2.88) gegen die echte Datenbank.
      //
      // Der Platzhalter versprach eine Instanz- und eine Plattengroesse und
      // behauptete dazu, die Provisionierung sei noch nicht verbunden. Beides
      // war falsch, und die Seite sagt es jetzt. Vier ihrer Saetze sind
      // Aussagen ueber Rechte und ueber die Form von Zeilen, also genau die
      // Art Aussage, die nur eine echte Datenbank beantworten kann:
      //
      // 1. Weder ein Auftrag noch eine Bindung traegt eine Groesse. Gefragt
      //    wird der Katalog des laufenden Servers, nicht der Text der
      //    Migration.
      // 2. Die Web-Laufzeit **darf** beide Tabellen nicht lesen. Nicht
      //    "liest nicht": Der Versuch endet mit permission denied.
      // 3. Durch die eine Funktion, die sie aufrufen darf, bekommt sie den
      //    Auftrag ihres eigenen Mandanten, und die Antwort traegt genau die
      //    zehn Felder der Projektion. Keine Bindung, keine Pacht, kein
      //    Urheber.
      // 4. Der Nachbarmandant sieht mit derselben Kennung nichts, unter der
      //    Zeilensicherheit und nicht, weil die Kennung falsch waere.
      //
      // Der Fall steht in dieser Datei und nicht in `postgres.integration`,
      // weil STATUS.md dort eine gezaehlte Zahl von Faellen behauptet. Diese
      // Datei laeuft im selben Stack und wird von keiner solchen Zahl
      // beansprucht; der Beleg ist derselbe, die Buchhaltung bleibt ehrlich.
      //
      // Echt ist alles am Lesepfad: die echten Tabellen, die echten Policies,
      // die echten Rechte von `qkern_runtime` und darueber derselbe
      // `PostgresProjectDatabaseProvisioningService`, den die Route benutzt.
      // Bis jetzt hat keine Ansicht der Console diese Lesung gemacht.
      const service = new PostgresProjectDatabaseProvisioningService(
        new PostgresControlPlane(runtime!),
      );
      const contextFor = (organization: string) => ({
        organizationId: organization,
        actor: { ref: `provisioning-view-${organization}@qkern.test`, type: "user" as const },
      });

      /** Ein Projekt, dessen Umgebung noch auf keine Datenbank zeigt. */
      const pendingProject = async (target: string) => {
        const projectId = randomUUID();
        await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
          VALUES ($1,$2,'Compute und Disk',$3,'test','provisioning',$4)`,
        [projectId, target, `compute-disk-${projectId}`, controlUser]);
        await owner.query(`INSERT INTO project_environments
          (organization_id,project_id,environment,database_instance_ref)
          VALUES ($1,$2,'development',$3)`, [target, projectId, `pending:${projectId}`]);
        return projectId;
      };
      const mineProject = await pendingProject(organizationId);
      const neighbourProject = await pendingProject(foreignOrganizationId);

      // --- Zusage 1: keine Groesse, gefragt beim Server ------------------
      //
      // Faellt das hier, hat jemand eine Spalte hinzugefuegt, und der erste
      // Satz der Seite ist still falsch geworden.
      const columns = await owner.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('project_database_provisioning_jobs', 'project_database_bindings')
          ORDER BY table_name, ordinal_position`);
      expect(columns.rows.length, "die beiden Tabellen fehlen").toBeGreaterThan(20);
      for (const row of columns.rows) {
        expect(
          /size|cpu|memory|ram|disk|storage|plan|tier|class|instance_type/.test(row.column_name),
          `${row.table_name}.${row.column_name} sieht nach einer Ausstattung aus`,
        ).toBe(false);
      }
      // Die Gegenprobe zur Suche selbst: Die Spalten, von denen die Seite
      // spricht, sind wirklich da. Sonst pruefte die Schleife oben nur, dass
      // eine leere Liste nichts enthaelt.
      const named = columns.rows.map((row) => `${row.table_name}.${row.column_name}`);
      for (const column of [
        "project_database_provisioning_jobs.attempt_count",
        "project_database_provisioning_jobs.binding_id",
        "project_database_bindings.database_instance_ref",
        "project_database_bindings.server_certificate_sha256",
      ]) {
        expect(named, column).toContain(column);
      }

      // --- Zusage 2: die Web-Laufzeit darf beide Tabellen nicht lesen ----
      //
      // "Darf nicht", nicht "sieht nichts": Eine leere Antwort waere auch bei
      // einer blossen Zeilenpolitik moeglich. Hier faellt schon die Anweisung.
      //
      // Geprueft wird der Grund, nicht bloss dass es scheitert: Der
      // Tenant-Wrapper verpackt jeden Treiberfehler als `PersistenceError`
      // und wuerde einen Tippfehler im Tabellennamen genauso melden. Die
      // Aussage steckt in der Ursache, und das ist der SQLSTATE 42501,
      // `insufficient_privilege`.
      for (const table of ["project_database_provisioning_jobs", "project_database_bindings"]) {
        const denied = await withTenantTransaction(
          runtime!, { organizationId }, async (transaction) =>
            transaction.query(`SELECT 1 FROM ${table} LIMIT 1`),
        ).then(() => null, (error: unknown) => error);
        expect(denied, `${table}: die Laufzeit durfte lesen`).not.toBeNull();
        expect((denied as { code?: string }).code, table).toBe("PERSISTENCE_ERROR");
        const cause = (denied as { cause?: { code?: string; message?: string } }).cause;
        expect(cause?.code, `${table}: ${cause?.message ?? "keine Ursache"}`).toBe("42501");
      }
      // Und die Gegenprobe: Dieselbe Rolle darf sehr wohl etwas lesen, sonst
      // belegte die Ablehnung oben nur eine kaputte Verbindung.
      const reachable = await withTenantTransaction(
        runtime!, { organizationId }, async (transaction) =>
          transaction.query<{ id: string }>(
            "SELECT id FROM projects WHERE id = $1", [mineProject]));
      expect(reachable.rows.map((row) => row.id)).toEqual([mineProject]);

      // --- Zusage 3: der eigene Auftrag, und nur seine zehn Felder -------
      const requested = await service.request(contextFor(organizationId), mineProject, "development");
      expect(requested.outcome).toBe("requested");
      const status = await service.getStatus(contextFor(organizationId), mineProject, "development");
      // Genau die Felder der Projektion. Ein elftes waere ein Leck, ein
      // fehlendes eine Seite, die etwas zeigt, was nie ankommt.
      expect(Object.keys(status).slice().sort()).toEqual([
        "attemptCount", "createdAt", "environment", "jobId", "maxAttempts",
        "maxRetryCycles", "projectId", "retryCycleCount", "status", "updatedAt",
      ]);
      expect(status).toMatchObject({
        projectId: mineProject, environment: "development", status: "pending",
        attemptCount: 0, maxAttempts: 5, retryCycleCount: 0, maxRetryCycles: 3,
      });
      // Und die Antwort traegt nichts, was in der Zeile steht und dort
      // bleiben soll.
      const serialised = JSON.stringify(status);
      expect(serialised).not.toContain(`provisioning-view-${organizationId}@qkern.test`);
      expect(serialised).not.toContain(organizationId);

      // --- Zusage 4: der Nachbarmandant sieht nichts ---------------------
      //
      // Dieselbe Kennung, ein anderer Mandant. Nicht "leer", sondern "gibt es
      // nicht": Unter der Zeilensicherheit ist ein fremdes Projekt kein
      // Projekt.
      await expect(service.getStatus(contextFor(foreignOrganizationId), mineProject, "development"))
        .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
      // Die Gegenprobe: Fuer sein eigenes Projekt geht derselbe Aufruf, sonst
      // belegte die Ablehnung oben nur, dass der Nachbar gar nichts kann.
      await service.request(contextFor(foreignOrganizationId), neighbourProject, "development");
      const neighbourStatus = await service.getStatus(
        contextFor(foreignOrganizationId), neighbourProject, "development");
      expect(neighbourStatus.projectId).toBe(neighbourProject);
      expect(neighbourStatus.jobId).not.toBe(status.jobId);
      // Und umgekehrt genauso.
      await expect(service.getStatus(contextFor(organizationId), neighbourProject, "development"))
        .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

      // --- Zusage 5: eine echte Bindung, und trotzdem kein Feld davon ----
      //
      // Erfolgreich ist ohne Bindung nicht ausdrueckbar; das ist der Satz
      // `bindingMeaning` der Seite. Hier wird eine echte geschrieben, damit
      // die Aussage danach etwas behauptet: Der Auftrag steht auf
      // erfolgreich, die Bindung ist wirklich da, und die Laufzeit bekommt
      // von ihr immer noch nichts.
      const bindingId = randomUUID();
      await owner.query(`INSERT INTO project_database_bindings (
          id, organization_id, project_id, environment, provisioning_job_id,
          database_instance_ref, vault_static_role, host, port,
          expected_role, expected_database, expected_ledger_owner,
          server_certificate_sha256, bootstrap_contract_sha256)
        VALUES ($1,$2,$3,'development',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        bindingId, organizationId, mineProject, status.jobId,
        `managed:${mineProject}`, "qkern-static-role", "db.internal.invalid", 5432,
        "qkern_app_role", "qkern_project_db", "qkern_ledger_owner",
        "a".repeat(64), PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256,
      ]);
      await owner.query(`UPDATE project_database_provisioning_jobs
          SET status='succeeded', binding_id=$1, started_at=now(), finished_at=now()
        WHERE organization_id=$2 AND id=$3`, [bindingId, organizationId, status.jobId]);
      // Die Bindung ist wirklich da, gelesen mit der Rolle, die es darf.
      const stored = await owner.query<{ host: string }>(
        "SELECT host FROM project_database_bindings WHERE id=$1", [bindingId]);
      expect(stored.rows).toHaveLength(1);

      const succeeded = await service.getStatus(contextFor(organizationId), mineProject, "development");
      expect(succeeded.status).toBe("succeeded");
      // Dieselben zehn Felder wie vorher. Nicht einmal die Kennung der
      // Bindung kommt mit, und erst recht nicht ihre Adresse.
      expect(Object.keys(succeeded).slice().sort()).toEqual(Object.keys(status).slice().sort());
      const afterBinding = JSON.stringify(succeeded);
      for (const hidden of [bindingId, "db.internal.invalid", "qkern-static-role", "a".repeat(64)]) {
        expect(afterBinding, hidden).not.toContain(hidden);
      }
      // Und der Nachbar sieht auch jetzt nichts von dieser Bindung.
      await expect(service.getStatus(contextFor(foreignOrganizationId), mineProject, "development"))
        .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    }, 120_000);
});
