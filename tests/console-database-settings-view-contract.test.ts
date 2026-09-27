import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  BINDING_STEPS,
  LIMITS_SOURCE_NOTE,
  MISSING_CAPABILITIES,
  NO_CONNECTION_DETAILS_NOTE,
  ROLES_SOURCE_NOTE,
  TLS_SOURCE_NOTE,
  databaseSettingsTexts,
} from "@/lib/console/database-settings-texts";

/**
 * Datenbank-Einstellungen (2.53) liest nur, und die Seite traegt keine
 * Verbindungsdaten. Der Vertrag prueft genau das an der Quelle: kein
 * Schreibverb, keine Verbindungszeichenfolge, kein Passwort, kein Host, kein
 * Port — und jeder Text in allen vier Sprachen.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/database-settings-view.tsx";
const TEXTS = "lib/console/database-settings-texts.ts";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/database/settings/route.ts";
const SERVICE = "lib/server/data-plane/service.ts";

describe("console database settings view contract", () => {
  it("makes the page real and takes its placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("db-settings");
    expect(isPlaceholder("db-settings")).toBe(false);
    expect("db-settings" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "db-settings": return <DatabaseSettingsView');
    // Das alte Versprechen steht nirgends mehr, auch nicht als Erklaerung.
    const navigation = await source("components/console/navigation.ts");
    expect(navigation).not.toContain("Verbindungsdaten, Pooler, SSL-Zwang, Netzwerkbeschränkungen.");
    // Der Menuepunkt bleibt an seinem Platz und behaelt seinen Namen.
    expect(navigation).toContain('{ id: "db-settings", label: "Datenbank-Einstellungen" }');
  });

  it("writes nothing anywhere on this path", async () => {
    const files = await Promise.all([source(VIEW), source(TEXTS), source(ROUTE)]);
    for (const file of files) {
      expect(file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    expect(files[2]).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(files[2]).toContain('"Cache-Control": "private, no-store"');
    // Die Ansicht hat kein Eingabefeld und keinen Speicherknopf.
    expect(files[0]).not.toContain("<input");
    expect(files[0]).not.toContain("<form");
    // Das Textmodul ist rein: kein Abruf, kein React.
    expect(files[1]).not.toContain("fetch(");
    expect(files[1]).not.toContain("use client");
  });

  it("never carries a connection string, a password, a host or a port", async () => {
    const everywhere = (await Promise.all([source(VIEW), source(TEXTS), source(ROUTE)])).join("\n");
    for (const word of ["postgres://", "postgresql://", "connectionString", "sslmode", "5432", "localhost", "127.0.0.1"]) {
      expect(everywhere, word).not.toContain(word);
    }
    // Und die Abfrage selbst liest keine Adresse: Die vier Katalogfunktionen
    // und Spalten, die eine verraten wuerden, kommen in der Anweisung nicht vor.
    const service = await source(SERVICE);
    const start = service.indexOf("const SETTINGS_SQL = `") + "const SETTINGS_SQL = `".length;
    const settingsSql = service.slice(start, service.indexOf("`", start));
    expect(settingsSql).toContain("pg_catalog.pg_stat_ssl");
    expect(settingsSql).toContain("pg_catalog.pg_backend_pid()");
    expect(settingsSql).toContain("current_setting('ssl', true)");
    expect(settingsSql).toContain("current_setting('max_connections')");
    expect(settingsSql).toContain("datconnlimit");
    expect(settingsSql).toContain("rolconnlimit");
    // Nur das eigene Backend, nie eine fremde Sitzung.
    expect(settingsSql).toContain("ssl.pid = pg_catalog.pg_backend_pid()");
    for (const column of ["inet_server_addr", "inet_server_port", "client_addr", "client_hostname", "client_dn", "rolpassword", "cipher", "bits"]) {
      expect(settingsSql, column).not.toContain(column);
    }
  });

  it("says as its first sentence that there are no connection details, and names what it cannot do", async () => {
    const view = await source(VIEW);
    expect(NO_CONNECTION_DETAILS_NOTE).toContain("keine Verbindungsdaten");
    expect(view).toContain("NO_CONNECTION_DETAILS_NOTE");
    expect(view).toContain("TLS_SOURCE_NOTE");
    expect(view).toContain("LIMITS_SOURCE_NOTE");
    expect(view).toContain("ROLES_SOURCE_NOTE");
    // Die Quelle des TLS-Zustands steht neben ihm, nicht im Kleingedruckten.
    expect(TLS_SOURCE_NOTE).toContain("pg_stat_ssl");
    expect(TLS_SOURCE_NOTE).toContain("pg_hba.conf");
    expect(LIMITS_SOURCE_NOTE).toContain("max_connections");
    expect(ROLES_SOURCE_NOTE).toContain("Katalog");
    // Die vier Versprechen des Platzhalters, jedes mit einer Antwort.
    const missing = MISSING_CAPABILITIES.map((entry) => entry.title);
    expect(missing).toEqual(["Kein Pooler", "Keine Netzwerkbeschränkung", "Kein Wechsel der Verbindung", "Kein TLS-Zwang von hier aus"]);
    for (const entry of [...MISSING_CAPABILITIES, ...BINDING_STEPS]) {
      expect(entry.body.length, entry.title).toBeGreaterThanOrEqual(60);
    }
    // Statt einer Oberflaeche, die es nicht gibt: das Skript und das Handbuch.
    const binding = BINDING_STEPS.map((entry) => entry.body).join("\n");
    expect(binding).toContain("npm run dev:bind-project-database");
    expect(binding).toContain("Handbuch");
    expect(view).toContain("MISSING_CAPABILITIES");
    expect(view).toContain("BINDING_STEPS");
    // Vier Zustaende, nicht einer.
    for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    // Neu laden springt nicht in der Breite.
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
  });

  it("translates every derived text and every literal of the view into en, fr and it", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = databaseSettingsTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const view = await source(VIEW);
    const keys = [...view.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(25);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    // Das Versprechen des Platzhalters ist auch aus den Katalogen weg.
    for (const locale of ["en", "fr", "it"] as const) {
      expect(CONSOLE_TRANSLATIONS[locale]["Verbindungsdaten, Pooler, SSL-Zwang, Netzwerkbeschränkungen. Die Provisionierung ist noch nicht verbunden."]).toBeUndefined();
    }
  });
});
