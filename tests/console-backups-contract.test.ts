import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  BACKUPS_FINDING_TEXTS,
  BACKUPS_HONESTY,
  BACKUPS_OPERATOR_STEPS,
  BACKUPS_OPERATOR_STEP_TEXTS,
  BACKUPS_STANDPOINTS,
  backupsStandpoint,
} from "@/lib/console/backups-texts";
import {
  BACKUP_RESTORE_EVIDENCE_POLICY,
} from "@/lib/server/backup/restore-evidence";
import {
  POINT_IN_TIME_ARCHIVE_ENV,
  pointInTimeWindow,
  readWalArchiveDeclaration,
} from "@/lib/server/backup/point-in-time";

/**
 * Datenbank → Backups (2.90), am Quelltext geprueft.
 *
 * Es gibt hier bewusst keinen Fall gegen die echte Datenbank, und der Grund
 * ist selbst der Befund dieses Schnitts: Die Seite liest nichts Neues. Sie
 * hatte einen abgeschalteten Knopf „Backup erstellen“, und nachgesehen gibt
 * es nichts, was er haette aufrufen koennen. Damit bleibt ihr als Stoff nur,
 * was die Route `/database/backups/point-in-time` ohnehin schon liefert, und
 * deren Lesungen belegen die Faelle in `database-point-in-time-route` und
 * `backup-point-in-time`.
 *
 * Also prueft dieser Vertrag das Schwierigere: dass die Saetze der Seite
 * **stimmen**. Jede Aussage ueber den fehlenden Produktweg, ueber
 * `scripts/backup-certification.mjs`, ueber den Stack `test:backup:docker`,
 * ueber den Bereich der Evidenz, ueber die Migrationen und ueber die drei
 * Umgebungsvariablen wird hier an der Stelle nachgelesen, ueber die sie
 * spricht. Wer morgen einen Produktweg zum Basisbackup baut, wer eine
 * Backup-Tabelle anlegt oder wer dem Stack das WAL-Archiv nimmt, laesst hier
 * einen Fall scheitern, statt die Seite stillschweigend zur Luege zu machen.
 */
const VIEW = "components/console/backups-view.tsx";
const TEXTS = "lib/console/backups-texts.ts";
const DRILL_TEST = "tests/backup-restore-drill.integration.test.ts";
const DRILL_STACK = "docker-compose.backup-certification.yml";
const DRILL_SCRIPT = "scripts/backup-certification.mjs";
const MIGRATIONS = "db/migrations";
const BACKUP_ROUTES = "app/api/v1/projects/[projectId]/environments/[environment]/database/backups";

async function source(file: string): Promise<string> {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

/**
 * Dieselbe Datei ohne ihre Kommentare. Der Kopf der Ansicht und der Kopf des
 * Textmoduls nennen die Werkzeuge, die im Produkt nicht vorkommen duerfen;
 * eine Zusicherung "kommt nicht vor" muss diese Erklaerung meinen duerfen,
 * ohne an ihr zu scheitern.
 */
async function code(file: string): Promise<string> {
  return (await source(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Alle Quelldateien des Produkts, ohne Tests, Migrationen und Dokumentation. */
async function productFiles(): Promise<string[]> {
  const roots = ["lib", "app", "workers", "components", "cli", "sdk", "mcp"];
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

describe("console backups contract", () => {
  // ------------------------------------------------------------------ //
  // Die Seite selbst                                                     //
  // ------------------------------------------------------------------ //

  it("keeps the view real and takes the old placeholder promise out of every language", async () => {
    expect(REAL_VIEWS).toContain("backups");
    expect(isPlaceholder("backups" as never)).toBe(false);
    expect("backups" in PLACEHOLDERS).toBe(false);

    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "backups": return <BackupsView projectId={props.project.id} environment={props.environment}/>;');
    expect(app).toContain('import { BackupsView } from "@/components/console/backups-view";');

    // Die alte Inline-Ansicht mit ihrem Knopf steht nirgends mehr.
    for (const gone of [
      "Backup erstellen",
      "Backups sind noch nicht verbunden",
      "Backups, Point-in-time-Recovery und Restore-Drills brauchen ein WAL-Archiv ausserhalb des Wegwerf-Stacks. Bis dahin zeigt diese Ansicht keine erfundenen Wiederherstellungspunkte.",
    ]) {
      expect(app, gone).not.toContain(gone);
      for (const locale of ["en", "fr", "it"] as const) {
        expect(CONSOLE_TRANSLATIONS[locale][gone], `${locale}: ${gone}`).toBeUndefined();
      }
    }
  });

  it("only reads, carries no button that does nothing, and formats through console-display", async () => {
    const view = await code(VIEW);
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    // Der einzige Knopf ausser "Noch einmal" laedt neu, und er tut es wirklich.
    expect(view).toContain("onClick={() => void load()}");
    // Genau das, was diesen Schnitt ausgeloest hat, darf nicht wiederkommen.
    expect(view).not.toContain("disabled");
    expect(view).not.toContain("is-placeholder");
    expect(view).toContain("AbortController");
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
    for (const forbidden of ["Intl.", "toLocaleString", "toLocaleDateString", "toFixed", ".slice(0, 10)"]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
    expect(view).toContain('from "@/components/console/console-display"');
    // Und das Modul der Texte bleibt rein.
    const texts = await code(TEXTS);
    expect(texts).not.toContain("fetch(");
    expect(texts).not.toContain("react");
    expect(texts).not.toContain("node:");
  });

  it("introduces no route of its own and asks the point-in-time route that already exists", async () => {
    const view = await code(VIEW);
    expect(view).toContain("/database/backups/point-in-time");
    expect(view.match(/fetch\(/g) ?? []).toHaveLength(1);
    const entries = (await readdir(path.resolve(process.cwd(), BACKUP_ROUTES))).sort();
    expect(entries).toEqual(["point-in-time"]);
  });

  it("derives the standpoint from the declaration and the drill, independently of each other", () => {
    const drill = {
      verifiedAt: "2026-07-26T10:40:00.000Z",
      backupSnapshotAt: "2026-07-26T10:00:00.000Z",
      recoveryPointLagSeconds: 300,
      restoreDurationSeconds: 1_200,
      proves: [],
    } as const;
    const declared = { declared: true, retentionDays: 14, archivingSince: null, invalid: [] } as const;
    const nothing = { declared: false, retentionDays: null, archivingSince: null, invalid: [] } as const;

    expect(backupsStandpoint({ archive: nothing, lastDrill: null })).toBe("nothing");
    // Ohne erklaertes Archiv bleibt es "nothing", auch wenn ein Drill vorliegt:
    // Der Drill belegt ein Verfahren und kein Archiv dieser Umgebung.
    expect(backupsStandpoint({ archive: nothing, lastDrill: drill })).toBe("nothing");
    expect(backupsStandpoint({ archive: declared, lastDrill: null })).toBe("declared");
    expect(backupsStandpoint({ archive: declared, lastDrill: drill })).toBe("declared_and_drilled");
    expect(BACKUPS_STANDPOINTS).toEqual(["nothing", "declared", "declared_and_drilled"]);
  });

  // ------------------------------------------------------------------ //
  // Der Satz, der den Knopf gekostet hat: kein Produktweg                //
  // ------------------------------------------------------------------ //

  it("finds no place in the product that pulls a backup, and exactly one in the tree that does", async () => {
    const TOOLS = /\bpg_basebackup\b|\bpg_dumpall\b|\bpg_dump\b|\bpg_receivewal\b|\bpgbackrest\b|\bwal-g\b|\bbarman\b/;
    // Zwei Dateien sind ausgenommen, und zwar mit Grund: Die Texte dieser
    // Seite und ihre Uebersetzungen nennen die Werkzeuge selbst, um zu sagen,
    // dass niemand sie ruft. Wuerde man sie mitlesen, schluege der Fall an
    // seiner eigenen Behauptung fehl.
    const EXEMPT = new Set([TEXTS, "lib/i18n/console.ts"]);
    const files = await productFiles();
    // Ohne gelesene Dateien waere der Fall wertlos.
    expect(files.length).toBeGreaterThan(200);
    const offenders: string[] = [];
    for (const file of files) {
      if (EXEMPT.has(file)) continue;
      if (TOOLS.test(await code(file))) offenders.push(file);
    }
    expect(offenders, "Jemand zieht jetzt doch ein Backup aus dem Produkt heraus").toEqual([]);

    // Und der Ordner, in dem man es vermuten wuerde, haelt genau drei Dateien,
    // die alle drei lesen.
    const backupLib = (await readdir(path.resolve(process.cwd(), "lib/server/backup"))).sort();
    expect(backupLib).toEqual(["point-in-time.ts", "restore-evidence-runtime.ts", "restore-evidence.ts"]);
    expect(BACKUPS_FINDING_TEXTS.product_path.verdict).toBe("missing");
    expect(BACKUPS_FINDING_TEXTS.product_path.explains)
      .toContain("Unter lib/server gibt es den Ordner backup, und er enthält drei Dateien");

    // Die eine Stelle, die es wirklich tut, liegt unter tests/.
    expect(await source(DRILL_TEST)).toContain('execFileSync("pg_basebackup"');
  });

  it("finds no write verb under the backup routes, so a button had nothing to hook onto", async () => {
    const files: string[] = [];
    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(path.resolve(process.cwd(), directory), { withFileTypes: true })) {
        const next = `${directory}/${entry.name}`;
        if (entry.isDirectory()) { await walk(next); continue; }
        if (entry.name === "route.ts") files.push(next);
      }
    }
    await walk(BACKUP_ROUTES);
    expect(files).toEqual([`${BACKUP_ROUTES}/point-in-time/route.ts`]);
    const verbs = [...(await code(files[0])).matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)]
      .map((match) => match[1]);
    expect(verbs).toEqual(["GET"]);
    expect(BACKUPS_FINDING_TEXTS.no_order_route.explains)
      .toContain("steht genau ein Pfad, point-in-time, und er kennt nur GET");
  });

  it("finds no table anywhere in the migrations that would hold a backup", async () => {
    const created: Array<{ migration: string; table: string }> = [];
    for (const { name, sql } of await migrations()) {
      for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
        created.push({ migration: name, table: match[1].toLowerCase() });
      }
    }
    expect(created.length).toBeGreaterThan(50);
    const backupish = created.filter(({ table }) => /backup|restore|snapshot|recovery_point|wal_/.test(table));
    expect(backupish, "Eine Migration legt jetzt doch eine Backup-Tabelle an").toEqual([]);
    expect(BACKUPS_FINDING_TEXTS.no_catalogue.explains)
      .toContain("Keine Migration legt eine Tabelle für Backups, Sicherungspunkte oder Wiederherstellungsläufe an");
    expect(BACKUPS_HONESTY).toContain("QKERN führt über seine Backups keinen Katalog");
  });

  // ------------------------------------------------------------------ //
  // Der Pruefweg: was `test:backup:docker` wirklich tut                   //
  // ------------------------------------------------------------------ //

  it("describes the certification script as it really is: a driver of containers, not a path to a database", async () => {
    const script = await source(DRILL_SCRIPT);
    const stack = await source(DRILL_STACK);
    const manifest = JSON.parse(await source("package.json")) as { scripts: Record<string, string> };

    expect(manifest.scripts["test:backup:docker"]).toBe("node scripts/backup-certification.mjs");
    expect(script).toContain('"docker-compose.backup-certification.yml"');
    expect(stack).toContain("npx vitest run tests/backup-restore-drill.integration.test.ts");
    expect(script).toContain('mkdirSync("docs/evidence/backup-restore", { recursive: true })');
    expect(script).toContain('writeFileSync("docs/evidence/backup-restore/drill.evidence.json"');

    // Es spricht selbst mit keiner Datenbank: kein pg, keine Verbindungszeile,
    // und alles, was es startet, ist `docker`.
    const body = await code(DRILL_SCRIPT);
    expect(body).not.toMatch(/require\(["']pg["']\)|from ["']pg["']/);
    expect(body).not.toMatch(/postgres:\/\/|postgresql:\/\//);
    const spawned = [...body.matchAll(/spawnSync\(\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(spawned.length).toBeGreaterThan(0);
    expect([...new Set(spawned)]).toEqual(["docker"]);

    expect(BACKUPS_FINDING_TEXTS.test_path.verdict).toBe("exists");
    expect(BACKUPS_FINDING_TEXTS.test_path.explains)
      .toContain("npm run test:backup:docker fährt scripts/backup-certification.mjs");
    expect(BACKUPS_FINDING_TEXTS.test_path.explains)
      .toContain("legt sie unter docs/evidence/backup-restore ab");
  });

  it("proves the drill secures the control plane, exactly as the page says", async () => {
    const stack = await source(DRILL_STACK);
    const drill = await source(DRILL_TEST);
    const evidence = await source("lib/server/backup/restore-evidence.ts");

    // Der Quellserver des Stacks traegt die Kontrollebene, und der Drill
    // fuellt deren Tabellen.
    expect(stack).toContain("POSTGRES_DB: qkern_control");
    expect(stack).toContain("QKERN_TEST_BACKUP_SOURCE_DB: qkern_control");
    for (const table of ["users", "organizations", "audit_logs"]) {
      expect(drill, table).toContain(`INSERT INTO ${table} (`);
    }
    // Der Verifier kennt genau einen Bereich, und die Evidenz traegt ihn.
    expect(evidence).toContain('const SCOPE = "control_plane" as const;');
    expect(evidence).toContain("scope: typeof SCOPE;");
    expect(drill).toContain('deployment: "production", scope: "control_plane"');

    expect(BACKUPS_FINDING_TEXTS.scope_is_control_plane.verdict).toBe("limit");
    expect(BACKUPS_FINDING_TEXTS.scope_is_control_plane.explains)
      .toContain("trägt die Datenbank qkern_control");
    expect(BACKUPS_FINDING_TEXTS.scope_is_control_plane.explains)
      .toContain("Die Evidenz trägt den Bereich control_plane");
  });

  // ------------------------------------------------------------------ //
  // Was ein Betreiber stattdessen tut, Schritt fuer Schritt              //
  // ------------------------------------------------------------------ //

  it("describes each operator step the way the stack and the drill really do it", async () => {
    const stack = await source(DRILL_STACK);
    const drill = await source(DRILL_TEST);

    // 1. Archivierung am Server.
    for (const setting of ["- wal_level=replica", "- archive_mode=on", "- archive_command=cp %p /wal-archive/%f"]) {
      expect(stack, setting).toContain(setting);
    }
    expect(BACKUPS_OPERATOR_STEP_TEXTS.enable_archiving.explains)
      .toContain("wal_level auf replica, archive_mode auf on und ein archive_command");

    // 2. Basisbackup als Tar, ohne WAL, ueber TLS.
    expect(drill).toContain('"-Ft", "-X", "none"');
    expect(drill).toContain("await expect(plain.connect()).rejects.toThrow()");
    expect(BACKUPS_OPERATOR_STEP_TEXTS.pull_base_backup.explains)
      .toContain("pg_basebackup als Tar und ohne WAL, über eine Verbindung mit TLS");

    // 3. Verschluesseln, Klartext loeschen; und der Verifier verlangt es.
    expect(drill).toContain('"enc", "-aes-256-cbc", "-pbkdf2", "-salt"');
    expect(drill).toContain('rmSync(path.join(baseDir, "base.tar"))');
    expect(BACKUPS_OPERATOR_STEP_TEXTS.encrypt_and_keep.explains)
      .toContain("verschlüsselt das Artefakt mit AES-256 und löscht danach die unverschlüsselte Datei");

    // 5. Der Drill als Beleg, und die Gueltigkeit der Evidenz.
    expect(drill).toContain("recovery_target_time = '${recoveryTargetTime}'");
    expect(drill).toContain("expect(await auditChainIntact(restored!)).toBe(true)");
    expect(drill).toContain("expect(restoredDataManifestSha256).toBe(sourceDataManifestSha256)");
    expect(BACKUP_RESTORE_EVIDENCE_POLICY.evidenceMaxAgeSeconds).toBe(7 * 24 * 60 * 60);
    expect(BACKUPS_OPERATOR_STEP_TEXTS.run_the_drill.explains).toContain("Die Evidenz ist sieben Tage gültig");

    // Und die Ansicht zeigt wirklich alle Schritte.
    const view = await code(VIEW);
    expect(view).toContain("BACKUPS_OPERATOR_STEPS");
    expect(BACKUPS_OPERATOR_STEPS).toEqual([
      "enable_archiving", "pull_base_backup", "encrypt_and_keep", "declare_to_qkern", "run_the_drill",
    ]);
  });

  it("proves the three declared variables are all there are, and that the latest point stays unknown", () => {
    // 4. Der Schritt "der Console sagen, dass es das Archiv gibt".
    expect(Object.keys(POINT_IN_TIME_ARCHIVE_ENV).sort()).toEqual([
      "archivingSince", "declared", "retentionDays",
    ]);
    expect(Object.values(POINT_IN_TIME_ARCHIVE_ENV).sort()).toEqual([
      "QKERN_BACKUP_WAL_ARCHIVE_DECLARED",
      "QKERN_BACKUP_WAL_ARCHIVE_RETENTION_DAYS",
      "QKERN_BACKUP_WAL_ARCHIVE_SINCE",
    ]);

    // Ein Ort, ein Bucket oder ein Geheimnis kaeme hier nicht durch: Die
    // Erklaerung liest genau die drei Namen, und nichts sonst.
    const declaration = readWalArchiveDeclaration({
      QKERN_BACKUP_WAL_ARCHIVE_DECLARED: "true",
      QKERN_BACKUP_WAL_ARCHIVE_RETENTION_DAYS: "14",
      QKERN_BACKUP_WAL_ARCHIVE_SINCE: "2026-09-01T00:00:00.000Z",
      QKERN_BACKUP_WAL_ARCHIVE_BUCKET: "s3://kein-feld-dafuer",
    });
    expect(declaration).toEqual({
      declared: true, retentionDays: 14, archivingSince: "2026-09-01T00:00:00.000Z", invalid: [],
    });

    // Der aelteste Punkt ist gerechnet, der neueste bleibt unbekannt.
    const window = pointInTimeWindow(declaration, new Date("2026-09-28T00:00:00.000Z"));
    expect(window.earliestRestorablePoint).toBe("2026-09-14T00:00:00.000Z");
    expect(window.earliestSource).toBe("retention");
    expect(window.latestRestorablePoint).toBeNull();
    expect(window.reason).toBe("archive_not_read");

    expect(BACKUPS_OPERATOR_STEP_TEXTS.declare_to_qkern.explains)
      .toContain("Es gibt keine Variable für den Ort des Archivs, keine für einen Bucket und keine für ein Geheimnis");
    expect(BACKUPS_OPERATOR_STEP_TEXTS.declare_to_qkern.explains)
      .toContain("den neuesten nennt es nicht");
  });
});
