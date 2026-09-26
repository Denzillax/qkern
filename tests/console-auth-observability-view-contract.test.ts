import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  AUTH_AUDIT_ACTION_TEXTS,
  AUTH_LOG_ACTOR_TEXTS,
  AUTH_LOG_CANNOT_SHOW,
  AUTH_LOG_HONESTY,
  AUTH_SERIES_CANNOT_SHOW,
  AUTH_SERIES_HONESTY,
  PROJECT_AUTH_AUDIT_ACTION_IDS,
  authObservabilityTexts,
} from "@/lib/console/auth-observability-texts";

/**
 * Die beiden Auth-Berichte (2.47) lesen nur. Berichte → Auth zeigt die Reihe,
 * Logs → Auth das Protokoll, beide aus dem Auth-Audit. Kein Schreibverb, kein
 * Feld, das eine Adresse oder ein Token tragen koennte, aggregiert wird in der
 * Datenbank, und jeder Text spricht alle vier Sprachen.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const SERIES = "components/console/auth-series-view.tsx";
const LOG = "components/console/auth-log-view.tsx";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/audit/series/route.ts";
const PURE = "lib/server/project-auth/audit-series.ts";

describe("console auth observability view contract", () => {
  it("makes both pages real and takes their placeholder claims off the navigation", async () => {
    for (const id of ["obs-auth", "logs-auth"] as const) {
      expect(REAL_VIEWS).toContain(id);
      expect(isPlaceholder(id as never)).toBe(false);
      expect(id in PLACEHOLDERS).toBe(false);
    }
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "obs-auth": return <AuthSeriesView');
    expect(app).toContain('case "logs-auth": return <AuthLogView');
    // Die alten Versprechen stehen nirgends mehr: kein fehlender Zaehler,
    // keine ausgegebenen Token, keine Magic Links im Log.
    const navigation = await source("components/console/navigation.ts");
    for (const claim of [
      "Anmeldungen, Fehlversuche und ausgegebene Token",
      "Log des Anmeldedienstes: Anmeldungen, Magic Links",
    ]) {
      expect(navigation, claim).not.toContain(claim);
    }
  });

  it("only reads, from the audit routes and nowhere else", async () => {
    for (const file of [SERIES, LOG]) {
      const view = await source(file);
      expect(view, file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
      expect(view, file).toContain("/auth/admin/audit");
      for (const word of ["revoke", "delete(", "updateuser", "signin", "password"]) {
        expect(view.toLowerCase(), `${file}: ${word}`).not.toContain(word);
      }
    }
    const route = await source(ROUTE);
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain("projectAuthNoStore(");
    expect(route).toContain("adminProjectAuthScope(");
    expect(await source("lib/server/project-auth/http.ts")).toContain('"Cache-Control": "private, no-store"');
    // Jeder fremde Query-Parameter ist ein 400; das Fenster steht im Dienst.
    expect(route).toContain("searchParams");
  });

  it("shows no field that could carry an address or a token", async () => {
    const log = await source(LOG);
    // Gelesen werden genau diese fuenf Felder und die ID als Schluessel.
    expect(log).toContain("entry.createdAt");
    expect(log).toContain("entry.action");
    expect(log).toContain("entry.status");
    expect(log).toContain("entry.resourceRef");
    expect(log).toContain("entry.actorType");
    for (const field of ["actorRef", "metadata", "email", "token", "ipAddress", "userAgent"]) {
      expect(log, field).not.toContain(field);
    }
    const series = await source(SERIES);
    for (const field of ["resourceRef", "actorRef", "metadata", "email", "token"]) {
      expect(series, field).not.toContain(field);
    }
  });

  it("aggregates in the database and never loads the audit rows into JavaScript", async () => {
    const sink = await source("lib/server/project-auth/audit-postgres.ts");
    const series = sink.slice(sink.indexOf("  async series("));
    expect(series).toContain("date_trunc");
    expect(series).toContain("GROUP BY");
    expect(series).toContain("ORDER BY");
    expect(series).toContain("LIMIT $7");
    expect(series).toContain("COUNT(*) FILTER (WHERE status = 'failed')");
    // Ohne die Umrechnung schnitte `date_trunc` in der Zeitzone der Sitzung.
    expect(series).toContain("AT TIME ZONE 'UTC'");
    // Nur eigene Handlungen, wie es die RESTRICTIVE Policy aus 0046 verlangt.
    expect(series).toContain("starts_with(action, 'project_auth.')");
    // Jeder Wert ist ein Parameter; nichts wird in die Abfrage geschrieben.
    expect(series).not.toMatch(/\$\{/);
  });

  it("draws from a pure layout function that knows no colour", async () => {
    const pure = await source(PURE);
    expect(pure).not.toContain("react");
    expect(pure).not.toContain("pg");
    expect(pure).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    const chart = await source("lib/console/usage-series-chart.ts");
    expect(chart).not.toContain("currentColor");
    const series = await source(SERIES);
    expect(series).toContain("buildUsageSeriesChart");
    expect(series).toContain('fill="currentColor"');
    expect(series).toContain("var(--qkern-surface)");
    expect(series).not.toMatch(/#[0-9a-fA-F]{3,6}["']/);
  });

  it("says what it counts, what it cannot show and what was cut off, and never shows only a picture", async () => {
    const series = await source(SERIES);
    expect(AUTH_SERIES_HONESTY).toBe("Gezählt wird, was der Anmeldedienst protokolliert hat. Wer sich angemeldet hat, steht hier nicht.");
    expect(AUTH_LOG_HONESTY).toBe("Der Eintrag nennt die Handlung und ihren Ausgang. Adressen, Token und Schlüssel schreibt QKERN nie ins Protokoll.");
    expect(series).toContain("AUTH_SERIES_HONESTY");
    expect(series).toContain("AUTH_SERIES_CANNOT_SHOW");
    expect(series).toContain("Keine Ereignisse im Zeitraum");
    expect(series).toContain("Die Antwort wurde an der Zeilengrenze abgeschnitten");
    expect(series).toContain("Gezeigt werden die letzten 48 Stunden in Stundenschritten.");
    expect(series).toContain("Gezeigt werden die letzten 90 Tage in Tagesschritten.");
    // Dieselben Zahlen als Tabelle, nicht nur als Balken.
    expect(series).toContain("Dieselben Zahlen als Tabelle");
    for (const column of ["Abschnitt", "Handlungen", "Erfolgreich", "Fehlversuche"]) {
      expect(series, column).toContain(`t("${column}")`);
    }
    expect(series).toContain("StableLabel");
    expect(series).toContain('tAll("Stunden", "Tage")');

    const log = await source(LOG);
    expect(log).toContain("AUTH_LOG_HONESTY");
    expect(log).toContain("AUTH_LOG_CANNOT_SHOW");
    expect(log).toContain("StableLabel");
    expect(log).toContain('tAll("Lädt…", "Neu laden")');
    expect(log).toContain("Noch keine Auth-Ereignisse");
    for (const file of [series, log]) {
      for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
        expect(file, state).toContain(`"${state}"`);
      }
    }
    for (const sentence of [AUTH_SERIES_CANNOT_SHOW, AUTH_LOG_CANNOT_SHOW]) {
      expect(sentence.length).toBeGreaterThanOrEqual(80);
    }
  });

  it("translates every action, every actor and every sentence into en, fr and it", async () => {
    for (const id of PROJECT_AUTH_AUDIT_ACTION_IDS) {
      expect(AUTH_AUDIT_ACTION_TEXTS[id], id).toMatch(/\S/);
    }
    expect(Object.keys(AUTH_LOG_ACTOR_TEXTS).sort()).toEqual(["admin", "anonymous", "app_user", "system"]);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = authObservabilityTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const keys = (await Promise.all([SERIES, LOG].map(source)))
      .flatMap((file) => [...file.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)]
        .map((match) => JSON.parse(match[1]) as string));
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
