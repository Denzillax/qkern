import { X509Certificate, createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, verifyDatabaseBoundary } from "@/lib/server/db/pool";
import { PostgresControlPlane } from "@/lib/server/db/repositories";
import { PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256 } from "@/lib/server/provisioning/contract";
import type { SqlPool } from "@/lib/server/db/sql";
import { sha256Hex, signSigV4Request } from "@/lib/server/project-storage/s3-sigv4";
import {
  createProjectDatabaseBackupRuntimeFromEnv,
  type ProjectDatabaseBackupRuntime,
} from "@/lib/server/backup/project-database-runtime";
import {
  PROJECT_DATABASE_BACKUP_INCLUDES,
  backupObjectKey,
  identityOf,
} from "@/lib/server/backup/project-database";
import {
  S3ProjectDatabaseBackupObjectStore,
  FileBackupDataKeyProtector,
} from "@/lib/server/backup/project-database-object-store";
import {
  VaultStaticDatabaseCredentialSource,
  VaultTokenFileProvider,
} from "@/lib/server/migrations/connection-catalog-vault";

/**
 * Backup und Wiederherstellung einer **Projektdatenbank** gegen echtes
 * PostgreSQL 17 mit TLS-Pflicht, echten Vault und echten Objektspeicher
 * -- Fall `(2.126)`.
 *
 * ## Was dieser Fall belegt und der Fall aus 2.29 nicht
 *
 * 2.29 sichert die **Steuerungsdatenbank**: physisches Basisbackup des
 * Clusters, Wiederherstellung auf einen Zeitpunkt aus dem WAL-Archiv. Was nie
 * gesichert und nie wiederhergestellt wurde, ist die Datenbank eines
 * **Mandanten** -- und genau das ist bei Supabase die Zusage, die ein Kunde
 * kauft. Dieser Fall fuellt die Luecke, und zwar auf dem Weg, den das Produkt
 * hat: Bindung aus der Control Plane, Zugangsdatum aus dem Vault, Bytes in den
 * Objektspeicher, Wiederherstellung in eine neue Datenbank.
 *
 * ## Die Probe ist echt
 *
 * Zeilen schreiben, sichern, Zeilen loeschen und eine Policy wegnehmen,
 * wiederherstellen, und nachweisen, dass **genau** der gesicherte Stand
 * zurueckkommt: Schema, Zeilen, Policies, Erweiterungen, Sequenzstaende und
 * Rechte, verglichen ueber das Manifest aus
 * `lib/server/backup/project-database-manifest.ts`, und daneben einzeln
 * nachgesehen, damit ein Fehlschlag sagt, **was** fehlt.
 *
 * ## Die Mandantengrenze
 *
 * Zwei Organisationen, je ein Projekt, je ein echtes Backup. Danach gilt fuer
 * die erste: das Backup der zweiten ist **nicht lesbar**, **nicht auflistbar**
 * und **nicht wiederherstellbar**, und keine der drei Pruefungen traegt einen
 * Filter in der Anfrage. Dazu die Ebene unter der Datenbank: die Bytes der
 * zweiten gehen unter der Kennung der ersten nicht auf.
 *
 * ## Was der Stack teilt und was das kostet
 *
 * Im Wegwerfstack gibt es **eine** physische Projektdatenbank, und beide
 * Organisationen zeigen darauf. Das ist nicht, wie es in Produktion waere, und
 * es ist fuer diesen Fall das schaerfere Setup: beide Backups kommen aus
 * derselben Quelle, also kann der Beleg der Mandantengrenze nicht daran
 * haengen, dass die Inhalte sowieso verschieden sind. Damit die
 * Wiederherstellung trotzdem etwas unterscheidet, liegt zwischen den beiden
 * Backups eine Aenderung an den Daten: das Backup der ersten Organisation
 * traegt den alten Stand, das der zweiten den neuen.
 */
const enabled = process.env.QKERN_TEST_PROJECT_BACKUP_DRILL === "true";

const ownerUrl = process.env.QKERN_TEST_OWNER_DATABASE_URL ?? "";
const provisionerUrl = process.env.QKERN_TEST_PROVISIONER_DATABASE_URL ?? "";
const projectDatabaseUrl = process.env.QKERN_TEST_PROJECT_DATABASE_URL ?? "";
const host = process.env.QKERN_TEST_BACKUP_SOURCE_HOST ?? "";
const caFile = process.env.QKERN_TEST_BACKUP_CA_FILE ?? "";
const serverCertFile = process.env.QKERN_TEST_BACKUP_SERVER_CERT_FILE ?? "";
const vaultDatabaseUrl = process.env.QKERN_TEST_BACKUP_VAULT_DATABASE_URL ?? "";
const vaultTokenFile = process.env.QKERN_TEST_BACKUP_VAULT_TOKEN_FILE ?? "";
const vaultRoleBase = process.env.QKERN_TEST_BACKUP_VAULT_STATIC_ROLE_BASE ?? "";
const objectEndpoint = process.env.QKERN_TEST_BACKUP_S3_ENDPOINT ?? "";
const objectRegion = process.env.QKERN_TEST_BACKUP_S3_REGION ?? "";
const objectBucket = process.env.QKERN_TEST_BACKUP_S3_BUCKET ?? "";
const objectAccessKeyId = process.env.QKERN_TEST_BACKUP_S3_ACCESS_KEY_ID ?? "";
const objectSecretAccessKey = process.env.QKERN_TEST_BACKUP_S3_SECRET_ACCESS_KEY ?? "";
const keyDirectory = process.env.QKERN_TEST_BACKUP_KEY_DIRECTORY ?? "";
const keyId = process.env.QKERN_TEST_BACKUP_KEY_ID ?? "";
const projectDatabaseName = process.env.QKERN_TEST_PROJECT_DATABASE_NAME ?? "project_database";

const DAY_MS = 24 * 60 * 60 * 1_000;

describe.runIf(enabled)("Project database backup and restore drill (2.126)", () => {
  const controlUser = randomUUID();
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const referenceA = `managed:drill-a-${suffix}`;
  const referenceB = `managed:drill-b-${suffix}`;
  /** Die Tabelle des Mandanten. Je Lauf eine eigene, damit zwei Laeufe sich nicht sehen. */
  const invoices = `drill_invoices_${suffix}`;
  const counter = `drill_counter_${suffix}`;
  const policyRead = `${invoices}_read`;
  const policyWrite = `${invoices}_write`;

  let owner: SqlPool;
  let provisioner: SqlPool;
  let project: SqlPool;
  let runtimeA: ProjectDatabaseBackupRuntime;
  let runtimeB: ProjectDatabaseBackupRuntime;
  /** Die Uhr des Dienstes A. Einspeisbar, sonst waere die Aufbewahrung erst in 30 Tagen pruefbar. */
  let clockA = new Date();
  let serverCertificateSha256 = "";
  let objects: S3ProjectDatabaseBackupObjectStore;
  let protector: FileBackupDataKeyProtector;
  const restoreDatabases: string[] = [];

  function backupEnv(organizationId: string, workerId: string): Record<string, string> {
    return {
      NODE_ENV: "test",
      QKERN_PROJECT_BACKUP_ENABLED: "true",
      QKERN_PROJECT_BACKUP_ORGANIZATION_ID: organizationId,
      QKERN_PROJECT_BACKUP_WORKER_ID: workerId,
      QKERN_PROJECT_BACKUP_CA_FILE: caFile,
      QKERN_PROJECT_BACKUP_KEY_DIRECTORY: keyDirectory,
      QKERN_PROJECT_BACKUP_KEY_ID: keyId,
      QKERN_PROJECT_BACKUP_S3_ENDPOINT: objectEndpoint,
      QKERN_PROJECT_BACKUP_S3_REGION: objectRegion,
      QKERN_PROJECT_BACKUP_S3_BUCKET: objectBucket,
      QKERN_PROJECT_BACKUP_S3_ACCESS_KEY_ID: objectAccessKeyId,
      QKERN_PROJECT_BACKUP_S3_SECRET_ACCESS_KEY: objectSecretAccessKey,
      QKERN_PROJECT_BACKUP_RETENTION_DAYS: "30",
      QKERN_VAULT_DATABASE_URL: vaultDatabaseUrl,
      QKERN_VAULT_TOKEN_FILE: vaultTokenFile,
    };
  }

  /** Eine Anfrage an den Objektspeicher, signiert mit dem Signierer des Produkts. */
  async function s3(method: "PUT" | "GET", path: string): Promise<Response> {
    const url = new URL(objectEndpoint);
    url.pathname = path;
    return fetch(url, {
      method,
      headers: signSigV4Request({
        method,
        url,
        payloadHash: sha256Hex(""),
        accessKeyId: objectAccessKeyId,
        secret: objectSecretAccessKey,
        region: objectRegion,
        now: new Date(),
      }),
      redirect: "error",
    });
  }

  async function seedOrganization(organizationId: string, projectId: string, reference: string, name: string) {
    await owner.query(
      `INSERT INTO organizations (id, name, slug, created_by) VALUES ($1, $2, $3, $4)`,
      [organizationId, name, `backup-drill-${organizationId}`, controlUser],
    );
    await owner.query(
      `INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
       VALUES ($1, $2, 'Backup Drill', $3, 'test', 'ready', $4)`,
      [projectId, organizationId, `backup-drill-${projectId}`, controlUser],
    );
    await owner.query(
      `INSERT INTO project_environments (organization_id, project_id, environment, database_instance_ref)
       VALUES ($1, $2, 'production', $3)`,
      [organizationId, projectId, reference],
    );
    // Der Auftrag bleibt `pending`, und das ist kein Kompromiss: `succeeded`
    // verlangt nach `project_database_provisioning_jobs_lease_shape` auch
    // `finished_at` und `binding_id`, und die Bindung gibt es in diesem
    // Augenblick noch nicht. Fuer den Backup-Weg zaehlt allein, dass die
    // Bindung da ist; den Auftrag braucht sie nur als Fremdschluessel.
    const jobId = randomUUID();
    await owner.query(
      `INSERT INTO project_database_provisioning_jobs
         (id, organization_id, project_id, environment, requested_by, status)
       VALUES ($1, $2, $3, 'production', 'backup-drill', 'pending')`,
      [jobId, organizationId, projectId],
    );
    // Die Bindung, wie der Provisioner sie schreibt. Beide Organisationen
    // zeigen auf dieselbe physische Datenbank und tragen denselben
    // Vault-Rollenstamm: im Stack gibt es eine Projektdatenbank, und zwei
    // statische Vault-Rollen auf denselben Datenbankbenutzer wuerden sich beim
    // Drehen gegenseitig das Passwort ungueltig machen.
    await owner.query(
      `INSERT INTO project_database_bindings
         (organization_id, project_id, environment, provisioning_job_id, database_instance_ref,
          vault_static_role, host, port, expected_role, expected_database, expected_ledger_owner,
          server_certificate_sha256, bootstrap_contract_sha256)
       VALUES ($1, $2, 'production', $3, $4, $5, $6, 5432, 'qkern_project_api_app', $7,
               'qkern_ledger_owner', $8, $9)`,
      [organizationId, projectId, jobId, reference, vaultRoleBase, host, projectDatabaseName,
        serverCertificateSha256, PROJECT_DATABASE_BOOTSTRAP_CONTRACT_SHA256],
    );
  }

  /** Was die lebende Datenbank gerade enthaelt, mit der Eigentuemerrolle gelesen. */
  async function liveRows(): Promise<{ tenant: string; label: string }[]> {
    const result = await project.query<{ tenant: string; label: string }>(
      `SELECT tenant, label FROM public.${invoices} ORDER BY id`,
    );
    return result.rows;
  }

  beforeAll(async () => {
    serverCertificateSha256 = new X509Certificate(await readFile(serverCertFile))
      .fingerprint256.replaceAll(":", "").toLowerCase();

    // TLS ist im Stack Pflicht, und der Test weicht sie nicht auf: der Anker
    // steht in `NODE_EXTRA_CA_CERTS`, und `rejectUnauthorized` bleibt an. Der
    // erste Lauf hat gezeigt, warum das hier stehen muss: ohne `ssl` baut der
    // Treiber eine Klartextverbindung, und `pg_hba` weist sie ab.
    const ssl = { rejectUnauthorized: true as const };
    owner = createPostgresPool({ connectionString: ownerUrl, max: 3, ssl });
    provisioner = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: provisionerUrl, max: 4, ssl }), "provisioner",
    );
    project = createPostgresPool({ connectionString: projectDatabaseUrl, max: 3, ssl });

    await owner.query(
      `INSERT INTO users (id, email, password_hash, status)
       VALUES ($1, $2, '$argon2id$drill-only', 'active')`,
      [controlUser, `backup-drill-${controlUser}@qkern.test`],
    );
    await seedOrganization(organizationA, projectA, referenceA, "Backup Drill A");
    await seedOrganization(organizationB, projectB, referenceB, "Backup Drill B");

    // Der Bucket. versitygw hat keine Oberflaeche; angelegt wird er mit
    // demselben Signierer, den der Dienst benutzt. 409 heisst "schon da".
    const created = await s3("PUT", `/${objectBucket}`);
    expect([200, 204, 409]).toContain(created.status);

    objects = new S3ProjectDatabaseBackupObjectStore({
      endpoint: objectEndpoint, region: objectRegion, bucket: objectBucket,
      accessKeyId: objectAccessKeyId, secretAccessKey: objectSecretAccessKey,
    });
    protector = new FileBackupDataKeyProtector({ directory: keyDirectory, currentKeyId: keyId });

    const controlPlane = new PostgresControlPlane(provisioner);
    runtimeA = createProjectDatabaseBackupRuntimeFromEnv(
      backupEnv(organizationA, "drill-worker-a"),
      {
        controlPlane, controlPlanePool: provisioner, now: () => clockA,
        // Die Log-Ereignisse des Dienstes stehen im Protokoll des Laufs. Sie
        // tragen feste Codes und keine Meldung; wer einen Fehlschlag sucht,
        // findet hier den Schritt, an dem er passierte.
        logger: { log: (event) => process.stdout.write(`${JSON.stringify(event)}
`) },
      },
    )!;
    runtimeB = createProjectDatabaseBackupRuntimeFromEnv(
      backupEnv(organizationB, "drill-worker-b"),
      {
        controlPlane, controlPlanePool: provisioner,
        logger: { log: (event) => process.stdout.write(`${JSON.stringify(event)}
`) },
      },
    )!;
    expect(runtimeA).toBeTruthy();
    expect(runtimeB).toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    // Die wiederhergestellten Datenbanken wieder weg, sonst bleibt der Cluster
    // nach mehreren Laeufen voller Kopien. Die **lebende** Projektdatenbank
    // faellt hier nicht; sie gehoert dem Stack.
    for (const name of restoreDatabases) {
      await owner.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    }
    await Promise.allSettled([runtimeA?.close(), runtimeB?.close()]);
    await Promise.allSettled([project?.end(), provisioner?.end(), owner?.end()]);
  }, 120_000);

  it("backs up a tenant project database, restores it into a new database, and holds the tenant boundary", async () => {
    // --- 1. TLS ist Pflicht, auch fuer die Projektdatenbank ----------------
    const ssl = await project.query<{ ssl: boolean }>(
      "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
    );
    expect(ssl.rows[0]?.ssl).toBe(true);

    // --- 1b. Das Zugangsdatum kommt wirklich aus dem Vault ----------------
    //
    // Derselbe Weg, den der Dienst nimmt, einmal nackt: eine statische
    // Vault-Rolle gibt den Benutzer `qkern_project_backup` heraus, und zwar
    // ueber `https` mit gepruefter Kette und mit einem Token aus einer Datei.
    // Dieser Schritt steht hier, damit ein spaeterer Fehlschlag des Backups
    // nicht zwischen "Vault" und "pg_dump" raten laesst.
    const credentials = new VaultStaticDatabaseCredentialSource({
      vaultDatabaseUrl: new URL(vaultDatabaseUrl),
      tokenProvider: new VaultTokenFileProvider(vaultTokenFile),
      bindings: [{
        databaseInstanceRef: referenceA,
        vaultStaticRole: `${vaultRoleBase}-backup`,
        host, port: 5432,
        expectedRole: "qkern_project_backup",
        expectedDatabase: projectDatabaseName,
        expectedLedgerOwner: "qkern_ledger_owner",
        serverCertificateSha256,
      }],
    });
    const credential = await credentials.credentialFor(referenceA);
    expect(credential.username).toBe("qkern_project_backup");
    expect(credential.password.length).toBeGreaterThan(8);
    expect(credential.ttlSeconds).toBeGreaterThan(0);

    // --- 2. Der Stand, der gesichert werden soll --------------------------
    //
    // Eine Mandantentabelle mit Zeilensicherheit, zwei Policies, einer
    // Identitaetsspalte, einer eigenen Sequenz, einer Erweiterung und Rechten
    // fuer die Data-API-Rolle. Alles als `qkern_ledger_owner`, damit es dem
    // Eigentuemer gehoert, den auch eine bereitgestellte Projektdatenbank hat;
    // ein Dump mit Objekten eines Superusers liesse sich nicht ohne Superuser
    // wiederherstellen, und genau das soll der Fall nicht brauchen.
    await project.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const asOwner = async (statements: readonly string[]) => {
      const client = await project.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE qkern_ledger_owner");
        for (const statement of statements) await client.query(statement);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
    await asOwner([
      `CREATE SEQUENCE public.${counter} START 1000`,
      `CREATE TABLE public.${invoices} (
         id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
         tenant text NOT NULL,
         label text NOT NULL,
         amount integer NOT NULL,
         marker text NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now())`,
      `ALTER TABLE public.${invoices} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE public.${invoices} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY ${policyRead} ON public.${invoices} FOR SELECT
         USING (tenant = current_setting('qkern.tenant', true))`,
      `CREATE POLICY ${policyWrite} ON public.${invoices} FOR INSERT
         WITH CHECK (tenant = current_setting('qkern.tenant', true))`,
      `GRANT SELECT, INSERT ON public.${invoices} TO qkern_project_api_app`,
      `GRANT USAGE, SELECT ON SEQUENCE public.${counter} TO qkern_project_api_app`,
    ]);
    for (let index = 1; index <= 6; index += 1) {
      await project.query(
        `INSERT INTO public.${invoices} (tenant, label, amount, marker)
         VALUES ('a', $1, $2, 'marker-only-in-backup')`,
        [`phase-a-${index}`, index * 10],
      );
    }
    for (let index = 1; index <= 4; index += 1) {
      await project.query(
        `INSERT INTO public.${invoices} (tenant, label, amount, marker)
         VALUES ('b', $1, $2, 'marker-only-in-backup')`,
        [`phase-b-${index}`, index * 100],
      );
    }
    await project.query(`SELECT nextval('public.${counter}') FROM generate_series(1, 7)`);

    // Die Rolle der Data API sieht genau ihre Zeilen. Das ist der Grund, warum
    // ein Backup nicht mit ihr lauft: mit ihr waeren es sechs von zehn.
    const dataApiView = await project.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.${invoices}`,
      [],
    );
    expect(dataApiView.rows[0].n).toBe("10");
    const underRls = await project.connect();
    let visibleToDataApi = "";
    try {
      await underRls.query("BEGIN");
      await underRls.query("SET LOCAL ROLE qkern_project_api_app");
      await underRls.query("SELECT set_config('qkern.tenant', 'a', true)");
      const seen = await underRls.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${invoices}`);
      visibleToDataApi = seen.rows[0].n;
      await underRls.query("ROLLBACK");
    } finally {
      underRls.release();
    }
    expect(visibleToDataApi).toBe("6");

    // --- 3. Das Backup von Organisation A --------------------------------
    const enqueued = await runtimeA.service.enqueue(
      { organizationId: organizationA, projectId: projectA, environment: "production" },
      referenceA,
    );
    expect(enqueued.status).toBe("pending");
    // Ein zweiter Auftrag entsteht nicht; ein wartender je Umgebung reicht.
    const again = await runtimeA.service.enqueue(
      { organizationId: organizationA, projectId: projectA, environment: "production" },
      referenceA,
    );
    expect(again.id).toBe(enqueued.id);

    const round = await runtimeA.service.runRound();
    expect(round, JSON.stringify(round)).toMatchObject({ status: "succeeded", backupId: enqueued.id });
    const backupA = (await runtimeA.store.get(enqueued.id))!;
    expect(backupA.status).toBe("available");
    expect(backupA.includes).toEqual([...PROJECT_DATABASE_BACKUP_INCLUDES]);
    expect(backupA.objectKey).toBe(backupObjectKey(backupA));
    expect(backupA.objectKey!.startsWith(`project-database-backups/${organizationA}/`)).toBe(true);
    expect(backupA.sizeBytes).toBeGreaterThan(1_000);
    expect(backupA.wrappedDataKey).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(backupA.keyId).toBe(keyId);
    expect(backupA.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(backupA.expiresAt!.getTime() - backupA.completedAt!.getTime()).toBe(30 * DAY_MS);
    // Eine Runde ohne Auftrag ist leer und nicht fehlerhaft.
    expect(await runtimeA.service.runRound()).toMatchObject({ status: "idle" });

    // Die Bytes liegen wirklich im Objektspeicher, und zwar genau die, deren
    // Pruefsumme in der Zeile steht.
    const artifactA = await objects.get(backupA.objectKey!);
    expect(createHash("sha256").update(artifactA).digest("hex")).toBe(backupA.artifactSha256);
    expect(artifactA.length).toBe(backupA.sizeBytes);
    // Und sie sind verschluesselt. Kein Schemawort, kein Marker einer Zeile.
    const asText = artifactA.toString("latin1");
    expect(asText.includes("CREATE TABLE")).toBe(false);
    expect(asText.includes("marker-only-in-backup")).toBe(false);
    expect(asText.includes(invoices)).toBe(false);
    // Seit 2.129 ist das Artefakt stueckweise, also traegt es den Kopf des
    // stueckweisen Formats und nicht mehr den von 2.73.0. Der Dump dieses Falls
    // ist 14 kB gross und passt damit in **einen** Teil; dass mehr als ein Teil
    // wirklich geht, belegt `(2.129)`.
    expect(artifactA.subarray(0, 8).toString("utf8")).toBe("QKBAKC1\n");
    expect(backupA.artifactFormat).toBe("chunked");
    expect(backupA.partCount).toBe(1);

    // --- 4. Die lebende Datenbank aendert sich ---------------------------
    //
    // Zeilen weg, eine Policy weg, die Sequenz weiter. Das ist der Schaden, den
    // eine Wiederherstellung zurueckdrehen muss.
    await project.query(`DELETE FROM public.${invoices} WHERE tenant = 'b'`);
    await project.query(
      `INSERT INTO public.${invoices} (tenant, label, amount, marker)
       VALUES ('a', 'after-backup', 999, 'marker-after-backup')`,
    );
    await asOwner([`DROP POLICY ${policyWrite} ON public.${invoices}`]);
    await project.query(`SELECT nextval('public.${counter}') FROM generate_series(1, 5)`);
    const mutated = await liveRows();
    expect(mutated).toHaveLength(7);
    expect(mutated.some((row) => row.label === "after-backup")).toBe(true);

    // --- 5. Das Backup von Organisation B, nach der Aenderung ------------
    const enqueuedB = await runtimeB.service.enqueue(
      { organizationId: organizationB, projectId: projectB, environment: "production" },
      referenceB,
    );
    expect(await runtimeB.service.runRound()).toMatchObject({ status: "succeeded", backupId: enqueuedB.id });
    const backupB = (await runtimeB.store.get(enqueuedB.id))!;
    expect(backupB.status).toBe("available");
    // Zwei Backups derselben Quelle zu zwei Zeitpunkten: verschiedene Staende,
    // also verschiedene Manifeste. Waeren sie gleich, belegte Schritt 6 nichts.
    expect(backupB.manifestSha256).not.toBe(backupA.manifestSha256);

    // --- 6. Die Wiederherstellung ----------------------------------------
    const restored = await runtimeA.service.restoreToNewDatabase({ backupId: backupA.id });
    restoreDatabases.push(restored.databaseName);
    expect(restored.restoredManifestSha256).toBe(restored.expectedManifestSha256);
    expect(restored.restoredManifestSha256).toBe(backupA.manifestSha256);
    expect(restored.restoredManifest.tableCount).toBeGreaterThanOrEqual(4);
    expect(restored.restoredManifest.rowCount).toBeGreaterThanOrEqual(10);

    // Das Manifest ist eine Zahl. Daneben wird einzeln nachgesehen, damit ein
    // Fehlschlag sagt, **was** fehlt, und nicht nur "ungleich".
    const restoredPool = createPostgresPool({
      connectionString: projectDatabaseUrl.replace(`/${projectDatabaseName}`, `/${restored.databaseName}`),
      max: 2,
      ssl: { rejectUnauthorized: true },
    });
    try {
      const rows = await restoredPool.query<{ tenant: string; label: string; marker: string }>(
        `SELECT tenant, label, marker FROM public.${invoices} ORDER BY id`,
      );
      expect(rows.rows).toHaveLength(10);
      expect(rows.rows.filter((row) => row.tenant === "b")).toHaveLength(4);
      expect(rows.rows.every((row) => row.marker === "marker-only-in-backup")).toBe(true);
      expect(rows.rows.some((row) => row.label === "after-backup")).toBe(false);

      const policies = await restoredPool.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE tablename = $1 ORDER BY policyname`,
        [invoices],
      );
      expect(policies.rows.map((row) => row.policyname).sort()).toEqual([policyRead, policyWrite].sort());
      const rls = await restoredPool.query<{ enabled: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class WHERE relname = $1`,
        [invoices],
      );
      expect(rls.rows[0]).toMatchObject({ enabled: true, forced: true });

      const sequence = await restoredPool.query<{ last_value: string | null }>(
        `SELECT last_value::text AS last_value FROM pg_sequences WHERE sequencename = $1`,
        [counter],
      );
      expect(sequence.rows[0]?.last_value).toBe("1006");

      const extension = await restoredPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_extension WHERE extname = 'pgcrypto'`,
      );
      expect(extension.rows[0].n).toBe("1");

      const grants = await restoredPool.query<{ n: string }>(
        `SELECT count(*)::text AS n
         FROM pg_class AS c
         CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
         WHERE c.relname = $1 AND acl.grantee = 'qkern_project_api_app'::regrole
           AND acl.privilege_type IN ('SELECT', 'INSERT')`,
        [invoices],
      );
      expect(grants.rows[0].n).toBe("2");

      // Der Ledger der Projektdatenbank ist mitgekommen. Ohne ihn waere die
      // wiederhergestellte Datenbank eine, die ihre Migrationsgeschichte nicht
      // kennt, und der naechste Apply faengt von vorn an.
      const ledger = await restoredPool.query<{ present: boolean }>(
        `SELECT to_regclass('qkern_internal.migration_ledger') IS NOT NULL AS present`,
      );
      expect(ledger.rows[0].present).toBe(true);
    } finally {
      await restoredPool.end();
    }

    // Die lebende Datenbank ist unberuehrt: eine Wiederherstellung geht nie
    // ueber sie.
    expect(await liveRows()).toHaveLength(7);
    const livePolicies = await project.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies WHERE tablename = $1`, [invoices],
    );
    expect(livePolicies.rows[0].n).toBe("1");

    // --- 7. Die Mandantengrenze ------------------------------------------
    //
    // Keine dieser drei Pruefungen traegt einen Filter in der Anfrage; was
    // haelt, ist die Zeilensicherheit aus 0083.
    expect(await runtimeA.store.get(backupB.id)).toBeNull();
    const listedByA = await runtimeA.store.listAll(100);
    expect(listedByA.map((record) => record.id)).toContain(backupA.id);
    expect(listedByA.map((record) => record.id)).not.toContain(backupB.id);
    expect(listedByA.every((record) => record.organizationId === organizationA)).toBe(true);
    await expect(runtimeA.service.restoreToNewDatabase({ backupId: backupB.id }))
      .rejects.toMatchObject({ code: "BACKUP_NOT_FOUND" });

    // Und die Ebene unter der Datenbank: selbst mit den Bytes und demselben
    // Mandanten-Schluessel geht der Umschlag unter einer fremden Kennung nicht
    // auf. Erst das Paeckchen des Datenschluessels, dann das Artefakt.
    const artifactB = await objects.get(backupB.objectKey!);
    await expect(protector.unwrap({
      wrapped: backupB.wrappedDataKey!,
      keyId: backupB.keyId!,
      identity: identityOf(backupA),
    })).rejects.toMatchObject({ code: "DATA_KEY_INVALID" });
    const keyOfB = await protector.unwrap({
      wrapped: backupB.wrappedDataKey!,
      keyId: backupB.keyId!,
      identity: identityOf(backupB),
    });
    // Seit 2.129 ist das Artefakt eine Teilefolge, also wird hier ein **Teil**
    // geoeffnet und nicht ein Umschlag ueber das Ganze. Der Dump dieses Falls
    // passt in einen Teil, also ist es Teil 1 und gleichzeitig der letzte.
    const {
      CHUNKED_HEADER_BYTES, NO_PREVIOUS_TAG, openBackupPart,
    } = await import("@/lib/server/backup/project-database-artifact");
    const partOfB = {
      part: artifactB.subarray(CHUNKED_HEADER_BYTES),
      dataKey: keyOfB,
      partPlaintextBytes: backupB.partPlaintextBytes!,
      partNumber: 1,
      final: true,
      previousTagHex: NO_PREVIOUS_TAG,
    };
    expect(() => openBackupPart({ ...partOfB, identity: identityOf(backupA) }))
      .toThrowError(expect.objectContaining({ code: "ARTIFACT_IDENTITY_MISMATCH" }));
    // Die Gegenprobe: mit der eigenen Kennung geht er auf. Sonst belegte die
    // Ablehnung oben nur, dass irgendetwas kaputt ist.
    const dumpOfB = openBackupPart({ ...partOfB, identity: identityOf(backupB) }).chunk;
    const plaintextOfB = dumpOfB.toString("utf8");
    expect(plaintextOfB).toContain("CREATE TABLE");
    expect(plaintextOfB).toContain(invoices);
    keyOfB.fill(0);

    // --- 8. Aufbewahrung -------------------------------------------------
    //
    // Die Uhr des Dienstes A geht 31 Tage vor. Was dann abgelaufen ist, raeumt
    // der Aufraeumer weg: erst das Objekt, dann die Zeile.
    clockA = new Date(clockA.getTime() + 31 * DAY_MS);
    const removed = await runtimeA.service.pruneExpired({ batchSize: 5 });
    expect(removed).toBe(1);
    const forgotten = (await runtimeA.store.get(backupA.id))!;
    expect(forgotten.status).toBe("expired");
    expect(forgotten.objectKey).toBeNull();
    expect(forgotten.wrappedDataKey).toBeNull();
    // Die Zeile bleibt als Tatsache stehen: es hat ein Backup gegeben.
    expect(forgotten.manifestSha256).toBe(backupA.manifestSha256);
    expect(forgotten.completedAt).not.toBeNull();
    await expect(objects.get(backupA.objectKey!)).rejects.toMatchObject({ code: "OBJECT_NOT_FOUND" });
    // Das Backup der anderen Organisation hat der Aufraeumer von A nicht
    // angefasst, und zwar ohne dass er es ausschliessen musste.
    const untouched = (await runtimeB.store.get(backupB.id))!;
    expect(untouched.status).toBe("available");
    const stillThere = await objects.get(untouched.objectKey!);
    expect(stillThere.length).toBe(untouched.sizeBytes);

    // Die Evidenzzeile des Laufs, fuer das Zertifizierungsskript.
    const evidence = {
      schemaVersion: "qkern.project-database-backup-drill/v1",
      backupBytes: backupA.sizeBytes,
      manifestSha256: backupA.manifestSha256,
      restoredManifestSha256: restored.restoredManifestSha256,
      tables: restored.restoredManifest.tableCount,
      rows: restored.restoredManifest.rowCount,
    };
    process.stdout.write(`QKERN_PROJECT_BACKUP_EVIDENCE_BASE64 ${
      Buffer.from(JSON.stringify(evidence)).toString("base64")}\n`);
  }, 900_000);
});
