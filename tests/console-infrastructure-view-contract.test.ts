import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  ENVIRONMENTS_SOURCE_NOTE,
  EXTENSIONS_SOURCE_NOTE,
  MISSING_INFRASTRUCTURE,
  REGION_SOURCE_NOTE,
  RUNTIME_SOURCE_NOTE,
  SCOPE_NOTE,
  SIZE_SOURCE_NOTE,
  bindingState,
  infrastructureTexts,
  projectStatus,
  recoveryState,
} from "@/lib/console/infrastructure-texts";

/**
 * Einstellungen → Infrastruktur (2.68) liest nur, und die Seite behauptet
 * nichts, wofuer sie keine Quelle hat. Der Vertrag prueft das an der Quelle:
 * kein Schreibverb, keine Adresse, keine Kachel ohne Deckung, die fehlenden
 * Faehigkeiten mit Grund, und jeder Text in allen vier Sprachen.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/infrastructure-view.tsx";
const TEXTS = "lib/console/infrastructure-texts.ts";
const RUNTIME_ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/database/runtime/route.ts";
const ENVIRONMENTS_ROUTE = "app/api/v1/projects/[projectId]/environments/route.ts";
const SERVICE = "lib/server/data-plane/service.ts";

describe("console infrastructure view contract", () => {
  it("makes the page real and takes its placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("set-infrastructure");
    expect(isPlaceholder("set-infrastructure")).toBe(false);
    expect("set-infrastructure" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "set-infrastructure": return <InfrastructureView');
    // Das alte Versprechen steht nirgends mehr, auch nicht als Erklaerung.
    const navigation = await source("components/console/navigation.ts");
    expect(navigation).not.toContain("Region, Postgres-Version, Lese-Replikate.");
    // Der Menuepunkt bleibt an seinem Platz und behaelt seinen Namen.
    expect(navigation).toContain('{ id: "set-infrastructure", label: "Infrastruktur" }');
  });

  it("writes nothing anywhere on this path", async () => {
    const files = await Promise.all([source(VIEW), source(TEXTS), source(RUNTIME_ROUTE), source(ENVIRONMENTS_ROUTE)]);
    for (const file of files) {
      expect(file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    for (const route of files.slice(2)) {
      expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
      expect(route).toContain('"Cache-Control": "private, no-store"');
    }
    // Die Ansicht hat kein Eingabefeld und keinen Speicherknopf.
    expect(files[0]).not.toContain("<input");
    expect(files[0]).not.toContain("<form");
    // Das Textmodul ist rein: kein Abruf, kein React.
    expect(files[1]).not.toContain("fetch(");
    expect(files[1]).not.toContain("use client");
  });

  it("never carries a connection string, a password, a host or a port", async () => {
    const everywhere = (await Promise.all([
      source(VIEW), source(TEXTS), source(RUNTIME_ROUTE), source(ENVIRONMENTS_ROUTE),
    ])).join("\n");
    for (const word of ["postgres://", "postgresql://", "connectionString", "sslmode", "5432", "localhost", "127.0.0.1"]) {
      expect(everywhere, word).not.toContain(word);
    }
    // Und die Abfrage selbst liest keine Adresse und keinen Pfad.
    const service = await source(SERVICE);
    const start = service.indexOf("const RUNTIME_SQL = `") + "const RUNTIME_SQL = `".length;
    const runtimeSql = service.slice(start, service.indexOf("`", start));
    expect(runtimeSql).toContain("current_setting('server_version')");
    expect(runtimeSql).toContain("current_setting('server_encoding')");
    expect(runtimeSql).toContain("pg_catalog.pg_database_size");
    expect(runtimeSql).toContain("pg_catalog.pg_is_in_recovery()");
    expect(runtimeSql).toContain("datcollate");
    expect(runtimeSql).toContain("datctype");
    // Genau eine Datenbank, nie der ganze Cluster.
    expect(runtimeSql).toContain("database.datname = current_database()");
    for (const forbidden of ["inet_server_addr", "inet_server_port", "client_addr", "client_dn", "data_directory", "pg_stat_replication", "pg_ls_dir", "pg_read_file"]) {
      expect(runtimeSql, forbidden).not.toContain(forbidden);
    }
  });

  it("says where every number comes from and what QKERN does not know", async () => {
    const view = await source(VIEW);
    // Jede Zahl traegt ihre Quelle neben sich, nicht im Kleingedruckten.
    expect(REGION_SOURCE_NOTE).toContain("Projektzeile");
    expect(RUNTIME_SOURCE_NOTE).toContain("server_version");
    expect(SIZE_SOURCE_NOTE).toContain("pg_database_size");
    expect(ENVIRONMENTS_SOURCE_NOTE).toContain("project_environments");
    expect(EXTENSIONS_SOURCE_NOTE).toContain("installiert");
    // Die Seite sagt, welche Frage sie beantwortet, und wiederholt nicht die
    // Seite Datenbank-Einstellungen.
    expect(SCOPE_NOTE).toContain("Datenbank → Einstellungen");
    for (const note of ["REGION_SOURCE_NOTE", "RUNTIME_SOURCE_NOTE", "SIZE_SOURCE_NOTE", "ENVIRONMENTS_SOURCE_NOTE", "EXTENSIONS_SOURCE_NOTE", "SCOPE_NOTE"]) {
      expect(view, note).toContain(note);
    }
    // Lese-Replikate sind eine Zeile mit Grund, keine leere Kachel.
    const titles = MISSING_INFRASTRUCTURE.map((entry) => entry.title);
    expect(titles[0]).toBe("Keine Lese-Replikate");
    expect(titles).toEqual([
      "Keine Lese-Replikate",
      "Keine Grösse der Instanz, keine Grösse der Platte",
      "Kein Wechsel der Region",
      "Keine Adresse der Datenbank",
      "Kein Aufwärtsweg auf eine neue Postgres-Version",
    ]);
    const replicas = MISSING_INFRASTRUCTURE[0].body;
    expect(replicas).toContain("pg_stat_replication");
    expect(replicas).toContain("Recht");
    for (const entry of MISSING_INFRASTRUCTURE) {
      expect(entry.body.length, entry.title).toBeGreaterThanOrEqual(60);
    }
    expect(view).toContain("MISSING_INFRASTRUCTURE");
    // Fuenf Zustaende, nicht einer.
    for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    // Neu laden springt nicht in der Breite.
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
  });

  it("maps every state of the project, the binding and the recovery to a word", () => {
    expect(projectStatus("ready")).toBe("ready");
    expect(projectStatus("degraded")).toBe("degraded");
    // Ein unbekannter Zustand wird nicht zu "bereit" geraten.
    expect(projectStatus("etwas anderes")).toBe("provisioning");
    expect(bindingState(true)).toBe("bound");
    expect(bindingState(false)).toBe("pending");
    expect(recoveryState(true)).toBe("standby");
    expect(recoveryState(false)).toBe("primary");
  });

  it("formats every number and every moment through console-display", async () => {
    const view = await source(VIEW);
    expect(view).toContain('from "@/components/console/console-display"');
    for (const forbidden of ["Intl.", "toLocaleString", "toLocaleDateString", "toFixed", ".slice(0, 10)"]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
  });

  it("translates every derived text and every literal of the view into en, fr and it", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = infrastructureTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const view = await source(VIEW);
    const keys = [...view.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    // Das Versprechen des Platzhalters ist auch aus den Katalogen weg.
    for (const locale of ["en", "fr", "it"] as const) {
      expect(CONSOLE_TRANSLATIONS[locale]["Region, Postgres-Version, Lese-Replikate."]).toBeUndefined();
    }
  });
});
