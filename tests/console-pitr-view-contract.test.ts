import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, NAV_ENTRIES, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  POINT_IN_TIME_HONESTY,
  POINT_IN_TIME_STATE_TEXTS,
  pointInTimeTexts,
} from "@/lib/console/point-in-time-texts";

/**
 * Datenbank -> Point-in-time Recovery (2.53) liest nur, und sie darf nichts
 * hinaustragen, womit man sich irgendwo anmelden koennte. Der Vertrag prueft
 * das an der Quelle: kein Schreibverb, keine Verbindungszeile, kein
 * Geheimnis, kein Ort eines Archivs -- und den einen Satz, der beim leeren
 * Fall zuerst steht.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/pitr-view.tsx";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/database/backups/point-in-time/route.ts";
const LOGIC = "lib/server/backup/point-in-time.ts";
const TEXTS = "lib/console/point-in-time-texts.ts";

describe("console point-in-time recovery view contract", () => {
  it("makes the page real and takes its placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("db-backups-pitr");
    expect(isPlaceholder("db-backups-pitr" as never)).toBe(false);
    expect("db-backups-pitr" in PLACEHOLDERS).toBe(false);
    expect(NAV_ENTRIES.map((entry) => entry.id)).toContain("db-backups-pitr");
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "db-backups-pitr": return <PitrView');
    const navigation = await source("components/console/navigation.ts");
    expect(navigation).not.toContain("Braucht ein WAL-Archiv ausserhalb des Wegwerf-Stacks.");
  });

  it("only reads, and never writes anywhere on the path", async () => {
    const files = await Promise.all([source(VIEW), source(ROUTE), source(LOGIC), source(TEXTS)]);
    for (const file of files) {
      expect(file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    expect(files[1]).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(files[1]).toContain('"Cache-Control": "private, no-store"');
    // Kein Parameter, also auch kein still ignorierter.
    expect(files[1]).toContain("request.nextUrl.searchParams.keys()");
    expect(files[1]).toContain('status: 400');
    // Dieselbe Tuer wie die Nachbarrouten der Datenbank.
    expect(files[1]).toContain("generatedDataContext(request, scope, false, keys, projectAuth)");
    expect(files[1]).toContain("dataPlaneRouteError");
  });

  it("carries no credential, no connection string and no archive location", async () => {
    const everywhere = (await Promise.all([source(VIEW), source(ROUTE), source(LOGIC), source(TEXTS)]))
      .join("\n").toLowerCase();
    for (const word of [
      "password", "passwort", "secret", "token", "credential", "postgresql://", "postgres://",
      "s3://", "sslmode=", "connectionstring", "connection_string", "access_key", "accesskey",
    ]) {
      expect(everywhere, word).not.toContain(word);
    }
    // "bucket" steht nicht in der Liste: in der Ansicht ist es der Name einer
    // Layout-Klasse der Console, und in den Kommentaren der Route steht es in
    // dem Satz, der seine Abwesenheit zusagt. Die Zusage traegt darum die
    // Pruefung der gelesenen Variablennamen unten, nicht ein Wortverbot.
    // Die gelesenen Variablen sind auf drei Namen begrenzt, und keiner davon
    // traegt einen Ort. Ein vierter waere genau der Weg nach draussen.
    const logic = await source(LOGIC);
    const names = [...logic.matchAll(/QKERN_BACKUP_WAL_ARCHIVE_[A-Z_]+/g)].map((match) => match[0]);
    expect(new Set(names)).toEqual(new Set([
      "QKERN_BACKUP_WAL_ARCHIVE_DECLARED",
      "QKERN_BACKUP_WAL_ARCHIVE_RETENTION_DAYS",
      "QKERN_BACKUP_WAL_ARCHIVE_SINCE",
    ]));
  });

  it("says first and plainly when there is no archive, and never invents a newest point", async () => {
    expect(POINT_IN_TIME_STATE_TEXTS.no_archive.label)
      .toBe("Kein Archiv, keine Wiederherstellung auf einen Zeitpunkt");
    expect(POINT_IN_TIME_STATE_TEXTS.no_archive.explains).toContain("keinen Zeitpunkt");
    expect(POINT_IN_TIME_HONESTY).toContain("QKERN verwaltet kein WAL-Archiv.");
    const view = await source(VIEW);
    // Der Zustand steht in der ersten Karte, vor Fenster, Drill und Schritten.
    expect(view.indexOf("verdict.label")).toBeLessThan(view.indexOf("FENSTER"));
    expect(view.indexOf("POINT_IN_TIME_HONESTY")).toBeLessThan(view.indexOf("LETZTER DRILL"));
    // Der neueste Punkt ist im Typ null und in der Ansicht ein Satz, keine Zahl.
    expect(await source(LOGIC)).toContain("latestRestorablePoint: null;");
    expect(view).toContain('<strong>{t("nicht bekannt")}</strong><small>{t("Neuester Punkt")}</small>');
    // Neu laden springt nicht in der Breite.
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
  });

  it("translates every state, every proof and every step into en, fr and it", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = pointInTimeTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
