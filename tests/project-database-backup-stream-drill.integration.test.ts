import { X509Certificate, randomUUID } from "node:crypto";
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
import { restoreDatabaseName } from "@/lib/server/backup/project-database";
import {
  CHUNKED_HEADER_BYTES,
  CHUNKED_PART_OVERHEAD_BYTES,
  chunkedPartCount,
} from "@/lib/server/backup/project-database-artifact";
import { S3ProjectDatabaseBackupObjectStore } from "@/lib/server/backup/project-database-object-store";

/**
 * Der stueckweise Backup-Weg und der Zeitplan gegen echte Dienste -- Fall
 * `(2.129)`.
 *
 * ## Was dieser Fall belegt und `(2.126)` nicht
 *
 * `(2.126)` hat ein Backup von 14 kB gefahren: **ein** Umschlag, **ein** `PUT`,
 * und die Obergrenze von 256 MiB war durch keinen Lauf geprueft. Das stand in
 * `docs/RELEASE_2.73.md` selbst als offen.
 *
 * Hier laufen die drei Zusagen aus 2.129 gegen echtes PostgreSQL 17 mit
 * TLS-Pflicht, echten Vault und echten Objektspeicher:
 *
 * 1. **Mehr als ein Teil.** Der Dump ist gross genug fuer drei Teile, geht als
 *    Strom durch die Verschluesselung in einen echten Multipart-Upload und kommt
 *    ueber echte Bytebereiche wieder zusammen. Der Fall rechnet die Teilezahl
 *    aus Groesse und Teilegroesse nach und sieht nach, dass das Artefakt wirklich
 *    aus Teilen besteht.
 * 2. **Die Obergrenze.** Sie ist nicht gesetzt, sie ist gerechnet: Nutzbytes je
 *    Teil mal Teilezahl. Dieser Fall prueft **dieselbe Rechnung** mit zwei
 *    kleineren Zahlen, also ohne gigabyteweise Daten zu schreiben -- und dass
 *    der Lauf darueber mit `ARTIFACT_TOO_LARGE` faellt und **kein Objekt**
 *    liegen laesst. Was er nicht belegt, ist, dass 625 GiB durchgehen; das steht
 *    so im Backup-Dokument.
 * 3. **Der Zeitplan.** Eine faellige Zeitplanzeile, eine Runde des Dienstes, und
 *    daraus ein Auftrag, der in derselben Runde gefahren wird. Dazu: ein
 *    faelliger Takt, der den vorigen noch laufend findet, legt keinen zweiten
 *    Auftrag an und zaehlt es in der Zeile. Und der Aufraeumer hat einen
 *    Aufrufer.
 * 4. **Die bestellte Wiederherstellung.** Der Weg, den die Route anstoesst: eine
 *    Bestellung in der Zeile, und der Dienst fahrt sie in seiner Runde -- **vor**
 *    einem wartenden Backup, weil dort ein Mensch wartet.
 *
 * ## Warum die Teilegroesse hier 5 MiB ist und nicht 64
 *
 * 5 MiB ist die Mindestgroesse eines Teils im S3-Protokoll; darunter weist ein
 * Anbieter den Abschluss eines Uploads mit mehr als einem Teil ab. Der Fall
 * nimmt also den **kleinsten Wert, den der echte Objektspeicher annimmt**, und
 * schreibt damit 12 MB statt 128. Der Produktweg ist derselbe Code; was sich
 * aendert, sind zwei Zahlen, und genau deren Wirkung prueft Schritt 2.
 */
const enabled = process.env.QKERN_TEST_PROJECT_BACKUP_STREAM_DRILL === "true";

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

/** Dieselbe Zahl wie im Stack, und die Mindestgroesse eines S3-Teils. */
const PART_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1_000;

describe.runIf(enabled)("Project database backup stream, limit and schedule drill (2.129)", () => {
  const controlUser = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const reference = `managed:stream-${suffix}`;
  const bulk = `stream_bulk_${suffix}`;

  let owner: SqlPool;
  let provisioner: SqlPool;
  let project: SqlPool;
  let runtime: ProjectDatabaseBackupRuntime;
  /** Derselbe Weg, aber mit einer Teilezahl von 2: damit ist die Grenze 10 MiB. */
  let tight: ProjectDatabaseBackupRuntime;
  let clock = new Date();
  let objects: S3ProjectDatabaseBackupObjectStore;
  let serverCertificateSha256 = "";
  const restoreDatabases: string[] = [];

  function backupEnv(workerId: string, overrides: Record<string, string> = {}) {
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
      QKERN_PROJECT_BACKUP_PART_BYTES: String(PART_BYTES),
      QKERN_VAULT_DATABASE_URL: vaultDatabaseUrl,
      QKERN_VAULT_TOKEN_FILE: vaultTokenFile,
      ...overrides,
    };
  }

  async function s3(method: "PUT", path: string): Promise<Response> {
    const url = new URL(objectEndpoint);
    url.pathname = path;
    return fetch(url, {
      method,
      headers: signSigV4Request({
        method, url, payloadHash: sha256Hex(""),
        accessKeyId: objectAccessKeyId, secret: objectSecretAccessKey,
        region: objectRegion, now: new Date(),
      }),
      redirect: "error",
    });
  }

  beforeAll(async () => {
    serverCertificateSha256 = new X509Certificate(await readFile(serverCertFile))
      .fingerprint256.replaceAll(":", "").toLowerCase();
    const ssl = { rejectUnauthorized: true as const };
    owner = createPostgresPool({ connectionString: ownerUrl, max: 3, ssl });
    provisioner = verifyDatabaseBoundary(
      createPostgresPool({ connectionString: provisionerUrl, max: 4, ssl }), "provisioner",
    );
    project = createPostgresPool({ connectionString: projectDatabaseUrl, max: 3, ssl });

    await owner.query(
      `INSERT INTO users (id, email, password_hash, status)
       VALUES ($1, $2, '$argon2id$drill-only', 'active')`,
      [controlUser, `stream-drill-${controlUser}@qkern.test`],
    );
    await owner.query(
      `INSERT INTO organizations (id, name, slug, created_by) VALUES ($1, 'Stream Drill', $2, $3)`,
      [organizationId, `stream-drill-${organizationId}`, controlUser],
    );
    await owner.query(
      `INSERT INTO projects (id, organization_id, name, slug, region, status, created_by)
       VALUES ($1, $2, 'Stream Drill', $3, 'test', 'ready', $4)`,
      [projectId, organizationId, `stream-drill-${projectId}`, controlUser],
    );
    await owner.query(
      `INSERT INTO project_environments (organization_id, project_id, environment, database_instance_ref)
       VALUES ($1, $2, 'production', $3)`,
      [organizationId, projectId, reference],
    );
    const jobId = randomUUID();
    await owner.query(
      `INSERT INTO project_database_provisioning_jobs
         (id, organization_id, project_id, environment, requested_by, status)
       VALUES ($1, $2, $3, 'production', 'stream-drill', 'pending')`,
      [jobId, organizationId, projectId],
    );
    // Der Trigger aus 0084 legt mit dieser Bindung den Zeitplan an. Dass er das
    // tut, prueft Schritt 4; hier zaehlt, dass niemand ihn von Hand anlegt.
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

    const created = await s3("PUT", `/${objectBucket}`);
    expect([200, 204, 409]).toContain(created.status);
    objects = new S3ProjectDatabaseBackupObjectStore({
      endpoint: objectEndpoint, region: objectRegion, bucket: objectBucket,
      accessKeyId: objectAccessKeyId, secretAccessKey: objectSecretAccessKey,
    });

    const controlPlane = new PostgresControlPlane(provisioner);
    const logger = { log: (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`) };
    runtime = createProjectDatabaseBackupRuntimeFromEnv(backupEnv("stream-worker"), {
      controlPlane, controlPlanePool: provisioner, now: () => clock, logger,
    })!;
    tight = createProjectDatabaseBackupRuntimeFromEnv(
      backupEnv("tight-worker", { QKERN_PROJECT_BACKUP_MAX_PARTS: "2" }),
      { controlPlane, controlPlanePool: provisioner, now: () => clock, logger },
    )!;
    expect(runtime).toBeTruthy();
    expect(tight).toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    for (const name of restoreDatabases) {
      await owner.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    }
    // Die grosse Tabelle wieder weg: sie liegt in der **lebenden**
    // Projektdatenbank, die der Stack allen Faellen teilt, und ein Dump von 12 MB
    // in einem fremden Fall waere Last ohne Zusage.
    await project.query(`DROP TABLE IF EXISTS public.${bulk}`).catch(() => undefined);
    await Promise.allSettled([runtime?.close(), tight?.close()]);
    await Promise.allSettled([project?.end(), provisioner?.end(), owner?.end()]);
  }, 180_000);

  it("streams a dump larger than one part into a real multipart upload, reads it back in ranges, enforces the computed limit without writing gigabytes, and runs the schedule and the requested restore in the round that exists", async () => {
    // --- 1. Ein Stand, der mehr als einen Teil braucht ---------------------
    //
    // 12 000 Zeilen mal etwa 1 kB. Das ist absichtlich kein Zufallsinhalt: ein
    // wiederholbarer Inhalt ist nach der Wiederherstellung nachrechenbar, und
    // `md5` ueber alle Zeilen ist eine Zahl, die ein fehlendes Stueck zeigt.
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
      `CREATE TABLE public.${bulk} (
         id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
         marker text NOT NULL,
         filler text NOT NULL)`,
      `INSERT INTO public.${bulk} (marker, filler)
       SELECT 'stream-marker-' || n, repeat(md5(n::text), 32)
       FROM generate_series(1, 12000) AS n`,
    ]);
    const sourceDigest = await project.query<{ digest: string; n: string }>(
      `SELECT md5(string_agg(marker || filler, '|' ORDER BY id)) AS digest,
              count(*)::text AS n
       FROM public.${bulk}`,
    );
    expect(sourceDigest.rows[0].n).toBe("12000");

    // --- 2. Das Backup geht stueckweise hinaus ----------------------------
    const job = await runtime.service.enqueue(
      { organizationId, projectId, environment: "production" }, reference,
    );
    const round = await runtime.service.runRound();
    expect(round, JSON.stringify(round)).toMatchObject({ status: "succeeded", backupId: job.id });
    const backup = (await runtime.store.get(job.id))!;
    expect(backup.status).toBe("available");
    expect(backup.artifactFormat).toBe("chunked");
    expect(backup.partPlaintextBytes).toBe(PART_BYTES);
    // Mehr als ein Teil, und das ist der ganze Punkt dieses Falls.
    expect(backup.partCount).toBeGreaterThan(1);
    // Die Teilezahl der Zeile ist die, die aus Groesse und Teilegroesse folgt.
    // Weichen sie ab, ist das ein Befund und kein Rundungsfehler.
    expect(chunkedPartCount(backup.sizeBytes!, PART_BYTES)).toBe(backup.partCount);
    // Und die Groesse ist die, die der Aufbau vorgibt: Kopf, plus je Teil 12
    // Byte IV und 16 Byte Tag, plus die Nutzbytes.
    const overhead = CHUNKED_HEADER_BYTES + backup.partCount! * CHUNKED_PART_OVERHEAD_BYTES;
    expect(backup.sizeBytes! - overhead).toBeGreaterThan((backup.partCount! - 1) * PART_BYTES);

    // Das Objekt liegt wirklich, und sein Kopf ist der des stueckweisen Formats.
    const head = await objects.getRange(backup.objectKey!, 0, CHUNKED_HEADER_BYTES);
    expect(head.subarray(0, 8).toString("utf8")).toBe("QKBAKC1\n");
    expect(head.readUInt32BE(8)).toBe(PART_BYTES);
    // Und es ist verschluesselt: kein Schemawort, kein Marker einer Zeile, und
    // zwar auch nicht an der Grenze zwischen zwei Teilen -- genau dort steht bei
    // einem falsch gebauten Strom unverschluesselter Rest.
    const seam = await objects.getRange(
      backup.objectKey!, CHUNKED_HEADER_BYTES + PART_BYTES - 1_024, 4_096,
    );
    const seamText = seam.toString("latin1");
    expect(seamText.includes("stream-marker-")).toBe(false);
    expect(seamText.includes("CREATE TABLE")).toBe(false);
    expect(seamText.includes("QKBAKC1")).toBe(false);

    // --- 3. Die Wiederherstellung liest in Bereichen ----------------------
    const restored = await runtime.service.restoreToNewDatabase({ backupId: backup.id });
    restoreDatabases.push(restored.databaseName);
    expect(restored.restoredManifestSha256).toBe(restored.expectedManifestSha256);
    const restoredPool = createPostgresPool({
      connectionString: projectDatabaseUrl.replace(`/${projectDatabaseName}`, `/${restored.databaseName}`),
      max: 2,
      ssl: { rejectUnauthorized: true },
    });
    try {
      // Dieselbe Zahl ueber alle Zeilen. Ein weggelassener oder vertauschter Teil
      // kippt sie, und zwar auch dann, wenn die Zeilenzahl stimmt.
      const back = await restoredPool.query<{ digest: string; n: string }>(
        `SELECT md5(string_agg(marker || filler, '|' ORDER BY id)) AS digest,
                count(*)::text AS n
         FROM public.${bulk}`,
      );
      expect(back.rows[0].n).toBe("12000");
      expect(back.rows[0].digest).toBe(sourceDigest.rows[0].digest);
    } finally {
      await restoredPool.end();
    }

    // --- 4. Die Obergrenze, gerechnet und geprueft ------------------------
    //
    // Derselbe Weg, dieselbe Teilegroesse, aber Teilezahl 2. Die Grenze ist
    // damit 10 MiB, und der Dump ist groesser. Gerechnet wird sie im Dienst und
    // nicht hier: `maxDumpBytes` ist dieselbe Funktion, die im Produkt 625 GiB
    // ergibt.
    expect(tight.service.maxDumpBytes).toBe(2 * PART_BYTES);
    const tooBig = await tight.service.enqueue(
      { organizationId, projectId, environment: "production" }, reference,
    );
    const tightRound = await tight.service.runRound();
    expect(tightRound, JSON.stringify(tightRound))
      .toMatchObject({ status: "failed", errorCode: "ARTIFACT_TOO_LARGE" });
    const failed = (await tight.store.get(tooBig.id))!;
    expect(failed.lastErrorCode).toBe("ARTIFACT_TOO_LARGE");
    expect(failed.objectKey).toBeNull();
    // Und es liegt **kein** Objekt und kein offener Upload: der Abbruch raeumt
    // die Teile weg, sonst kosten sie Platz, ohne je ein Objekt zu werden.
    await expect(objects.get(
      `project-database-backups/${organizationId}/${projectId}/production/${tooBig.id}.qkbak`,
    )).rejects.toMatchObject({ code: "OBJECT_NOT_FOUND" });

    // Der Auftrag wird abgeraeumt, damit die naechsten Schritte nicht ueber ihn
    // stolpern: `enqueue` gibt sonst ihn zurueck statt einen neuen Auftrag.
    await owner.query(
      `UPDATE project_database_backups SET status = 'failed', last_error_code = 'ARTIFACT_TOO_LARGE'
       WHERE id = $1`, [tooBig.id],
    );

    // --- 5. Der Zeitplan ------------------------------------------------
    //
    // Die Zeile hat der Trigger aus 0084 angelegt, als die Bindung entstand.
    // Niemand legt sie hier an, und das ist die Zusage: jede bereitgestellte
    // Projektdatenbank hat einen Zeitplan.
    const schedule = await runtime.scheduleStore.get({ projectId, environment: "production" });
    expect(schedule, "der Trigger aus 0084 hat keinen Zeitplan angelegt").toBeTruthy();
    expect(schedule).toMatchObject({ enabled: true, intervalHours: 24, retentionDays: 30 });

    // Faellig machen und eine Runde fahren. Was dabei entsteht, entsteht durch
    // den **Dienst** und nicht durch einen Aufruf von `enqueue` im Fall.
    await owner.query(
      `UPDATE project_database_backup_schedules SET next_due_at = $2
       WHERE project_id = $1 AND environment = 'production'`,
      [projectId, new Date(clock.getTime() - 60_000)],
    );
    const scheduled = await runtime.service.runRound();
    expect(scheduled, JSON.stringify(scheduled)).toMatchObject({ status: "succeeded" });
    const scheduledBackup = (await runtime.store.get(
      (scheduled as { backupId: string }).backupId,
    ))!;
    expect(scheduledBackup.id).not.toBe(backup.id);
    expect(scheduledBackup.status).toBe("available");
    const afterTick = await runtime.scheduleStore.get({ projectId, environment: "production" });
    expect(afterTick!.lastBackupId).toBe(scheduledBackup.id);
    expect(afterTick!.busyCount).toBe(0);
    // Fortgeschrieben auf `now + 24 h`, also nicht mehr faellig: eine zweite
    // Runde macht kein zweites Backup.
    expect(afterTick!.nextDueAt.getTime()).toBeGreaterThan(clock.getTime());
    expect(await runtime.service.runRound()).toMatchObject({ status: "idle" });

    // Ein faelliger Takt, der den vorigen noch wartend findet, legt keinen
    // zweiten Auftrag an und zaehlt es in der Zeile.
    const pending = await runtime.service.enqueue(
      { organizationId, projectId, environment: "production" }, reference,
    );
    await owner.query(
      `UPDATE project_database_backup_schedules SET next_due_at = $2
       WHERE project_id = $1 AND environment = 'production'`,
      [projectId, new Date(clock.getTime() - 60_000)],
    );
    const busyTick = await runtime.scheduler.tick();
    expect(busyTick).toMatchObject({ due: 1, enqueued: 0, busy: 1, failed: 0 });
    const afterBusy = await runtime.scheduleStore.get({ projectId, environment: "production" });
    expect(afterBusy!.busyCount).toBe(1);
    expect(afterBusy!.lastBackupId).toBe(pending.id);
    // Genau ein wartender Auftrag, nicht zwei.
    const waiting = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project_database_backups
       WHERE project_id = $1 AND status = 'pending'`, [projectId],
    );
    expect(waiting.rows[0].n).toBe("1");
    // Den wartenden Auftrag jetzt fahren, damit er nicht in Schritt 6 dazwischen
    // kommt -- dort soll die Wiederherstellung vorgehen und nicht ein Backup.
    expect(await runtime.service.runRound()).toMatchObject({ status: "succeeded" });

    // --- 6. Die bestellte Wiederherstellung geht vor einem Backup --------
    //
    // So stoesst die Route sie an: eine Bestellung in der Zeile. Gefahren wird
    // sie im Dienst, in derselben Runde, die Backups fahrt.
    const restoreRequested = await runtime.store.requestRestore({
      backupId: scheduledBackup.id,
      databaseName: restoreDatabaseName(scheduledBackup.id),
      requestedBy: `user:${controlUser}`,
      at: clock,
    });
    expect(restoreRequested!.restoreStatus).toBe("requested");
    // Und daneben ein wartendes Backup. Die Runde nimmt die Wiederherstellung.
    const waitingBackup = await runtime.service.enqueue(
      { organizationId, projectId, environment: "production" }, reference,
    );
    const restoreRound = await runtime.service.runRound();
    expect(restoreRound, JSON.stringify(restoreRound))
      .toMatchObject({ status: "restored", backupId: scheduledBackup.id });
    restoreDatabases.push(restoreDatabaseName(scheduledBackup.id));
    const afterRestore = (await runtime.store.get(scheduledBackup.id))!;
    expect(afterRestore.restoreStatus).toBe("succeeded");
    expect(afterRestore.restoreCompletedAt).not.toBeNull();
    expect(afterRestore.restoreErrorCode).toBeNull();
    // Das wartende Backup ist noch da: die Runde hat es nicht mitgenommen.
    expect((await runtime.store.get(waitingBackup.id))!.status).toBe("pending");
    // Die naechste Runde nimmt es dann.
    expect(await runtime.service.runRound())
      .toMatchObject({ status: "succeeded", backupId: waitingBackup.id });

    // --- 7. Der Aufraeumer hat einen Aufrufer ---------------------------
    //
    // Bis 2.129 rief `pruneExpired` niemand von sich aus. Jetzt ruft ihn der
    // Takt, hoechstens einmal je Stunde. Die Uhr des Dienstes geht 31 Tage vor;
    // die des Signierers nicht, und das ist der Befund aus (2.126).
    const before = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project_database_backups
       WHERE project_id = $1 AND status = 'available'`, [projectId],
    );
    expect(Number(before.rows[0].n)).toBeGreaterThan(0);
    clock = new Date(clock.getTime() + 31 * DAY_MS);
    const tick = await runtime.scheduler.tick();
    expect(tick.pruned).toBe(Number(before.rows[0].n));
    const after = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project_database_backups
       WHERE project_id = $1 AND status = 'available'`, [projectId],
    );
    expect(after.rows[0].n).toBe("0");

    // Die Evidenzzeile des Laufs, fuer das Zertifizierungsskript.
    const evidence = {
      schemaVersion: "qkern.project-database-backup-stream-drill/v1",
      partPlaintextBytes: PART_BYTES,
      partCount: backup.partCount,
      artifactBytes: backup.sizeBytes,
      maxDumpBytesTight: tight.service.maxDumpBytes,
      restoredManifestSha256: restored.restoredManifestSha256,
      prunedBySchedule: tick.pruned,
    };
    process.stdout.write(`QKERN_PROJECT_BACKUP_STREAM_EVIDENCE_BASE64 ${
      Buffer.from(JSON.stringify(evidence)).toString("base64")}\n`);
  }, 1_200_000);
});
