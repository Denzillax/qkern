import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AesGcmStatementCipher, approvalActionHash, sha256 } from "@/lib/server/control-plane/crypto";
import { createPostgresPool } from "@/lib/server/db/pool";
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
    const result = await project.query(`SELECT
      owner.rolname AS owner_name,
      owner.rolcanlogin AS owner_can_login,
      EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = owner.oid) AS owner_has_memberships,
      has_schema_privilege('qkern_project_migrator', 'qkern_internal', 'CREATE') AS can_create_in_schema,
      relation.relrowsecurity AS row_security,
      relation.relkind AS relkind,
      has_table_privilege('qkern_project_migrator', relation.oid, 'SELECT') AS can_select,
      has_table_privilege('qkern_project_migrator', relation.oid, 'INSERT') AS can_insert,
      has_column_privilege('qkern_project_migrator', relation.oid, 'fence_epoch', 'UPDATE') AS can_update_epoch,
      has_column_privilege('qkern_project_migrator', relation.oid, 'lease_token', 'UPDATE') AS can_update_token,
      (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=relation.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
      (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=relation.oid AND a.attacl IS NOT NULL) AS columns_with_acl
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles AS owner ON owner.oid = relation.relowner
      WHERE namespace.nspname='qkern_internal' AND relation.relname='migration_fences'`);
    return JSON.stringify(result.rows[0] ?? { fence: "fehlt" });
  }

  /**
   * Der Prozess uebernimmt den Auftrag und entscheidet ihn.
   *
   * Bis Release 1.48 kam er nicht einmal so weit: `quarantineExpiredRecon-
   * ciliations` hatte eine mehrdeutige Spaltenreferenz, lief bei **jedem**
   * Claim und liess die ganze Abfrage von PostgreSQL abweisen. Der Auftrag
   * blieb `queued`, und die Schleife scheiterte still.
   *
   * Zugesagt wird hier genau das: Der Auftrag verlaesst `queued`. Ob er
   * angewendet wird, haengt am Zaun der Zieldatenbank — und der weist in
   * diesem Cluster ab, waehrend er in einem anderen durchlaesst. Solange das
   * nicht verstanden ist, wird es nicht behauptet.
   */
  it("claims and decides a queued job instead of leaving it stuck", async () => {
    const table = `probe_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const jobId = await queueJob(
      `CREATE TABLE public.${table} (id integer PRIMARY KEY)`, "certification apply");

    const runner = workerProcess();
    try {
      const deadline = Date.now() + 120_000;
      let status = "queued";
      while (Date.now() < deadline && status === "queued") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        status = await jobStatus(jobId);
      }
      expect(status, `Fehlercode: ${await jobError(jobId)}; Zaun: ${await fenceShape()}`)
        .not.toBe("queued");

      // Und die Schleife laeuft sauber. Vor dem Fix meldete sie bei **jeder**
      // Runde `iteration_failed`, weil die Abfrage selbst abgewiesen wurde.
      // Ein gescheiterter Auftrag ist etwas anderes als eine gescheiterte
      // Runde — das ist der Unterschied, den dieser Fall traegt.
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

    const runner = workerProcess();
    try {
      const deadline = Date.now() + 90_000;
      let status = "queued";
      while (Date.now() < deadline && status === "queued") {
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
});
