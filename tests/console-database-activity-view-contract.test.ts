import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  CONNECTION_STATES,
  CONNECTION_STATE_TEXTS,
  CONNECTIONS_REPORT_HONESTY,
  DATABASE_REPORT_HONESTY,
  databaseActivityTexts,
} from "@/lib/console/database-activity-texts";

/**
 * Datenbank und Verbindungen (2.46) lesen nur, und sie tragen keinen
 * Abfragetext. Der Vertrag prueft genau das an der Quelle: kein Schreibverb,
 * kein `terminate`, kein `cancel`, keine Spalte `query` in der SQL, und jeder
 * Text in allen vier Sprachen.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const DATABASE_VIEW = "components/console/database-report-view.tsx";
const CONNECTIONS_VIEW = "components/console/connections-report-view.tsx";
const SOURCE = "components/console/database-activity-source.ts";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/database/activity/route.ts";
const SERVICE = "lib/server/data-plane/service.ts";

describe("console database and connections view contract", () => {
  it("makes both report pages real and takes their placeholder claims off the navigation", async () => {
    for (const id of ["obs-database", "obs-connections"] as const) {
      expect(REAL_VIEWS).toContain(id);
      expect(isPlaceholder(id as never)).toBe(false);
      expect(id in PLACEHOLDERS).toBe(false);
    }
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "obs-database": return <DatabaseReportView');
    expect(app).toContain('case "obs-connections": return <ConnectionsReportView');
    const navigation = await source("components/console/navigation.ts");
    for (const claim of ["Auslastung, Verbindungen, Cache-Trefferquote.", "Offene Verbindungen je Rolle und Quelle."]) {
      expect(navigation, claim).not.toContain(claim);
    }
  });

  it("reads one shared source and writes nothing anywhere", async () => {
    const files = await Promise.all([source(DATABASE_VIEW), source(CONNECTIONS_VIEW), source(SOURCE), source(ROUTE)]);
    for (const file of files) {
      expect(file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    // Beide Ansichten holen ihre Zahlen aus demselben Hook, nicht jede fuer sich.
    for (const view of files.slice(0, 2)) {
      expect(view).toContain("useDatabaseActivity");
      expect(view).not.toContain("fetch(");
    }
    expect(files[2]).toContain("/database/activity");
    expect(await source(ROUTE)).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(files[3]).toContain('"Cache-Control": "private, no-store"');
  });

  it("never terminates, never cancels and never selects a query text", async () => {
    const service = await source(SERVICE);
    const activitySql = service.slice(service.indexOf("const DATABASE_ACTIVITY_SQL"), service.indexOf("const POLICIES_SQL"));
    expect(activitySql).toContain("FROM pg_catalog.pg_stat_activity");
    expect(activitySql).toContain("FROM pg_catalog.pg_stat_database");
    // Die eigene Datenbank, nicht der Cluster.
    expect(activitySql).toContain("activity.datname = current_database()");
    expect(activitySql).toContain("stat.datname = current_database()");
    // Gezaehlt wird, nicht aufgelistet.
    expect(activitySql).toContain("count(*)");
    expect(activitySql).toContain("GROUP BY");
    // Nur die beiden SQL-Texte, ohne die Kommentare darueber: Die erklaeren
    // gerade, welche Spalten ausdruecklich nicht gelesen werden.
    const statement = (name: string) => {
      const start = service.indexOf(`const ${name} = \``) + `const ${name} = \``.length;
      return service.slice(start, service.indexOf("`", start));
    };
    const sqlOnly = `${statement("DATABASE_ACTIVITY_SQL")}\n${statement("CONNECTION_GROUPS_SQL")}`;
    expect(sqlOnly).toContain("pg_stat_activity");
    for (const column of ["activity.query", "backend_xmin", "client_addr", "client_hostname", "application_name", "activity.pid"]) {
      expect(sqlOnly, column).not.toContain(column);
    }
    // Nirgends im ganzen Pfad, auch nicht hinter einem Schalter.
    const everywhere = (await Promise.all([source(SERVICE), source(ROUTE), source(SOURCE), source(DATABASE_VIEW), source(CONNECTIONS_VIEW)])).join("\n").toLowerCase();
    for (const word of ["pg_terminate_backend", "pg_cancel_backend", "terminate", "cancel"]) {
      expect(everywhere, word).not.toContain(word);
    }
  });

  it("says what the numbers mean, what they cannot cover and what was cut off", async () => {
    const database = await source(DATABASE_VIEW);
    const connections = await source(CONNECTIONS_VIEW);
    expect(DATABASE_REPORT_HONESTY).toBe("Die Zahlen gelten seit dem letzten Zuruecksetzen der Statistik, nicht seit dem Start der Datenbank.");
    expect(CONNECTIONS_REPORT_HONESTY).toBe("Gezaehlt wird, was diese Rolle sehen darf. Einzelne Sitzungen und ihre Abfragen zeigt QKERN nicht.");
    expect(database).toContain("DATABASE_REPORT_HONESTY");
    expect(connections).toContain("CONNECTIONS_REPORT_HONESTY");
    // Leerer Zustand und Abschneiden stehen da, statt still zu fehlen.
    expect(connections).toContain("Keine sichtbare Verbindung.");
    expect(connections).toContain("Die Antwort wurde an der Zeilengrenze abgeschnitten");
    expect(database).toContain("Solange kein Block gelesen wurde, gibt es keine Trefferquote.");
    // Die Trefferquote als Anteil, die Backends gegen max_connections.
    expect(database).toContain("cacheHitRatio");
    expect(database).toContain("connectionLoad");
    expect(database).toContain("max_connections");
    // Vier Spalten je Gruppe: Rolle, Zustand, Anzahl, aelteste Sitzung.
    for (const column of ["Rolle", "Zustand", "Anzahl", "Älteste Sitzung"]) {
      expect(connections, column).toContain(`t("${column}")`);
    }
    // Neu laden springt nicht in der Breite.
    for (const view of [database, connections]) {
      expect(view).toContain("StableLabel");
      expect(view).toContain('tAll("Lädt…", "Neu laden")');
    }
    for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
      expect(await source(SOURCE), state).toContain(`"${state}"`);
    }
  });

  it("translates every state, every unit and every sentence into en, fr and it", async () => {
    for (const state of CONNECTION_STATES) {
      const text = CONNECTION_STATE_TEXTS[state];
      for (const german of [text.label, text.explains]) {
        expect(german, state).toMatch(/\S/);
        for (const locale of ["en", "fr", "it"] as const) {
          expect(CONSOLE_TRANSLATIONS[locale][german], `${locale}: ${state}`).toMatch(/\S/);
        }
      }
    }
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = databaseActivityTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const keys = (await Promise.all([source(DATABASE_VIEW), source(CONNECTIONS_VIEW)]))
      .flatMap((file) => [...file.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]) as string));
    expect(keys.length).toBeGreaterThan(40);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
