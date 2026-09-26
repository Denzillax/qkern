import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  USAGE_SERIES_HONESTY,
  USAGE_SERIES_METRIC_IDS,
  USAGE_SERIES_METRIC_TEXTS,
  USAGE_SERIES_VIEWS,
  usageSeriesTexts,
} from "@/lib/console/usage-series-texts";

/**
 * Die Zeitreihen der Nutzung (2.45) lesen nur. Eine Ansicht bedient drei
 * Seiten, die neue Route exportiert nur GET, das Bild ist nie die einzige
 * Quelle, jede Seite sagt selbst, was sie nicht zeigen kann, und jeder Text
 * spricht alle vier Sprachen: Deutsch als Schluessel, dazu en, fr und it.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/usage-series-view.tsx";
const CHART = "lib/console/usage-series-chart.ts";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/usage/series/route.ts";

describe("console usage series view contract", () => {
  it("makes all three report pages real and takes their placeholder claims off the navigation", async () => {
    for (const id of ["obs-api", "obs-storage", "obs-functions"] as const) {
      expect(REAL_VIEWS).toContain(id);
      expect(isPlaceholder(id as never)).toBe(false);
      expect(id in PLACEHOLDERS).toBe(false);
    }
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "obs-api": return <UsageSeriesView key="obs-api" view="api"');
    expect(app).toContain('case "obs-storage": return <UsageSeriesView key="obs-storage" view="storage"');
    expect(app).toContain('case "obs-functions": return <UsageSeriesView key="obs-functions" view="functions"');
    // Die alten Versprechen stehen nirgends mehr: keine Antwortzeiten, keine
    // Belegung, kein "Verlauf fehlt".
    const navigation = await source("components/console/navigation.ts");
    for (const claim of [
      "Anfragen, Fehler und Antwortzeiten der Data API",
      "Belegung und Zugriffe",
      "Aufrufe und Fehler. Der Zähler meldet",
    ]) {
      expect(navigation, claim).not.toContain(claim);
    }
  });

  it("only reads, from the one series route and nowhere else", async () => {
    const view = await source(VIEW);
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    expect(view).toContain("/usage/series");
    for (const word of ["setquota", "delete(", "record("]) {
      expect(view.toLowerCase(), word).not.toContain(word);
    }
    const route = await source(ROUTE);
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain("usageNoStore(");
    expect(await source("lib/server/usage/http.ts")).toContain('"Cache-Control": "private, no-store"');
    // Jeder fremde Query-Parameter ist ein 400; das Fenster steht im Dienst.
    expect(route).toContain("searchParams");
  });

  it("aggregates in the database and never loads the events into JavaScript", async () => {
    const repository = await source("lib/server/usage/postgres-repository.ts");
    const series = repository.slice(repository.indexOf("  readSeries("), repository.indexOf("  setPolicy("));
    expect(series).toContain("date_trunc");
    expect(series).toContain("GROUP BY");
    expect(series).toContain("ORDER BY");
    expect(series).toContain("LIMIT $10");
    // Ohne die Umrechnung schnitte `date_trunc` in der Zeitzone der Sitzung.
    expect(series).toContain("AT TIME ZONE 'UTC'");
    // Jeder Wert ist ein Parameter; nichts wird in die Abfrage geschrieben.
    expect(series).not.toMatch(/\$\{/);
  });

  it("draws from a pure layout function that knows no colour", async () => {
    const chart = await source(CHART);
    expect(chart).not.toContain("react");
    expect(chart).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(chart).not.toContain("currentColor");
    expect(chart).not.toContain("var(--");
    // Die Farbe kommt erst in der Ansicht dazu, und nur als Variable.
    const view = await source(VIEW);
    expect(view).toContain('fill="currentColor"');
    expect(view).toContain('stroke="currentColor"');
    expect(view).toContain("var(--qkern-surface)");
    expect(view).not.toMatch(/#[0-9a-fA-F]{3,6}["']/);
  });

  it("says what it shows, what it cannot show and what was cut off, and never shows only a picture", async () => {
    const view = await source(VIEW);
    expect(view).toContain("USAGE_SERIES_HONESTY");
    expect(USAGE_SERIES_HONESTY).toBe("Die Reihe entsteht aus den Nutzungsereignissen. Sie zeigt, was gemessen wurde, nicht Antwortzeiten, und sie reicht nur so weit zurück wie die Aufbewahrung der Ereignisse.");
    expect(view).toContain("definition.cannotShow");
    expect(view).toContain("Keine Ereignisse im Zeitraum");
    expect(view).toContain("Die Antwort wurde an der Zeilengrenze abgeschnitten");
    expect(view).toContain("Gezeigt werden die letzten 48 Stunden in Stundenschritten.");
    expect(view).toContain("Gezeigt werden die letzten 90 Tage in Tagesschritten.");
    // Dieselben Zahlen als Tabelle, nicht nur als Balken.
    expect(view).toContain("Dieselben Zahlen als Tabelle");
    for (const column of ["Abschnitt", "Angenommen", "Abgelehnt", "Ereignisse"]) {
      expect(view, column).toContain(`t("${column}")`);
    }
    // Die Umschaltung zwischen Stunde und Tag springt nicht in der Breite.
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Stunden", "Tage")');
    for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    // Jede der drei Seiten sagt ausdruecklich, was in einem Nutzungsereignis
    // nicht steht.
    expect(USAGE_SERIES_VIEWS.api.cannotShow).toContain("Antwortzeiten");
    expect(USAGE_SERIES_VIEWS.storage.cannotShow).toContain("Belegung");
    expect(USAGE_SERIES_VIEWS.functions.cannotShow).toContain("gescheitert");
    for (const view of Object.values(USAGE_SERIES_VIEWS)) {
      expect(view.cannotShow.length).toBeGreaterThanOrEqual(80);
      expect(view.metrics.length).toBeGreaterThan(0);
      for (const metric of view.metrics) expect(USAGE_SERIES_METRIC_IDS).toContain(metric);
    }
  });

  it("translates every metric, every page and every text into en, fr and it", async () => {
    for (const metric of USAGE_SERIES_METRIC_IDS) {
      const text = USAGE_SERIES_METRIC_TEXTS[metric];
      for (const german of [text.label, text.unit]) {
        expect(german, metric).toMatch(/\S/);
        for (const locale of ["en", "fr", "it"] as const) {
          expect(CONSOLE_TRANSLATIONS[locale][german], `${locale}: ${metric}`).toMatch(/\S/);
        }
      }
    }
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = usageSeriesTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const keys = [...(await source(VIEW)).matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)]
      .map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
