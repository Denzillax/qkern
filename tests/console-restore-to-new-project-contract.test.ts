import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  RESTORE_CHAIN_STEPS,
  RESTORE_CHAIN_TEXTS,
  RESTORE_KNOWLEDGE_TEXTS,
  RESTORE_TODAY_TEXTS,
  restoreChain,
} from "@/lib/console/restore-to-new-project-texts";
import { drillFrom } from "@/lib/server/backup/point-in-time";
import {
  BackupRestoreEvidenceUnavailableError,
  BackupRestoreEvidenceVerifier,
  canonicalBackupRestoreEvidencePayload,
  type BackupRestoreEvidence,
  type BackupRestoreEvidenceEnvelope,
  type BackupRestoreReadiness,
} from "@/lib/server/backup/restore-evidence";

/**
 * Datenbank → In neues Projekt wiederherstellen (2.87), am Quelltext
 * geprueft.
 *
 * Es gibt hier bewusst keinen Fall gegen die echte Datenbank, und der Grund
 * ist selbst ein Befund dieses Schnitts: QKERN fuehrt ueber seine Backups
 * nichts in der Kontrollebene. Keine Migration legt eine Tabelle fuer
 * Sicherungslaeufe, Sicherungspunkte oder Groessen an; der erste Fall unten
 * haelt genau das fest. Damit hat die Seite nichts Neues zu lesen: Ihre
 * einzigen echten Zahlen stehen in der signierten Evidenz des letzten
 * Restore-Drills, und die holt schon die vorhandene Route
 * `/database/backups/point-in-time`, deren Lesungen die Faelle in
 * `database-point-in-time-route` und `backup-point-in-time` belegen.
 *
 * Also prueft dieser Vertrag etwas anderes, und zwar das Schwierigere: dass
 * die Saetze der Seite **stimmen**. Jede Aussage ueber das Backup-Skript, den
 * Stack `test:backup:docker`, den Verifier und die Provisionierung wird hier
 * an der Stelle nachgelesen, ueber die sie spricht. Wer den Broker baut, wer
 * eine zweite Umgebung anlegt oder wer den Trigger entfernt, laesst hier
 * einen Fall scheitern, statt die Seite stillschweigend zur Luege zu machen.
 */
const VIEW = "components/console/restore-to-new-project-view.tsx";
const TEXTS = "lib/console/restore-to-new-project-texts.ts";
const DRILL_TEST = "tests/backup-restore-drill.integration.test.ts";
const DRILL_STACK = "docker-compose.backup-certification.yml";
const DRILL_SCRIPT = "scripts/backup-certification.mjs";
const MIGRATIONS = "db/migrations";

async function source(file: string): Promise<string> {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

/**
 * Dieselbe Datei ohne ihre Kommentare. Der Kopf der Ansicht erklaert, warum
 * es kein neues Projekt gibt; eine Zusicherung "kommt nicht vor" muss diese
 * Erklaerung meinen duerfen, ohne an ihr zu scheitern.
 */
async function code(file: string): Promise<string> {
  return (await source(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Alle Quelldateien des Produkts, ohne Tests, Migrationen und Dokumentation. */
async function productFiles(): Promise<string[]> {
  const roots = ["lib", "app", "workers", "components", "scripts", "cli", "sdk", "mcp"];
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(path.resolve(process.cwd(), directory), { withFileTypes: true })) {
      const next = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { await walk(next); continue; }
      if (/\.(ts|tsx|mts|mjs|js)$/.test(entry.name)) files.push(next);
    }
  }
  for (const root of roots) await walk(root);
  return files;
}

/** Jede Migration mit ihrem Inhalt, nach Dateinamen geordnet. */
async function migrations(): Promise<ReadonlyArray<{ name: string; sql: string }>> {
  const names = (await readdir(path.resolve(process.cwd(), MIGRATIONS)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return await Promise.all(names.map(async (name) => ({ name, sql: await source(`${MIGRATIONS}/${name}`) })));
}

// -------------------------------------------------------------------- //
// Die Seite selbst                                                       //
// -------------------------------------------------------------------- //

describe("console restore to new project contract", () => {
  it("makes the page real and takes the placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("db-backups-restore");
    expect(isPlaceholder("db-backups-restore" as never)).toBe(false);
    expect("db-backups-restore" in PLACEHOLDERS).toBe(false);

    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "db-backups-restore": return <RestoreToNewProjectView');

    // Das alte Versprechen steht nirgends mehr, in keiner Sprache.
    const claim = "Ein Backup in ein frisches Projekt einspielen. Kein Backend.";
    expect(await source("components/console/navigation.ts")).not.toContain(claim);
    for (const locale of ["en", "fr", "it"] as const) {
      expect(CONSOLE_TRANSLATIONS[locale][claim], locale).toBeUndefined();
    }
  });

  it("only reads, carries no button that does nothing, and formats through console-display", async () => {
    const view = await code(VIEW);
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    // Der einzige Knopf ausser "Noch einmal" laedt neu, und er tut es wirklich.
    expect(view).toContain("onClick={() => void load()}");
    // Kein abgeschalteter Knopf und kein Platzhalterknopf: Beides waere ein
    // Versprechen, das die Seite nicht halten kann.
    expect(view).not.toContain("disabled");
    expect(view).not.toContain("is-placeholder");
    expect(view).toContain("AbortController");
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
    for (const forbidden of ["Intl.", "toLocaleString", "toLocaleDateString", "toFixed", ".slice(0, 10)"]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
    expect(view).toContain('from "@/components/console/console-display"');
  });

  it("introduces no route of its own and asks the point-in-time route that already exists", async () => {
    const view = await code(VIEW);
    expect(view).toContain("/database/backups/point-in-time");
    // Genau ein fetch, und keine zweite Adresse.
    expect(view.match(/fetch\(/g) ?? []).toHaveLength(1);
    // Unter den Backup-Routen steht weiterhin genau eine, die alte.
    const backupRoutes = await readdir(path.resolve(
      process.cwd(),
      "app/api/v1/projects/[projectId]/environments/[environment]/database/backups",
    ));
    expect([...backupRoutes].sort()).toEqual(["point-in-time"]);
  });

  it("derives the chain so that only the restore run depends on the evidence", () => {
    const withDrill = restoreChain({ lastDrill: {
      verifiedAt: "2026-07-26T10:40:00.000Z",
      backupSnapshotAt: "2026-07-26T10:00:00.000Z",
      recoveryPointLagSeconds: 300,
      restoreDurationSeconds: 1_200,
      proves: [],
    } });
    const withoutDrill = restoreChain({ lastDrill: null });
    expect(withDrill.map((link) => link.step)).toEqual([...RESTORE_CHAIN_STEPS]);
    expect(withDrill.map((link) => link.state)).toEqual(["certified", "missing", "missing", "once_only"]);
    expect(withoutDrill.map((link) => link.state)).toEqual(["unproven", "missing", "missing", "once_only"]);
  });

  // ------------------------------------------------------------------ //
  // "Kein Katalog vergangener Backups" und "Keine Grössen"              //
  // ------------------------------------------------------------------ //

  it("finds no table anywhere in the migrations that would hold a backup", async () => {
    const created: Array<{ migration: string; table: string }> = [];
    for (const { name, sql } of await migrations()) {
      for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
        created.push({ migration: name, table: match[1].toLowerCase() });
      }
    }
    // Ohne Tabellen waere der Fall wertlos; er muss wirklich gelesen haben.
    expect(created.length).toBeGreaterThan(50);
    const backupish = created.filter(({ table }) => /backup|restore|snapshot|recovery_point|wal_/.test(table));
    expect(backupish, "Eine Migration legt jetzt doch eine Backup-Tabelle an").toEqual([]);
    expect(RESTORE_KNOWLEDGE_TEXTS.no_catalogue.explains)
      .toContain("Keine Migration legt eine Tabelle für Backups");
  });

  it("hands out neither a size nor a digest of a backup, exactly as the page says", () => {
    const readiness: BackupRestoreReadiness = {
      status: "ready",
      evidenceId: "7a37f5c5-25d1-4e1b-9cb3-f5f43cc1a88a",
      deployment: "production",
      scope: "control_plane",
      backupSnapshotAt: "2026-07-26T10:00:00.000Z",
      verifiedAt: "2026-07-26T10:40:00.000Z",
      recoveryPointLagSeconds: 300,
      restoreDurationSeconds: 1_200,
      policy: {
        evidenceMaxAgeSeconds: 604_800,
        backupSnapshotMaxAgeAtVerificationSeconds: 86_400,
        recoveryPointLagMaxSeconds: 86_400,
        restoreDurationMaxSeconds: 14_400,
        futureClockSkewSeconds: 300,
      },
    };
    const drill = drillFrom(readiness);
    // Die Projektion der Route ist vollstaendig bekannt: fuenf Felder, und
    // keines davon traegt eine Groesse, einen Hash oder eine Kennung.
    expect(Object.keys(drill!).sort()).toEqual([
      "backupSnapshotAt",
      "proves",
      "recoveryPointLagSeconds",
      "restoreDurationSeconds",
      "verifiedAt",
    ]);
    expect(RESTORE_KNOWLEDGE_TEXTS.no_sizes.explains).toContain("aber keine Bytezahl");
    expect(RESTORE_KNOWLEDGE_TEXTS.no_sizes.explains).toContain("Die Route gibt auch den Hash nicht heraus");
  });

  // ------------------------------------------------------------------ //
  // "Verschlüsselung ist Bedingung" und "Geltungsbereich Kontrollebene" //
  // ------------------------------------------------------------------ //

  it("proves the verifier really refuses unencrypted, failed or foreign-scope evidence", async () => {
    const now = new Date("2026-07-26T12:00:00.000Z");
    const keyId = "restore-contract-2026-07";
    const pair = generateKeyPairSync("ed25519");
    const publicKey = (pair.publicKey.export({ format: "jwk" }) as { x: string }).x;
    const keyBytes = Buffer.from(JSON.stringify({
      schemaVersion: "qkern.backup-restore-verifier-key/v1", keyId, publicKey,
    }));
    const pin = createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex");

    const base: BackupRestoreEvidence = {
      evidenceId: "7a37f5c5-25d1-4e1b-9cb3-f5f43cc1a88a",
      deployment: "production",
      scope: "control_plane",
      backupSnapshotAt: "2026-07-26T10:00:00.000Z",
      backupCompletedAt: "2026-07-26T10:05:00.000Z",
      restoreStartedAt: "2026-07-26T10:10:00.000Z",
      restoreCompletedAt: "2026-07-26T10:30:00.000Z",
      verifiedAt: "2026-07-26T10:40:00.000Z",
      recoveryPointLagSeconds: 300,
      restoreDurationSeconds: 1_200,
      backupArtifactSha256: "a".repeat(64),
      sourceDataManifestSha256: "b".repeat(64),
      restoredDataManifestSha256: "b".repeat(64),
      encrypted: true,
      checksumVerified: true,
      schemaVerified: true,
      rowCountsVerified: true,
      auditChainVerified: true,
      result: "passed",
    };

    /** Signiert die Evidenz richtig; abgelehnt wird sie dann wegen ihres Inhalts, nicht wegen der Signatur. */
    function verifierFor(evidence: BackupRestoreEvidence): BackupRestoreEvidenceVerifier {
      const unsigned = { schemaVersion: "qkern.backup-restore-evidence/v1" as const, keyId, evidence };
      const envelope: BackupRestoreEvidenceEnvelope = {
        ...unsigned,
        signature: sign(null, canonicalBackupRestoreEvidencePayload(unsigned), pair.privateKey).toString("base64url"),
      };
      const evidenceBytes = Buffer.from(JSON.stringify(envelope));
      return new BackupRestoreEvidenceVerifier(
        { read: () => evidenceBytes }, { read: () => keyBytes }, pin, () => now,
      );
    }

    // Die gueltige Form geht durch, sonst belegt die Ablehnung nichts.
    await expect(verifierFor(base).verify()).resolves.toMatchObject({
      status: "ready", scope: "control_plane", recoveryPointLagSeconds: 300, restoreDurationSeconds: 1_200,
    });

    // Und jede einzelne Bedingung, die die Seite nennt, wird wirklich gehalten.
    for (const broken of [
      { encrypted: false },
      { checksumVerified: false },
      { schemaVerified: false },
      { rowCountsVerified: false },
      { auditChainVerified: false },
      { result: "failed" },
      { scope: "project" },
    ] as ReadonlyArray<Record<string, unknown>>) {
      const field = Object.keys(broken)[0];
      await expect(verifierFor({ ...base, ...broken } as BackupRestoreEvidence).verify(), field)
        .rejects.toBeInstanceOf(BackupRestoreEvidenceUnavailableError);
    }

    expect(RESTORE_KNOWLEDGE_TEXTS.encrypted_is_a_condition.explains)
      .toContain("encrypted, checksumVerified, schemaVerified, rowCountsVerified und auditChainVerified alle wahr sind");
    expect(RESTORE_KNOWLEDGE_TEXTS.scope_is_control_plane.explains)
      .toContain("Die Evidenz kennt genau einen Bereich, control_plane");
    // Der Drill signiert wirklich diesen einen Bereich.
    expect(await source(DRILL_TEST)).toContain('deployment: "production", scope: "control_plane"');
  });

  // ------------------------------------------------------------------ //
  // Glied 1: der Wiederherstellungslauf                                 //
  // ------------------------------------------------------------------ //

  it("describes the drill as it really runs: TLS, encrypted base backup, WAL from the archive, a chosen point", async () => {
    const script = await source(DRILL_SCRIPT);
    const stack = await source(DRILL_STACK);
    const drill = await source(DRILL_TEST);
    const manifest = JSON.parse(await source("package.json")) as { scripts: Record<string, string> };

    // Der Stack, den die Seite nennt, ist der, den npm wirklich faehrt.
    expect(manifest.scripts["test:backup:docker"]).toBe("node scripts/backup-certification.mjs");
    expect(script).toContain('"docker-compose.backup-certification.yml"');
    expect(stack).toContain("npx vitest run tests/backup-restore-drill.integration.test.ts");
    expect(RESTORE_CHAIN_TEXTS.restore_run.component)
      .toContain("tests/backup-restore-drill.integration.test.ts, gefahren von npm run test:backup:docker");

    // Echtes PostgreSQL 17 mit TLS-Pflicht: eigenes Zertifikat, eigene pg_hba.
    expect(stack).toContain("image: postgres:17-alpine");
    expect(stack).toContain("- ssl=on");
    expect(stack).toContain("- hba_file=/qkern/backup/pg_hba.conf");
    const hba = await source("db/docker/backup-pg_hba.conf");
    expect(hba).not.toMatch(/^\s*host\s/m);
    expect(hba).toMatch(/^\s*hostssl\s/m);
    expect(drill).toContain("await expect(plain.connect()).rejects.toThrow()");

    // Ein WAL-Archiv, und das Basisbackup enthaelt bewusst kein WAL.
    expect(stack).toContain("- archive_mode=on");
    expect(stack).toContain("- archive_command=cp %p /wal-archive/%f");
    expect(drill).toContain('"-Ft", "-X", "none"');
    expect(drill).toContain("restore_command = 'cp ${ARCHIVE}/%f %p'");

    // Verschluesselt, und der Klartext wird geloescht.
    expect(drill).toContain('"enc", "-aes-256-cbc", "-pbkdf2", "-salt"');
    expect(drill).toContain('rmSync(path.join(baseDir, "base.tar"))');

    // Ein gewaehlter Zeitpunkt, kein "bis zum Ende des Archivs": Phase B ist
    // danach da, Phase C fehlt.
    expect(drill).toContain("recovery_target_time = '${recoveryTargetTime}'");
    expect(drill).toContain("expect(rows.rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6])");
    expect(drill).toContain('expect(rows.rows.some((row) => row.label.startsWith("phase-c"))).toBe(false)');

    // Und der Beleg ueber Schema, Zeilen, Audit-Kette und Manifest.
    expect(drill).toContain("expect(await auditChainIntact(restored!)).toBe(true)");
    expect(drill).toContain("expect(restoredDataManifestSha256).toBe(sourceDataManifestSha256)");
    expect(RESTORE_CHAIN_TEXTS.restore_run.finding)
      .toContain("belegt danach Schema, Zeilen, Audit-Kette und Datenmanifest");
  });

  // ------------------------------------------------------------------ //
  // Glied 2: die frische Datenbank                                      //
  // ------------------------------------------------------------------ //

  it("finds no component that creates a database, and names the one that would have to", async () => {
    const migration = await source(`${MIGRATIONS}/0020_project_database_provisioning.sql`);
    expect(migration).toContain(
      "CREATE ROLE qkern_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;",
    );

    // Im ganzen Produktquelltext steht kein CREATE DATABASE und kein createdb.
    // Zwei Dateien sind ausgenommen, und zwar mit Grund: Die Texte dieser
    // Seite und ihre Übersetzungen sagen den Satz „kein CREATE DATABASE"
    // selbst. Sie führen nichts aus; würde man sie mitlesen, schlüge der Fall
    // an seiner eigenen Behauptung fehl.
    const EXEMPT = new Set([TEXTS, "lib/i18n/console.ts"]);
    const offenders: string[] = [];
    for (const file of await productFiles()) {
      if (EXEMPT.has(file)) continue;
      const text = await code(file);
      if (/CREATE\s+DATABASE/i.test(text) || /\bcreatedb\b/.test(text)) offenders.push(file);
    }
    expect(offenders, "Jemand legt jetzt doch eine Datenbank an").toEqual([]);

    // Der Broker ist ein Client und kein Dienst: Er spricht nach draussen und
    // meldet die Unerreichbarkeit als genau den Code, den die Seite nennt.
    const adapter = await source("lib/server/provisioning/broker-adapter.ts");
    expect(adapter).toContain('ProjectDatabaseProvisioningAdapterError("PROVIDER_UNAVAILABLE")');
    expect(migration).toContain("'PROVIDER_UNAVAILABLE', 'PROVIDER_REJECTED', 'INVALID_BINDING',");
    expect(RESTORE_CHAIN_TEXTS.fresh_database.component)
      .toContain("SignedProjectProvisioningBrokerAdapter");
    expect(RESTORE_CHAIN_TEXTS.fresh_database.finding)
      .toContain("Migration 0020 erzeugt die Rolle qkern_provisioner mit NOCREATEDB und NOCREATEROLE");
  });

  // ------------------------------------------------------------------ //
  // Glied 3: die zweite Umgebung                                        //
  // ------------------------------------------------------------------ //

  it("finds exactly one place that inserts an environment, and no verb but GET over HTTP", async () => {
    const inserting: string[] = [];
    for (const file of await productFiles()) {
      if (/INSERT\s+INTO\s+project_environments/i.test(await code(file))) inserting.push(file);
    }
    expect(inserting).toEqual(["lib/server/tenancy-postgres.ts"]);
    expect(await source("lib/server/tenancy-postgres.ts"))
      .toContain('[organization.id, project.id, project.environment ?? "development", `pending:${project.id}`]');

    for (const route of [
      "app/api/v1/projects/route.ts",
      "app/api/v1/projects/[projectId]/environments/route.ts",
    ]) {
      const verbs = [...(await code(route)).matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)]
        .map((match) => match[1]);
      expect(verbs, route).toEqual(["GET"]);
    }
    expect(RESTORE_CHAIN_TEXTS.new_environment.finding)
      .toContain("Die Route über Projekte und die Route über Umgebungen kennen beide nur GET");
  });

  // ------------------------------------------------------------------ //
  // Glied 4: die Bindung                                                //
  // ------------------------------------------------------------------ //

  it("quotes the trigger that makes a provisioned reference immutable, word for word", async () => {
    const migration = await source(`${MIGRATIONS}/0005_migration_apply_queue.sql`);
    expect(migration).toContain("CREATE OR REPLACE FUNCTION qkern_reject_project_database_retarget()");
    expect(migration).toContain(
      "RAISE EXCEPTION 'a provisioned project database reference is immutable' USING ERRCODE = '55000';",
    );
    expect(migration).toContain("CREATE TRIGGER project_environments_database_ref_immutable");
    expect(migration).toContain("BEFORE UPDATE OF database_instance_ref ON project_environments");
    // Und die eine erlaubte Ersetzung haengt wirklich an der wartenden Marke.
    expect(migration).toContain("IF OLD.database_instance_ref !~* '^pending:' AND");
    expect(RESTORE_CHAIN_TEXTS.binding.finding)
      .toContain("Trigger project_environments_database_ref_immutable jede Änderung ab");
    expect(RESTORE_CHAIN_TEXTS.binding.finding)
      .toContain("a provisioned project database reference is immutable");
  });

  // ------------------------------------------------------------------ //
  // "Was heute wirklich geht"                                           //
  // ------------------------------------------------------------------ //

  it("describes the local shortcut exactly as the script behaves, and claims no operator path", async () => {
    const script = await source("scripts/dev-bind-project-database.mjs");
    expect(script).toContain('if (environment === "production") throw new ExpectedError("production wird lokal nie gebunden")');
    expect(script).toContain('const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);');
    expect(script).toContain("export function assertLocalUrl(url, { allowRemote })");
    // Es schreibt wirklich nur das eine UPDATE.
    expect(script).not.toMatch(/INSERT\s+INTO\s+project_database_bindings/i);
    expect(script).not.toMatch(/INSERT\s+INTO\s+project_database_provisioning_jobs/i);
    expect(script).toContain("UPDATE project_environments");
    expect(RESTORE_TODAY_TEXTS.local_shortcut)
      .toContain("weder einen Provisionierungsauftrag noch eine Zeile in project_database_bindings");

    // Der Notbehelf, nach dem man fragen wuerde, wird ausdruecklich verneint.
    expect(RESTORE_TODAY_TEXTS.not_a_path)
      .toContain("ist heute kein gangbarer Weg");
    expect(RESTORE_TODAY_TEXTS.not_a_path)
      .toContain("Diese Seite behauptet darum auch keinen Notbehelf");
    const view = await code(VIEW);
    for (const key of ["local_shortcut", "manual_restore", "not_a_path"] as const) {
      expect(view, key).toContain("RESTORE_TODAY_TEXTS");
    }
    // Und das Modul der Texte bleibt rein: keine Datenbank, kein React.
    const texts = await code(TEXTS);
    expect(texts).not.toContain("fetch(");
    expect(texts).not.toContain("react");
    expect(texts).not.toContain("pg");
  });
});
