import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AesGcmStatementCipher, approvalActionHash, sha256 } from "@/lib/server/control-plane/crypto";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PostgresMigrationQueue } from "@/lib/server/migrations/postgres-queue";
import { FENCE_BOUNDARY_SQL } from "@/lib/server/migrations/postgres-executor";
import type { SqlPool } from "@/lib/server/db/sql";

/**
 * Der Prozess, der fremde Datenbanken veraendert — als Prozess.
 *
 * `MigrationWorker` ist seit Stufe 0.1 zertifiziert, aber immer als
 * Bibliothek. Ein Lauf, der `npm run worker:migrations` startet und danach in
 * der **Zieldatenbank** nachsieht, gab es nie. Release 1.44 hat gezeigt, was
 * dieser Unterschied wert ist: Damals konnte der Prozess ueberhaupt nicht
 * starten, und keine Zertifizierung hat es bemerkt.
 *
 * Von den fuenf Prozessen ohne Arbeitsnachweis ist dieser der folgenreichste:
 * Er ist der einzige, der Kundendatenbanken schreibt.
 *
 * Zwischen Auftrag und Wirkung liegt hier nichts Nachgebautes — echte
 * Zieldatenbank mit echtem Ledger, echte Rollen, echter Prozess.
 */

const adminUrl = process.env.QKERN_TEST_ADMIN_DATABASE_URL;
const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL;
const workerUrl = process.env.QKERN_TEST_WORKER_DATABASE_URL;
const allowCreate = process.env.QKERN_TEST_ALLOW_DATABASE_CREATE_DROP === "true";
const enabled = Boolean(adminUrl && ownerUrl && workerUrl && allowCreate);

const KEY = "0".repeat(64);
const MIGRATOR_PASSWORD = "qkern_project_migrator_local_only";

/** `postgres://user:pw@host:port/other` mit ausgetauschtem Datenbanknamen. */
function databaseUrl(base: string, name: string) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

function identifier(name: string) {
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(name)) throw new Error("unsafe identifier");
  return `"${name}"`;
}

describe.runIf(enabled)("Migration process PostgreSQL certification", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const databaseName = `qkern_project_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const instanceRef = `managed:${projectId}`;

  let admin: SqlPool;
  let owner: SqlPool;
  let project: SqlPool;

  beforeAll(async () => {
    admin = createPostgresPool({ connectionString: adminUrl!, max: 2, statementTimeoutMillis: 120_000 });

    // Die Rollen sind clusterweit. Ein zweiter Lauf im selben Cluster findet
    // sie vor, und das ist kein Fehler.
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qkern_ledger_owner') THEN
        CREATE ROLE qkern_ledger_owner NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qkern_project_migrator') THEN
        CREATE ROLE qkern_project_migrator LOGIN PASSWORD '${MIGRATOR_PASSWORD}';
      END IF;
    END $$;`);
    await freeLedgerOwner();
    await admin.query(`CREATE DATABASE ${identifier(databaseName)}`);

    // Genau das, was der Provisioner taete — hier von Hand, weil er selbst
    // noch keinen Arbeitsnachweis hat und dieser Fall nicht auf ihn wartet.
    project = createPostgresPool({
      connectionString: databaseUrl(adminUrl!, databaseName), max: 2, statementTimeoutMillis: 120_000,
    });
    for (const file of ["0001_qkern_migration_ledger.sql", "0002_qkern_migration_fence.sql"]) {
      await project.query(await readFile(path.resolve(process.cwd(), "db/project", file), "utf8"));
    }
    // Ohne dieses Recht kann die Migrationsrolle im Anwendungsschema nichts
    // anlegen. Ein Provisioner erteilt es beim Einrichten; hier steht es an
    // derselben Stelle wie die beiden Vorlagen.
    await project.query("GRANT CREATE, USAGE ON SCHEMA public TO qkern_project_migrator");

    owner = createPostgresPool({ connectionString: ownerUrl!, max: 3 });
    await owner.query(`INSERT INTO users (id,email,password_hash,status)
      VALUES ($1,$2,'$argon2id$integration-only','active')`,
    [controlUser, `migration-process-${controlUser}@qkern.test`]);
    await owner.query(`INSERT INTO organizations (id,name,slug,created_by)
      VALUES ($1,'Migration Process',$2,$3)`,
    [organizationId, `migration-process-${organizationId}`, controlUser]);
    await owner.query(`INSERT INTO projects (id,organization_id,name,slug,region,status,created_by)
      VALUES ($1,$2,'Migration Process',$3,'test','ready',$4)`,
    [projectId, organizationId, `migration-process-${projectId}`, controlUser]);
    await owner.query(`INSERT INTO project_environments
      (organization_id,project_id,environment,database_instance_ref)
      VALUES ($1,$2,'development',$3)`, [organizationId, projectId, instanceRef]);
  }, 180_000);

  afterAll(async () => {
    await Promise.allSettled([project?.end(), owner?.end()]);
    // Die Datenbank wird abgeraeumt, die clusterweiten Rollen bleiben: Ein
    // paralleler Lauf koennte sie noch brauchen.
    await admin?.query(`DROP DATABASE IF EXISTS ${identifier(databaseName)} WITH (FORCE)`)
      .catch(() => undefined);
    await admin?.end();
  }, 120_000);

  /**
   * Nimmt dem Ledger-Eigentuemer jede Mitgliedschaft — in beide Richtungen.
   *
   * Der Zaun verlangt das, und PostgreSQL arbeitet dagegen: Seit Version 16
   * teilt `CREATE ROLE` die neue Rolle dem Erzeuger automatisch mit ADMIN
   * OPTION zu. Wer eine Rolle anlegt, verletzt die Bedingung also im selben
   * Atemzug.
   *
   * Aufgeraeumt wird **vor jedem Lauf**, nicht einmal im Setup: Die Rolle ist
   * clusterweit, und drei Realtime-Testdateien legen dieselbe Rolle an — sie
   * kommentieren das Wettrennen sogar selbst. Ein einmaliges Aufraeumen im
   * `beforeAll` haelt deshalb nicht.
   *
   * Genau daran hat Release 1.48 einen Zertifizierungslauf verloren: lokal
   * lief der Prozess allein im Cluster, hier nicht.
   */
  async function freeLedgerOwner() {
    await admin.query(`DO $$ DECLARE entry record; BEGIN
      FOR entry IN SELECT m.member::regrole::text AS role FROM pg_auth_members m
        WHERE m.roleid = 'qkern_ledger_owner'::regrole LOOP
        EXECUTE format('REVOKE qkern_ledger_owner FROM %I', entry.role);
      END LOOP;
      FOR entry IN SELECT m.roleid::regrole::text AS role FROM pg_auth_members m
        WHERE m.member = 'qkern_ledger_owner'::regrole LOOP
        EXECUTE format('REVOKE %I FROM qkern_ledger_owner', entry.role);
      END LOOP;
    END $$;`);
    const left = await admin.query<{ member: string }>(
      `SELECT m.member::regrole::text AS member FROM pg_auth_members m
       WHERE m.roleid='qkern_ledger_owner'::regrole OR m.member='qkern_ledger_owner'::regrole`);
    if (left.rows.length > 0) {
      throw new Error(`REVOKE wirkungslos: ${JSON.stringify(left.rows)}`);
    }
  }

  /** Legt Change Set, Freigabe und Auftrag so an, wie die Control Plane es taete. */
  async function queueJob(statement: string, title: string, approvedTitle = title) {
    const changeSetId = randomUUID();
    const statementSha256 = sha256(statement);
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const encrypted = new AesGcmStatementCipher(Buffer.from(KEY, "hex")).encrypt(statement, {
      changeSetId, organizationId, projectId, environment: "development", statementSha256,
    });

    await owner.query(`INSERT INTO change_sets
      (id,organization_id,project_id,environment,title,statement_sha256,encrypted_statement,risk,status,created_by)
      VALUES ($1,$2,$3,'development',$4,$5,$6,'low','approved',$7)`,
    [changeSetId, organizationId, projectId, title, statementSha256, Buffer.from(encrypted), controlUser]);

    // Der Worker prueft die Freigabe noch einmal selbst und rechnet den Hash
    // aus dem nach, was in der Datenbank steht. Eine erfundene Freigabe kaeme
    // hier nicht durch.
    const actionHash = approvalActionHash({
      changeSetId, organizationId, projectId, environment: "development",
      databaseInstanceRef: instanceRef, title: approvedTitle, statementSha256,
      createdBy: controlUser, risk: "low", expiresAt, requiredScope: "approval:decide",
    });
    const approvalId = randomUUID();
    await owner.query(`INSERT INTO approval_requests
      (id,organization_id,project_id,change_set_id,environment,action_hash,status,expires_at)
      VALUES ($1,$2,$3,$4,'development',$5,'approved',$6)`,
    [approvalId, organizationId, projectId, changeSetId, actionHash, expiresAt]);

    const jobId = randomUUID();
    await owner.query(`INSERT INTO migration_jobs
      (id,organization_id,project_id,environment,database_instance_ref,change_set_id,
       approval_request_id,status)
      VALUES ($1,$2,$3,'development',$4,$5,$6,'queued')`,
    [jobId, organizationId, projectId, instanceRef, changeSetId, approvalId]);
    return jobId;
  }

  function workerProcess() {
    const child = spawn(process.execPath, ["--import", "tsx", "workers/migration-runtime.mts"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        QKERN_MIGRATION_WORKER_ENABLED: "true",
        QKERN_WORKER_ORGANIZATION_ID: organizationId,
        QKERN_MIGRATION_WORKER_ID: "certification-worker-1",
        QKERN_WORKER_IDLE_MS: "200",
        QKERN_RUNTIME_MODE: "postgres",
        QKERN_STATEMENT_ENCRYPTION_KEY: KEY,
        QKERN_WORKER_DATABASE_URL: workerUrl!,
        QKERN_ALLOW_LOCAL_PROJECT_DATABASE_CATALOG: "true",
        QKERN_LOCAL_PROJECT_DATABASE_CATALOG_JSON: JSON.stringify([{
          databaseInstanceRef: instanceRef,
          connectionString: databaseUrl(
            adminUrl!.replace(/\/\/[^@]+@/, `//qkern_project_migrator:${MIGRATOR_PASSWORD}@`),
            databaseName,
          ),
          expectedRole: "qkern_project_migrator",
          expectedDatabase: databaseName,
          expectedLedgerOwner: "qkern_ledger_owner",
        }]),
      },
    });
    let noise = "";
    child.stderr.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => { noise += chunk.toString(); });
    return { child, output: () => noise };
  }

  async function jobStatus(jobId: string) {
    const result = await owner.query<{ status: string }>(
      "SELECT status FROM migration_jobs WHERE id=$1", [jobId]);
    return result.rows[0]?.status ?? "missing";
  }

  /**
   * Der redigierte Fehlercode des Auftrags.
   *
   * Er gehoert in die Meldung des Falls, nicht ins Prozesslog: Ein Lauf, der
   * nur „failed" sagt, zwingt zur naechsten Runde Handarbeit — genau das hat
   * dieser Slice zweimal gekostet.
   */
  async function jobError(jobId: string) {
    const result = await owner.query<{ last_error_code: string | null }>(
      "SELECT last_error_code FROM migration_jobs WHERE id=$1", [jobId]);
    return result.rows[0]?.last_error_code ?? "kein Code";
  }

  /**
   * Die Grenzpruefung des Zaunes in Kurzform.
   *
   * Der Executor prueft zwei Dutzend Eigenschaften und meldet nach aussen nur
   * `INVALID_MIGRATION_FENCE`. Das ist richtig — die Meldung geht an einen
   * Mandanten —, kostet aber jede Diagnose einen eigenen Lauf. Hier steht
   * deshalb genug, um den Grund zu benennen.
   */
  async function fenceShape() {
    // Dieselbe Abfrage, die der Executor stellt, und dieselbe Rolle. Eine
    // nachgebaute Diagnose hat in 1.48 einen Lauf gekostet, weil sie
    // `owner_has_memberships` nur in eine Richtung prueft.
    const migrator = createPostgresPool({
      connectionString: databaseUrl(
        adminUrl!.replace(/\/\/[^@]+@/, `//qkern_project_migrator:${MIGRATOR_PASSWORD}@`),
        databaseName,
      ),
      max: 1,
    });
    try {
      const result = await migrator.query(FENCE_BOUNDARY_SQL);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return "keine Zeile fuer den Zaun";
      // Nur die Abweichungen: Die Liste ist lang, und die Antwort steht in
      // dem, was nicht stimmt.
      const expected: Record<string, unknown> = {
        relkind: "r", relpersistence: "p", owned_by_current_user: false,
        member_of_relation_owner: false, member_of_schema_owner: false, row_security: false,
        can_select: true, can_insert: true, can_update_allowed_columns: true,
        has_dangerous_table_privileges: false, can_create_in_schema: false,
        has_exact_columns: true, has_exact_column_types: true, has_job_primary_key: true,
        has_epoch_check: true, has_hash_check: true, has_unexpected_table_acl: false,
        has_unexpected_column_acl: false, has_unexpected_schema_acl: false,
        owner_can_login: false, owner_is_privileged: false, owner_has_memberships: false,
        owner_matches_schema: true, has_user_triggers: false, has_user_rules: false,
      };
      const deviations = Object.entries(expected)
        .filter(([key, value]) => row[key] !== value)
        .map(([key]) => `${key}=${JSON.stringify(row[key])}`);
      if (deviations.length === 0) return "Zaun in Ordnung";
      const memberships = await migrator.query<{ roleid: string; member: string; grantor: string }>(
        `SELECT m.roleid::regrole::text AS roleid, m.member::regrole::text AS member,
                m.grantor::regrole::text AS grantor
         FROM pg_auth_members m
         WHERE m.roleid='qkern_ledger_owner'::regrole OR m.member='qkern_ledger_owner'::regrole`);
      return `${deviations.join(", ")} | ${JSON.stringify(memberships.rows)}`;
    } finally {
      await migrator.end();
    }
  }

  /**
   * Der Prozess wendet wirklich an — in einer echten Zieldatenbank.
   *
   * Bis Release 1.48 kam er nicht einmal zum Claim: `quarantineExpiredRecon-
   * ciliations` hatte eine mehrdeutige Spaltenreferenz, lief bei **jedem**
   * Claim und liess PostgreSQL die ganze Abfrage abweisen. Danach brach die
   * Grenzpruefung des Zaunes an einem nulldimensionalen ACL-Array.
   *
   * Der Beleg steht nicht in der Control Plane, sondern in der Zieldatenbank:
   * Die Tabelle gibt es, und im Ledger steht, wer sie angelegt hat.
   */
  it("applies a queued statement to the real project database", async () => {
    const table = `probe_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const jobId = await queueJob(
      `CREATE TABLE public.${table} (id integer PRIMARY KEY)`, "certification apply");

    await freeLedgerOwner();
    const runner = workerProcess();
    try {
      const deadline = Date.now() + 120_000;
      let status = "queued";
      while (Date.now() < deadline && status !== "applied" && status !== "failed") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        status = await jobStatus(jobId);
      }
      expect(status, `Fehlercode: ${await jobError(jobId)}; Zaun: ${await fenceShape()}`)
        .toBe("applied");

      const created = await project.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_tables
          WHERE schemaname='public' AND tablename=$1`, [table]);
      expect(created.rows[0]?.count).toBe(1);

      const ledger = await project.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM qkern_internal.migration_ledger");
      expect(ledger.rows[0]?.count).toBeGreaterThanOrEqual(1);

      // Und die Schleife laeuft sauber. Vor dem Fix meldete sie bei **jeder**
      // Runde `iteration_failed`, weil die Abfrage selbst abgewiesen wurde.
      expect(runner.output()).not.toContain("iteration_failed");
    } finally {
      runner.child.kill();
    }
  }, 240_000);

  it("keeps a tampered statement out of the project database", async () => {
    const table = `tamper_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    // Die Freigabe wird ueber einen **anderen** Titel gerechnet als den, der im
    // Change Set steht. Sie sieht gueltig aus und gehoert zu einer anderen
    // Handlung.
    //
    // Nachtraeglich am Change Set zu drehen geht gar nicht: Ein Trigger weist
    // das ab („change set artifact is immutable after preview creation"). Der
    // verbleibende Weg fuehrt ueber die Freigabe — und genau den prueft der
    // Worker, indem er den Hash aus dem nachrechnet, was in der Datenbank
    // steht.
    const jobId = await queueJob(
      `CREATE TABLE public.${table} (id integer PRIMARY KEY)`,
      "certification tamper", "eine andere handlung");

    await freeLedgerOwner();
    const runner = workerProcess();
    try {
      const deadline = Date.now() + 90_000;
      let status = "queued";
      while (Date.now() < deadline && (status === "queued" || status === "running")) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        status = await jobStatus(jobId);
      }
      expect(status, `Prozessausgabe: ${runner.output().slice(-1200)}`).not.toBe("applied");

      const created = await project.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_tables
          WHERE schemaname='public' AND tablename=$1`, [table]);
      expect(created.rows[0]?.count).toBe(0);
    } finally {
      runner.child.kill();
    }
  }, 240_000);

  /**
   * Der Zaun sagt, **welche** Bedingung fehlt — und sonst nichts.
   *
   * Bis Release 1.51 meldete er nur `INVALID_MIGRATION_FENCE`. Wer erfahren
   * wollte, welche der fuenfundzwanzig Bedingungen verletzt ist, musste die
   * Pruefung von Hand nachbauen; Release 1.48 hat daran zwei
   * Zertifizierungslaeufe verloren, und ein Betreiber haette keinen Zugang zur
   * Datenbank, um es nachzustellen.
   */
  it("names the violated boundary condition without describing the database", async () => {
    const table = `named_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const jobId = await queueJob(
      `CREATE TABLE public.${table} (id integer PRIMARY KEY)`, "certification naming");

    await freeLedgerOwner();
    // Genau die Bedingung verletzen, die 1.49 gefunden hat: eine Mitgliedschaft
    // am Ledger-Eigentuemer. Ueber eine **dritte** Rolle, nicht ueber die
    // Migrationsrolle — die pruet schon der Katalog, und zwar frueher und mit
    // eigenem Code. Genau so lag der Fall in 1.49: Der Erzeuger der Rolle hielt
    // die Mitgliedschaft, nicht der Migrator.
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qkern_boundary_probe') THEN
        CREATE ROLE qkern_boundary_probe NOLOGIN;
      END IF;
    END $$;`);
    await admin.query("GRANT qkern_ledger_owner TO qkern_boundary_probe");
    const runner = workerProcess();
    try {
      // Auf einen **Endzustand** warten, nicht auf „nicht mehr queued":
      // `running` ist ein Durchgangszustand, und wer dort stehenbleibt, misst
      // den Zeitpunkt statt das Ergebnis.
      const deadline = Date.now() + 90_000;
      let status = "queued";
      while (Date.now() < deadline && (status === "queued" || status === "running")) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        status = await jobStatus(jobId);
      }
      expect(status, `Prozessausgabe: ${runner.output().slice(-600)}`).toBe("failed");
      expect(await jobError(jobId)).toBe("INVALID_MIGRATION_FENCE");

      // Der Name der Bedingung steht im Prozesslog — aber erst **nach** dem
      // Statuswechsel: `finishFailure` schreibt die Zeile, nachdem `markFailed`
      // festgeschrieben hat. Wer im selben Moment liest, in dem die Datenbank
      // `failed` sagt, kann den Puffer noch leer vorfinden; ein
      // Zertifizierungslauf unter Speicherdruck hat genau das getroffen.
      // Deshalb innerhalb **derselben** Frist auf die Zeile warten, statt einen
      // Zeitpunkt zu messen.
      while (Date.now() < deadline && !runner.output().includes("owner_has_memberships")) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(runner.output()).toContain("failedChecks");
      expect(runner.output()).toContain("owner_has_memberships");

      // Und sonst nichts: kein Rollenname, kein Schema, kein Passwort, keine
      // Datenbankmeldung. Was die Zieldatenbank **ist**, sagt die Liste nicht.
      expect(runner.output()).not.toContain("qkern_ledger_owner");
      expect(runner.output()).not.toContain(MIGRATOR_PASSWORD);
      expect(runner.output()).not.toContain(databaseName);
    } finally {
      runner.child.kill();
      await admin.query("REVOKE qkern_ledger_owner FROM qkern_boundary_probe");
    }
  }, 240_000);

  /**
   * Ein geloeschtes Projekt bekommt keine Migration mehr (2.174).
   *
   * Seit 2.173 laesst sich ein Projekt loeschen. Ohne Filter haette der Worker
   * weiter freigegebene Statements in die Datenbank eines Projekts geschrieben,
   * das der Owner geloescht hat. Der Auftrag muss dabei stehen bleiben und
   * nicht verbraucht werden: ein Zurueckholen soll ihn so vorfinden, wie er war.
   *
   * Hier laeuft der Claim als Bibliothek und nicht als Prozess. Gefragt ist,
   * ob die Abfrage den Auftrag auslaesst, und das laesst sich nur mit einem
   * Aufruf eindeutig zeigen; ein Prozess, der eine Weile nichts tut, beweist
   * nichts. Rolle und Weg sind dieselben wie im Prozess: Worker-Pool,
   * `PostgresControlPlane`, `PostgresMigrationQueue`.
   *
   * Der Fall steht zuletzt, weil der zurueckgeholte Auftrag danach mit Lease
   * auf `running` steht und kein spaeterer Prozess ihn ausfuehren soll.
   */
  it("(2.174) claims no migration of a deleted project and claims it again after a restore", async () => {
    const table = `deleted_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const jobId = await queueJob(
      `CREATE TABLE public.${table} (id integer PRIMARY KEY)`, "certification deleted project");
    const workerPool = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: workerUrl!, max: 2 }), "worker",
    );
    const queue = new PostgresMigrationQueue(new PostgresControlPlane(workerPool), organizationId);
    const claimInput = { workerId: "certification-deleted-project", leaseDurationMs: 60_000 };
    try {
      try {
        await owner.query(
          "UPDATE projects SET deleted_at = now(), delete_after = now() + interval '7 days' WHERE id = $1",
          [projectId]);
        // Alle Auftraege dieser Organisation gehoeren zu diesem einen Projekt,
        // also darf gar nichts kommen.
        expect(await queue.claimNext(claimInput)).toBeNull();
        // Ausgelassen, nicht verbraucht: weiter `queued`, ohne Versuch und ohne Lease.
        const state = await owner.query<{ status: string; attempt_count: number; lease_owner: string | null }>(
          "SELECT status, attempt_count, lease_owner FROM migration_jobs WHERE id=$1", [jobId]);
        expect(state.rows[0]).toEqual({ status: "queued", attempt_count: 0, lease_owner: null });
      } finally {
        await owner.query("UPDATE projects SET deleted_at = NULL, delete_after = NULL WHERE id = $1", [projectId]);
      }

      // Zurueckgeholt kommt derselbe Auftrag wieder. Das zeigt, dass der
      // Filter ihn zurueckgehalten hat und nicht ein kaputter Aufbau. Ein
      // frueherer Fall kann nach Ablauf seiner Frist einen aelteren Auftrag
      // `queued` hinterlassen haben; der kaeme zuerst, deshalb gezielt suchen.
      let claimed = await queue.claimNext(claimInput);
      for (let attempt = 0; claimed && claimed.jobId !== jobId && attempt < 5; attempt += 1) {
        claimed = await queue.claimNext(claimInput);
      }
      expect(claimed?.jobId).toBe(jobId);
      expect(await jobStatus(jobId)).toBe("running");
    } finally {
      await workerPool.end();
    }
  }, 60_000);
});
