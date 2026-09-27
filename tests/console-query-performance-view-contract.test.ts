import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  DURATION_UNITS,
  duration,
  durationFromMilliseconds,
  QUERY_PERFORMANCE_HONESTY,
  QUERY_PERFORMANCE_MISSING_EXTENSION,
  QUERY_PERFORMANCE_NO_TEXT,
  QUERY_PERFORMANCE_SHARE,
  queryPerformanceTexts,
  rowsPerCall,
  timeShare,
} from "@/lib/console/query-performance-texts";

/**
 * Berichte -> Abfrage-Leistung (2.67) liest nur, und sie traegt keinen
 * Abfragetext. Der Vertrag prueft das an der Quelle: keine Spalte `query` in
 * der SQL, kein Schreibverb im Pfad, der Satz zur fehlenden Erweiterung
 * woertlich da, und jeder Text in allen vier Sprachen.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/query-performance-view.tsx";
const SOURCE = "components/console/query-performance-source.ts";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/database/statements/route.ts";
const SERVICE = "lib/server/data-plane/service.ts";

describe("console query performance view contract", () => {
  it("makes the page real and takes its placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("obs-query-performance");
    expect(isPlaceholder("obs-query-performance")).toBe(false);
    expect("obs-query-performance" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "obs-query-performance": return <QueryPerformanceView');
    const navigation = await source("components/console/navigation.ts");
    expect(navigation).not.toContain("Die teuersten Abfragen nach Zeit und Häufigkeit (pg_stat_statements).");
    expect(navigation).toContain('{ id: "obs-query-performance", label: "Abfrage-Leistung" }');
  });

  it("reads one route and writes nothing anywhere", async () => {
    const view = await source(VIEW);
    const hook = await source(SOURCE);
    const route = await source(ROUTE);
    for (const file of [view, hook, route]) {
      expect(file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    // Die Ansicht holt ihre Zahlen aus dem Hook, nicht selbst.
    expect(view).toContain("useQueryPerformance");
    expect(view).not.toContain("fetch(");
    expect(hook).toContain("/database/statements");
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain('"Cache-Control": "private, no-store"');
    // Keine zweite Lesestelle: Die Route ruft dieselbe Methode wie der
    // Leistungsberater, sie baut keine eigene Abfrage.
    expect(route).toContain("inspectStatements");
    expect(route).not.toContain("pg_stat_statements AS");
    // Nichts wird zurueckgesetzt und nichts beendet, auch nicht hinter einem Schalter.
    const everywhere = [view, hook, route].join("\n").toLowerCase();
    for (const word of ["pg_stat_statements_reset", "pg_terminate_backend", "pg_cancel_backend"]) {
      expect(everywhere, word).not.toContain(word);
    }
  });

  it("never selects the query text and stays inside its own database", async () => {
    const service = await source(SERVICE);
    // Nur der SQL-Text, ohne den Kommentar darueber: Der erklaert gerade,
    // welche Spalte ausdruecklich nicht gelesen wird.
    const marker = "const STATEMENT_DIGESTS_SQL = `";
    const start = service.indexOf(marker) + marker.length;
    const sql = service.slice(start, service.indexOf("`", start));
    expect(sql).toContain("pg_stat_statements");
    expect(sql).toContain("stat.queryid::text AS statement_id");
    // Die fuenf Felder der Ansicht, und keines davon ist ein Text.
    for (const column of ["stat.calls", "total_exec_time", "mean_exec_time", "stat.rows"]) {
      expect(sql, column).toContain(column);
    }
    // Die Mandantengrenze: die eigene Datenbank, nicht der Cluster.
    expect(sql).toContain("stat.dbid = (SELECT database.oid FROM pg_catalog.pg_database AS database");
    expect(sql).toContain("current_database()");
    expect(sql).toContain("stat.queryid IS NOT NULL");
    // Die Spalte `query` wird nicht ausgewaehlt, nicht gefiltert, nicht sortiert.
    // `queryid` ja, `query` nein: Das Wort kommt in der Abfrage nur als
    // Kennung vor, nie als Spalte mit Text.
    expect(sql).not.toMatch(/(?<![a-z_])query(?!id)/);
    // Und die Entscheidung dagegen steht ausgeschrieben, nicht stillschweigend.
    const explained = service.slice(service.indexOf("Die Entscheidung gegen den Abfragetext"), service.indexOf(marker));
    expect(explained).toContain("Utility-Befehl");
    expect(explained).toContain("SQL-Editor");
    // Kein Feld der Ansicht koennte einen Text tragen.
    const hook = await source(SOURCE);
    const digest = hook.slice(hook.indexOf("export type StatementDigest = {"), hook.indexOf("export type Statements = {"));
    // Genau ein Textfeld, und das ist die Kennung. Ein zweites waere die
    // Stelle, an der ein Abfragetext doch noch hineinkaeme.
    expect([...digest.matchAll(/: string;/g)]).toHaveLength(1);
    expect(digest).toContain("id: string;");
    for (const field of ["calls: number;", "totalTimeMs: number;", "meanTimeUs: number;", "rows: number;"]) {
      expect(digest, field).toContain(field);
    }
  });

  it("says what it shows, what it cannot cover and what was cut off", async () => {
    const view = await source(VIEW);
    for (const sentence of [QUERY_PERFORMANCE_HONESTY, QUERY_PERFORMANCE_NO_TEXT, QUERY_PERFORMANCE_SHARE, QUERY_PERFORMANCE_MISSING_EXTENSION]) {
      expect(sentence).toMatch(/\S/);
    }
    for (const name of ["QUERY_PERFORMANCE_HONESTY", "QUERY_PERFORMANCE_NO_TEXT", "QUERY_PERFORMANCE_SHARE", "QUERY_PERFORMANCE_MISSING_EXTENSION"]) {
      expect(view, name).toContain(name);
    }
    // Die fehlende Erweiterung ist ein eigener Fall und nicht dieselbe Meldung
    // wie eine leere Liste.
    expect(QUERY_PERFORMANCE_MISSING_EXTENSION).toContain("nicht erreichbar");
    expect(view).toContain("{!installed &&");
    expect(view).toContain("{installed && digests.length === 0 &&");
    expect(view).toContain("Die Antwort wurde an der Zeilengrenze abgeschnitten");
    // Sechs Spalten je Statement.
    for (const column of ["Kennung", "Aufrufe", "Gesamtzeit", "Mittelwert", "Zeilen", "Anteil"]) {
      expect(view, column).toContain(`t("${column}")`);
    }
    // Zahlen laufen ueber die Darstellung der Console, nicht ueber Intl.
    for (const helper of ["formatNumber", "formatDecimal", "formatPercent"]) {
      expect(view, helper).toContain(helper);
    }
    for (const forbidden of ["toLocaleString", "toFixed", "Intl."]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
    // Neu laden springt nicht in der Breite.
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
    for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
      expect(await source(SOURCE), state).toContain(`"${state}"`);
    }
  });

  it("computes the share, the mean and the rows per call without inventing a number", () => {
    // Der Nenner ist die Summe der gezeigten Zeilen; ohne Zeit gibt es keinen Anteil.
    expect(timeShare(25, 100)).toBe(0.25);
    expect(timeShare(0, 100)).toBe(0);
    expect(timeShare(10, 0)).toBeNull();
    expect(timeShare(-1, 100)).toBeNull();
    expect(rowsPerCall(120, 12)).toBe(10);
    expect(rowsPerCall(1, 0)).toBeNull();
    // Mikrosekunden bleiben ganzzahlig, ab Millisekunden bleibt eine Stelle stehen.
    expect(duration(999)).toEqual({ value: 999, unit: "Mikrosekunden", fractionDigits: 0 });
    expect(duration(1500)).toEqual({ value: 1.5, unit: "Millisekunden", fractionDigits: 1 });
    expect(duration(2_500_000)).toEqual({ value: 2.5, unit: "Sekunden", fractionDigits: 1 });
    expect(duration(90_000_000)).toEqual({ value: 1.5, unit: "Minuten", fractionDigits: 1 });
    expect(duration(-5)).toEqual({ value: 0, unit: "Mikrosekunden", fractionDigits: 0 });
    expect(durationFromMilliseconds(90_000)).toEqual({ value: 1.5, unit: "Minuten", fractionDigits: 1 });
  });

  it("translates every unit and every sentence into en, fr and it", async () => {
    for (const unit of DURATION_UNITS) {
      for (const locale of ["en", "fr", "it"] as const) {
        expect(CONSOLE_TRANSLATIONS[locale][unit], `${locale}: ${unit}`).toMatch(/\S/);
      }
    }
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = queryPerformanceTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const view = await source(VIEW);
    const keys = [...view.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(30);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
