import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BackupRestoreEvidenceVerifier,
  canonicalBackupRestoreEvidencePayload,
  type BackupRestoreEvidence,
  type BackupRestoreEvidenceEnvelope,
} from "@/lib/server/backup/restore-evidence";

/**
 * Backup-/Restore-Drill gegen echtes PostgreSQL 17 mit TLS-Pflicht und
 * WAL-Archiv (Sprosse 10, 2.29). Der Drill ist das, was ein Betreiber jede
 * Woche tun muesste, als Programm:
 *
 *   1. Nur TLS: eine Verbindung ohne TLS wird abgewiesen, die mit TLS zeigt
 *      `pg_stat_ssl.ssl = true`.
 *   2. Daten der Phase A, dazu drei Eintraege der Audit-Kette. Basisbackup
 *      ueber die Replikationsverbindung, als Tar, ohne WAL: das WAL kommt aus
 *      dem Archiv, sonst waere es kein Point-in-time Recovery. Das Artefakt
 *      wird mit AES-256 verschluesselt, der Klartext geloescht.
 *   3. Phase B, Manifest der Daten, Zielzeitpunkt. Dann Phase C, die nach dem
 *      Zielzeitpunkt liegt und im Restore fehlen muss. WAL-Segment wechseln
 *      und warten, bis das Archiv es hat.
 *   4. Zweiter Server aus dem entschluesselten Backup mit `restore_command`
 *      aus dem Archiv und `recovery_target_time`; warten, bis er befoerdert ist.
 *   5. Belegen: Schema gleich (pg_dump -s), Zeilen von A und B da, C nicht,
 *      Audit-Kette verkettet und jeder Hash nachgerechnet, Manifest gleich.
 *   6. Die Evidenz im Format des Produkts signieren und mit dem Verifier des
 *      Produkts pruefen.
 */
const enabled = process.env.QKERN_TEST_BACKUP_DRILL === "true";
const HOST = process.env.QKERN_TEST_BACKUP_SOURCE_HOST ?? "";
const USER = process.env.QKERN_TEST_BACKUP_SOURCE_USER ?? "";
const PASSWORD = process.env.QKERN_TEST_BACKUP_SOURCE_PASSWORD ?? "";
const DB = process.env.QKERN_TEST_BACKUP_SOURCE_DB ?? "";
const CA_FILE = process.env.QKERN_TEST_BACKUP_CA_FILE ?? "";
const ARCHIVE = process.env.QKERN_TEST_BACKUP_WAL_ARCHIVE ?? "";
const WORKDIR = process.env.QKERN_TEST_BACKUP_WORKDIR ?? "/drill";
// Der Restore-Server laeuft als unprivilegierter Benutzer; im Stack ist das
// der `postgres`-Benutzer des Alpine-Pakets (uid 70), derselbe wie beim
// Quellserver, damit er die archivierten Segmente (0600) lesen darf.
const RESTORE_USER = process.env.QKERN_TEST_BACKUP_RESTORE_USER ?? "postgres";
const RESTORE_PORT = 5433;

type Row = Record<string, unknown>;
type Client = { connect(): Promise<void>; query<R extends Row = Row>(text: string, values?: unknown[]): Promise<{ rows: R[] }>; end(): Promise<void>; on(event: "error", listener: (error: Error) => void): void };

const requireModule = createRequire(import.meta.url);
function pgClient(options: Record<string, unknown>): Client {
  const { Client } = requireModule("pg") as { Client: new (options: Record<string, unknown>) => Client };
  return new Client(options);
}
function sourceClient(): Client {
  return pgClient({ host: HOST, port: 5432, user: USER, password: PASSWORD, database: DB, ssl: { ca: readFileSync(CA_FILE, "utf8"), servername: HOST, rejectUnauthorized: true } });
}
function restoredClient(): Client {
  return pgClient({ host: "127.0.0.1", port: RESTORE_PORT, user: USER, database: DB, ssl: false });
}
const sourceConnectionString = () => `host=${HOST} port=5432 user=${USER} password=${PASSWORD} sslmode=verify-full sslrootcert=${CA_FILE}`;
const wholeSecond = () => { const d = new Date(); d.setMilliseconds(0); return d; };
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Daten und Audit-Kette als geordnete Zeilen, gehasht: gleich nur, wenn alles gleich ist. */
async function manifest(client: Client): Promise<string> {
  const orders = await client.query("SELECT id, label, amount FROM drill_orders ORDER BY id");
  const audit = await client.query("SELECT id, action, previous_hash, entry_hash FROM audit_logs ORDER BY created_at, id");
  return sha256(JSON.stringify({ orders: orders.rows, audit: audit.rows }));
}

async function auditChainIntact(client: Client): Promise<boolean> {
  const rows = await client.query<{ ok: boolean; linked: boolean }>(`
    WITH ordered AS (
      SELECT *, lag(entry_hash) OVER (PARTITION BY organization_id ORDER BY created_at, id) AS expected_previous
      FROM audit_logs
    )
    SELECT bool_and(entry_hash = encode(digest(jsonb_build_object(
             'id', id, 'organization_id', organization_id, 'project_id', project_id, 'environment', environment,
             'actor_type', actor_type, 'actor_ref', actor_ref, 'action', action, 'resource_ref', resource_ref,
             'status', status, 'redacted_metadata', redacted_metadata, 'previous_hash', previous_hash, 'created_at', created_at
           )::text, 'sha256'), 'hex')) AS ok,
           bool_and(previous_hash IS NOT DISTINCT FROM expected_previous) AS linked
    FROM ordered`);
  return rows.rows[0]?.ok === true && rows.rows[0]?.linked === true;
}

describe.runIf(enabled)("Backup and restore drill against TLS PostgreSQL 17 with a WAL archive", () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const baseDir = path.join(WORKDIR, "base");
  const restoreDir = path.join(WORKDIR, "restore");
  const artifact = path.join(WORKDIR, "base.tar.enc");
  const secretFile = path.join(WORKDIR, "backup.key");
  let source: Client;
  let restored: Client | undefined;

  beforeAll(async () => {
    source = sourceClient();
    await source.connect();
  }, 60_000);

  afterAll(async () => {
    // Erst die Verbindung schliessen, dann den Server: sonst meldet pg ein
    // "terminating connection due to administrator command" als unbehandelt.
    await restored?.end().catch(() => undefined);
    spawnSync("su-exec", [RESTORE_USER, "pg_ctl", "-D", path.join(restoreDir, "data"), "stop", "-m", "fast"], { stdio: "ignore" });
    await source?.end();
  });

  it("performs a point-in-time restore from the encrypted base backup and the WAL archive, and proves it", async () => {
    // 1. TLS ist Pflicht.
    const ssl = await source.query<{ ssl: boolean }>("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
    expect(ssl.rows[0]?.ssl).toBe(true);
    const plain = pgClient({ host: HOST, port: 5432, user: USER, password: PASSWORD, database: DB, ssl: false });
    await expect(plain.connect()).rejects.toThrow();
    await plain.end().catch(() => undefined);

    // 2. Phase A und die Audit-Kette, dann das verschluesselte Basisbackup.
    await source.query("CREATE TABLE drill_orders (id integer PRIMARY KEY, label text NOT NULL, amount integer NOT NULL)");
    await source.query("INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, '$argon2id$drill-only', 'active')", [userId, `drill-${userId}@qkern.test`]);
    await source.query("INSERT INTO organizations (id, name, slug, created_by) VALUES ($1, 'Drill', $2, $3)", [organizationId, `drill-${organizationId}`, userId]);
    const audit = (action: string) => source.query(
      "INSERT INTO audit_logs (organization_id, actor_type, actor_ref, action, resource_ref, status) VALUES ($1, 'drill', 'backup-drill', $2, 'drill', 'ok')",
      [organizationId, action],
    );
    for (let i = 1; i <= 3; i += 1) { await source.query("INSERT INTO drill_orders VALUES ($1, $2, $3)", [i, `phase-a-${i}`, i * 10]); await audit(`phase-a-${i}`); }

    const backupSnapshotAt = wholeSecond();
    mkdirSync(baseDir, { recursive: true });
    execFileSync("pg_basebackup", ["-D", baseDir, "-Ft", "-X", "none", "-c", "fast", "-d", `${sourceConnectionString()} dbname=replication`], { stdio: "inherit" });
    writeFileSync(secretFile, randomBytes(32).toString("hex"), { mode: 0o600 });
    execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-in", path.join(baseDir, "base.tar"), "-out", artifact, "-pass", `file:${secretFile}`], { stdio: "inherit" });
    rmSync(path.join(baseDir, "base.tar"));
    const backupArtifactSha256 = sha256(readFileSync(artifact));

    // 3. Phase B, Manifest, Zielzeit; Phase C danach; WAL ins Archiv.
    for (let i = 4; i <= 6; i += 1) { await source.query("INSERT INTO drill_orders VALUES ($1, $2, $3)", [i, `phase-b-${i}`, i * 10]); await audit(`phase-b-${i}`); }
    const sourceDataManifestSha256 = await manifest(source);
    const sourceSchema = execFileSync("pg_dump", ["--schema-only", "--no-owner", "--no-privileges", "-d", `${sourceConnectionString()} dbname=${DB}`], { encoding: "utf8" });
    await sleep(1_500);
    const target = await source.query<{ now: string }>("SELECT clock_timestamp()::text AS now");
    const recoveryTargetTime = target.rows[0].now;
    await sleep(1_500);
    for (let i = 7; i <= 9; i += 1) { await source.query("INSERT INTO drill_orders VALUES ($1, $2, $3)", [i, `phase-c-${i}`, i * 10]); await audit(`phase-c-${i}`); }
    const switched = await source.query<{ segment: string }>("SELECT pg_walfile_name(pg_switch_wal()) AS segment");
    const segment = switched.rows[0].segment;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const archived = await source.query<{ last: string | null }>("SELECT last_archived_wal AS last FROM pg_stat_archiver");
      if (archived.rows[0]?.last && archived.rows[0].last >= segment) break;
      await sleep(1_000);
    }
    expect(readFileSync(path.join(ARCHIVE, segment)).length).toBeGreaterThan(0);
    const backupCompletedAt = wholeSecond();

    // 4. Zweiter Server aus Backup und Archiv bis zur Zielzeit.
    const restoreStartedAt = wholeSecond();
    const dataDir = path.join(restoreDir, "data");
    mkdirSync(dataDir, { recursive: true });
    execFileSync("sh", ["-ec", `openssl enc -d -aes-256-cbc -pbkdf2 -in ${artifact} -pass file:${secretFile} | tar -C ${dataDir} -xf -`], { stdio: "inherit" });
    writeFileSync(path.join(dataDir, "postgresql.auto.conf"), [
      `restore_command = 'cp ${ARCHIVE}/%f %p'`,
      `recovery_target_time = '${recoveryTargetTime}'`,
      "recovery_target_action = 'promote'",
      "archive_mode = off",
      "ssl = off",
      `port = ${RESTORE_PORT}`,
      "listen_addresses = '127.0.0.1'",
      // Das Alpine-Paket erwartet den Socket unter /run/postgresql, das dem
      // Drill-Benutzer nicht gehoert; der Socket liegt im Restore-Ordner.
      `unix_socket_directories = '${restoreDir}'`,
      "",
    ].join("\n"));
    writeFileSync(path.join(dataDir, "recovery.signal"), "");
    execFileSync("chown", ["-R", RESTORE_USER, restoreDir]);
    chmodSync(dataDir, 0o700);
    const serverLog = path.join(restoreDir, "server.log");
    try {
      execFileSync("su-exec", [RESTORE_USER, "pg_ctl", "-D", dataDir, "-l", serverLog, "-w", "-t", "120", "start"], { stdio: "inherit" });
    } catch (error) {
      const tail = existsSync(serverLog) ? readFileSync(serverLog, "utf8").slice(-4_000) : "(kein server.log)";
      throw new Error(`Restore-Server startete nicht: ${(error as Error).message}\n${tail}`);
    }
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const candidate = restoredClient();
        candidate.on("error", () => undefined);
        await candidate.connect();
        const state = await candidate.query<{ recovering: boolean }>("SELECT pg_is_in_recovery() AS recovering");
        if (!state.rows[0].recovering) { restored = candidate; break; }
        await candidate.end();
      } catch { /* noch nicht bereit */ }
      await sleep(1_000);
    }
    expect(restored, readFileSync(path.join(restoreDir, "server.log"), "utf8").slice(-2_000)).toBeDefined();
    const restoreCompletedAt = wholeSecond();

    // 5. Belegen.
    const rows = await restored!.query<{ id: number; label: string }>("SELECT id, label FROM drill_orders ORDER BY id");
    expect(rows.rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.rows.some((row) => row.label.startsWith("phase-c"))).toBe(false);
    const restoredSchema = execFileSync("pg_dump", ["--schema-only", "--no-owner", "--no-privileges", "-h", "127.0.0.1", "-p", String(RESTORE_PORT), "-U", USER, "-d", DB], { encoding: "utf8" });
    // Kommentare, Leerzeilen und die zufaelligen `\restrict`-Schluessel, die
    // pg_dump seit 17.6 einstreut, sind kein Schema. Beim Unterschied nennt
    // die Meldung die erste abweichende Zeile statt zweier Hashes.
    const strip = (dump: string) => dump.split("\n").filter((line) => !line.startsWith("--") && !/^\\(un)?restrict /.test(line) && line.trim() !== "");
    const restoredLines = strip(restoredSchema);
    const sourceLines = strip(sourceSchema);
    const firstDiff = restoredLines.findIndex((line, index) => line !== sourceLines[index]);
    expect(sha256(restoredLines.join("\n")), `Schema weicht ab ab Zeile ${firstDiff + 1}: Quelle "${sourceLines[firstDiff] ?? "(Ende)"}", Restore "${restoredLines[firstDiff] ?? "(Ende)"}"`).toBe(sha256(sourceLines.join("\n")));
    const auditCount = await restored!.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_logs WHERE organization_id = $1", [organizationId]);
    expect(auditCount.rows[0].n).toBe("6");
    expect(await auditChainIntact(restored!)).toBe(true);
    const restoredDataManifestSha256 = await manifest(restored!);
    expect(restoredDataManifestSha256).toBe(sourceDataManifestSha256);
    await restored!.end();

    // 6. Evidenz im Format des Produkts, mit dem Verifier des Produkts geprueft.
    const verifiedAt = wholeSecond();
    const pair = generateKeyPairSync("ed25519");
    const jwk = pair.publicKey.export({ format: "jwk" }) as { x: string };
    const keyId = `drill-${verifiedAt.toISOString().slice(0, 10)}`;
    const evidence: BackupRestoreEvidence = {
      evidenceId: randomUUID(), deployment: "production", scope: "control_plane",
      backupSnapshotAt: backupSnapshotAt.toISOString(), backupCompletedAt: backupCompletedAt.toISOString(),
      restoreStartedAt: restoreStartedAt.toISOString(), restoreCompletedAt: restoreCompletedAt.toISOString(), verifiedAt: verifiedAt.toISOString(),
      recoveryPointLagSeconds: (backupCompletedAt.getTime() - backupSnapshotAt.getTime()) / 1_000,
      restoreDurationSeconds: (restoreCompletedAt.getTime() - restoreStartedAt.getTime()) / 1_000,
      backupArtifactSha256, sourceDataManifestSha256, restoredDataManifestSha256,
      encrypted: true, checksumVerified: true, schemaVerified: true, rowCountsVerified: true, auditChainVerified: true, result: "passed",
    };
    const unsigned = { schemaVersion: "qkern.backup-restore-evidence/v1" as const, keyId, evidence };
    const envelope: BackupRestoreEvidenceEnvelope = { ...unsigned, signature: sign(null, canonicalBackupRestoreEvidencePayload(unsigned), pair.privateKey).toString("base64url") };
    const verifierKey = { schemaVersion: "qkern.backup-restore-verifier-key/v1", keyId, publicKey: jwk.x };
    const evidenceBytes = Buffer.from(JSON.stringify(envelope, null, 2));
    const keyBytes = Buffer.from(JSON.stringify(verifierKey, null, 2));
    const verifier = new BackupRestoreEvidenceVerifier({ read: () => evidenceBytes }, { read: () => keyBytes }, sha256(Buffer.from(jwk.x, "base64url")));
    const readiness = await verifier.verify();
    expect(readiness).toMatchObject({ status: "ready", scope: "control_plane", recoveryPointLagSeconds: evidence.recoveryPointLagSeconds });
    process.stdout.write(`QKERN_BACKUP_EVIDENCE_BASE64 ${evidenceBytes.toString("base64")}\n`);
    process.stdout.write(`QKERN_BACKUP_VERIFIER_KEY_BASE64 ${keyBytes.toString("base64")}\n`);
  }, 600_000);
});
