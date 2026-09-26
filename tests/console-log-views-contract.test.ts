import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  DATA_API_LOG_TEXTS,
  FUNCTION_LOG_COLUMNS,
  FUNCTION_LOG_CONTAINER_OUTPUT,
  FUNCTION_LOG_HONESTY,
  FUNCTION_LOG_NO_EGRESS,
  FUNCTION_LOG_OUTCOMES,
  LOG_VIEW_STATES,
  logViewTexts,
} from "@/lib/console/log-view-texts";

/**
 * Die beiden Logseiten (2.51) am Quelltext geprueft.
 *
 * Logs → Functions zeigt das Aufrufprotokoll aus Migration 0045 und sagt
 * selbst, was darin nicht steht. Logs → Data API zeigt **kein** Log, weil es
 * keines gibt, und sagt das als Erstes. Beide lesen nur, beide sprechen alle
 * vier Sprachen, und keine von beiden traegt eine Nutzlast, eine Ausgabe des
 * Containers oder ein Geheimnis.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const FUNCTION_VIEW = "components/console/function-log-view.tsx";
const DATA_API_VIEW = "components/console/data-api-log-view.tsx";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/compute/invocations/route.ts";
const TEXTS = "lib/console/log-view-texts.ts";

describe("console log views contract", () => {
  it("makes both log pages real and takes their placeholder claims off the navigation", async () => {
    for (const id of ["logs-functions", "logs-postgrest"] as const) {
      expect(REAL_VIEWS).toContain(id);
      expect(isPlaceholder(id as never)).toBe(false);
      expect(id in PLACEHOLDERS).toBe(false);
    }
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "logs-functions": return <FunctionLogView');
    expect(app).toContain('case "logs-postgrest": return <DataApiLogView');
    // Die alten Versprechen stehen nirgends mehr.
    const navigation = await source("components/console/navigation.ts");
    for (const claim of [
      "mit Dauer und Ausgangsverbindungen",
      "jede Anfrage mit Rolle, Tabelle und Antwortzeit",
    ]) {
      expect(navigation, claim).not.toContain(claim);
    }
    // Function-Logs aus dem Container bleiben ein Platzhalter: Die Ausgabe
    // gibt es weiterhin nicht.
    expect("compute-logs" in PLACEHOLDERS).toBe(true);
  });

  it("only reads, from the one invocation route, and never writes", async () => {
    const view = await source(FUNCTION_VIEW);
    expect(view).toContain("/compute`");
    expect(view).toContain("${base}/invocations?");
    for (const view_ of [view, await source(DATA_API_VIEW)]) {
      expect(view_).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    const route = await source(ROUTE);
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain("computeNoStore(");
    expect(await source("lib/server/compute/definitions-http.ts"))
      .toContain('"Cache-Control": "private, no-store"');
    // Jeder fremde oder doppelte Parameter ist ein 400, vor dem Dienstaufruf.
    expect(route).toContain("Invalid compute request");
    expect(route.indexOf("Invalid compute request")).toBeLessThan(route.indexOf("adminComputeContext(request"));
  });

  it("carries no payload, no container output and no secret out of the log", async () => {
    // Die Zeile selbst: Migration 0045 haelt weder stdout noch stderr, und
    // die Abfrage waehlt nur ihre Spalten.
    const migration = await source("db/migrations/0045_project_function_invocations.sql");
    const columns = migration.slice(migration.indexOf("CREATE TABLE"), migration.indexOf("CREATE INDEX"));
    for (const word of ["stdout", "stderr", "payload", "body", "secret"]) {
      expect(columns.toLowerCase().includes(`  ${word} `), word).toBe(false);
    }
    const repository = await source("lib/server/compute/definitions-postgres-repository.ts");
    const log = repository.slice(repository.indexOf("  async listInvocationLog("),
      repository.indexOf("  async listFunctionDeployments("));
    expect(log).toContain("ORDER BY log.started_at DESC");
    expect(log).toContain("LIMIT $6 OFFSET $7");
    expect(log).toContain("count(*)");
    // Jeder Wert ist ein Parameter; nichts wird in die Abfrage geschrieben.
    expect(log).not.toMatch(/\$\{/);
    for (const column of ["payload", "stdout", "stderr", "secret", "image"]) {
      expect(log.toLowerCase(), column).not.toContain(column);
    }
    // Und die Ansicht zeigt nur Felder, die es gibt.
    const view = await source(FUNCTION_VIEW);
    for (const forbidden of ["row.payload", "stdout", "stderr", "secretRefs", "image", "egressOrigins"]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
    // Die Zeilenform der Ansicht kennt genau die Felder der Route.
    expect(view).toContain("statusCode: number | null; errorCode: string | null;");
  });

  it("says on the page what the invocation log does not hold", async () => {
    const view = await source(FUNCTION_VIEW);
    expect(view).toContain("FUNCTION_LOG_HONESTY");
    expect(view).toContain("FUNCTION_LOG_CONTAINER_OUTPUT");
    expect(view).toContain("FUNCTION_LOG_NO_EGRESS");
    expect(FUNCTION_LOG_CONTAINER_OUTPUT).toContain("stdout");
    expect(FUNCTION_LOG_CONTAINER_OUTPUT).toContain("stderr");
    expect(FUNCTION_LOG_NO_EGRESS).toContain("Ausgangsverbindungen");
    expect(FUNCTION_LOG_HONESTY).toContain("Nutzlast");
    for (const text of [FUNCTION_LOG_HONESTY, FUNCTION_LOG_CONTAINER_OUTPUT, FUNCTION_LOG_NO_EGRESS]) {
      expect(text.length).toBeGreaterThanOrEqual(120);
    }
    // Jede Spalte der Tabelle hat ein Gegenstueck in der Migration.
    expect(FUNCTION_LOG_COLUMNS.map((column) => column.label)).toEqual([
      "Beginn", "Function", "Ausgelöst von", "Dauer", "Ausgang", "Status",
    ]);
    expect(Object.keys(FUNCTION_LOG_OUTCOMES)).toEqual(["completed", "failed"]);
    // Zustaende, leerer Zustand und stabile Beschriftung.
    for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    expect(view).toContain("LOG_VIEW_STATES.empty");
    expect(view).toContain("LOG_VIEW_STATES.emptyFiltered");
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
    // Filter und Seitenschnitt.
    expect(view).toContain('query.set("function"');
    expect(view).toContain('query.set("outcome"');
    expect(view).toContain("offset");
  });

  it("says first that the Data API has no request log and labels what it does show", async () => {
    const view = await source(DATA_API_VIEW);
    expect(view).toContain("DATA_API_LOG_TEXTS.noRequestLog");
    expect(view).toContain("DATA_API_LOG_TEXTS.counterLimit");
    expect(view).toContain("DATA_API_LOG_TEXTS.whatItWouldTake");
    // Der erste Satz sagt, dass es das Log nicht gibt.
    expect(DATA_API_LOG_TEXTS.noRequestLog.startsWith("Ein Protokoll je Anfrage gibt es nicht.")).toBe(true);
    // Der Zaehler wird nie als Data-API-Zahl ausgegeben.
    expect(DATA_API_LOG_TEXTS.counterLimit).toContain("keine Zahl der Data-API-Anfragen");
    expect(DATA_API_LOG_TEXTS.whatItWouldTake).toContain("HTTP-Grenze");
    // Die Seite liest genau die zwei vorhandenen Quellen und keine erfundene.
    expect(view).toContain("/usage/series?metric=api_requests&bucket=hour");
    expect(view).toContain("/generated-openapi?schema=");
    expect(view).not.toContain("/logs");
    for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
  });

  it("translates every text of both pages into en, fr and it", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = logViewTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const keys = (await Promise.all([FUNCTION_VIEW, DATA_API_VIEW].map(source)))
      .flatMap((src) => [...src.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)]
        .map((match) => JSON.parse(match[1]) as string));
    expect(keys.length).toBeGreaterThan(30);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });

  it("keeps the texts module pure and complete", async () => {
    const texts = await source(TEXTS);
    expect(texts).not.toContain("react");
    expect(texts).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    const exported = new Set(logViewTexts());
    for (const text of [
      FUNCTION_LOG_HONESTY, FUNCTION_LOG_CONTAINER_OUTPUT, FUNCTION_LOG_NO_EGRESS,
      ...Object.values(DATA_API_LOG_TEXTS), ...Object.values(LOG_VIEW_STATES),
      ...FUNCTION_LOG_COLUMNS.map((column) => column.meaning),
    ]) {
      expect(exported.has(text), text.slice(0, 40)).toBe(true);
    }
  });
});
