import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  REALTIME_ACTIONS,
  REALTIME_CHANNEL_KINDS,
  REALTIME_PERMISSIONS,
  REALTIME_POLICIES_HONESTY,
  REALTIME_POLICIES_RLS_NOTE,
  REALTIME_ROLES,
  REALTIME_SETTINGS_HONESTY,
  realtimeTexts,
} from "@/lib/console/realtime-texts";
import { PrefixRealtimeAuthorization } from "@/lib/server/realtime/policy";
import type { RealtimePrincipal, RealtimeScope } from "@/lib/server/realtime/model";

/**
 * Realtime-Einstellungen und -Rechte (2.48) lesen nur, und sie behaupten
 * nichts, was der Code nicht tut.
 *
 * Der wichtigste Test steht unten: Jede Zelle der Rechtetabelle wird gegen
 * `PrefixRealtimeAuthorization` gehalten. Eine Console, die ein Rechtemodell
 * zeigt, das es nicht gibt, waere schlimmer als eine, die nichts zeigt.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const SETTINGS_VIEW = "components/console/realtime-settings-view.tsx";
const POLICIES_VIEW = "components/console/realtime-policies-view.tsx";
const TEXTS = "lib/console/realtime-texts.ts";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/realtime/settings/route.ts";
const LIMITS = "lib/server/realtime/settings.ts";

const scope: RealtimeScope = { organizationId: "org", projectId: "project", environment: "development" };

function principal(role: RealtimePrincipal["role"], subject: string): RealtimePrincipal {
  return { organizationId: scope.organizationId, actorRef: `test:${role}`, role, subject };
}

const CHANNEL = {
  public: "public:room",
  private: "private:room",
  user: "user:subject:room",
  changes: "changes:public.items",
} as const;

describe("console realtime settings and policies view contract", () => {
  it("makes both pages real and takes their placeholder claims off the navigation", async () => {
    for (const id of ["realtime-settings", "realtime-policies"] as const) {
      expect(REAL_VIEWS).toContain(id);
      expect(isPlaceholder(id as never)).toBe(false);
      expect(id in PLACEHOLDERS).toBe(false);
    }
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "realtime-settings": return <RealtimeSettingsView');
    expect(app).toContain('case "realtime-policies": return <RealtimePoliciesView');
    const navigation = await source("components/console/navigation.ts");
    for (const claim of ["Wer welchen Kanal lesen und schreiben darf.", "Grenzen für Verbindungen und Nachrichten je Sekunde."]) {
      expect(navigation, claim).not.toContain(claim);
    }
  });

  it("reads and never writes, anywhere on the path", async () => {
    const files = await Promise.all([source(SETTINGS_VIEW), source(POLICIES_VIEW), source(ROUTE), source(LIMITS), source(TEXTS)]);
    for (const file of files) {
      expect(file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    expect(files[2]).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(files[2]).toContain('"Cache-Control": "private, no-store"');
    // Die Einstellungsseite hat kein Eingabefeld und keinen Speicherknopf,
    // weil es nichts zu speichern gibt.
    for (const word of ["<input", "<textarea", "<select", "Speichern"]) {
      expect(files[0], word).not.toContain(word);
    }
    // Die Rechteseite ruft ueberhaupt keine Route auf; es gibt keine.
    expect(files[1]).not.toContain("fetch(");
    expect(files[0]).toContain("/realtime/settings");
  });

  it("shows value, unit and origin per limit and states where they can be changed", async () => {
    const view = await source(SETTINGS_VIEW);
    expect(REALTIME_SETTINGS_HONESTY).toBe(
      "Diese Werte gelten für diese Installation. Ändern lassen sie sich in der Umgebung, nicht in der Console.",
    );
    expect(view).toContain("REALTIME_SETTINGS_HONESTY");
    expect(view).toContain("REALTIME_SETTINGS_PROCESS_NOTE");
    expect(view).toContain("REALTIME_FIGURES_NOTE");
    for (const column of ["Grenze", "Wert", "Einheit", "Ursprung"]) {
      expect(view, column).toContain(`t("${column}")`);
    }
    // Neu laden springt nicht in der Breite.
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
    for (const state of ["loading", "ready", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
  });

  it("claims no permission model beyond the prefix rule that the code really has", async () => {
    const view = await source(POLICIES_VIEW);
    expect(REALTIME_POLICIES_HONESTY).toContain("Es gibt keine Kanalrechte, die sich in der Console anlegen liessen.");
    expect(view).toContain("REALTIME_POLICIES_HONESTY");
    expect(view).toContain("REALTIME_POLICIES_SOURCE_NOTE");
    expect(REALTIME_POLICIES_RLS_NOTE).toContain("Row Level Security");
    // Kein Wort, das eine Verwaltung verspricht, die es nicht gibt.
    const words = ["anlegen<", "Regel hinzufügen", "Policy erstellen", "Neue Regel", "Bearbeiten", "Speichern", "<input", "<form"];
    for (const word of words) expect(view, word).not.toContain(word);
    // Und keine Zeile aus einer Tabelle: Es gibt keine Tabelle mit Kanalrechten.
    for (const claim of ["realtime_policies", "channel_policies", "realtime.policies"]) {
      expect(view, claim).not.toContain(claim);
    }
  });

  it("matches every cell of the shown table against PrefixRealtimeAuthorization", async () => {
    const authorization = new PrefixRealtimeAuthorization();
    let cells = 0;
    for (const kind of REALTIME_CHANNEL_KINDS) {
      for (const role of REALTIME_ROLES) {
        // Das Subjekt des user-Kanals gehoert diesem Principal; die Fussnote
        // in der Ansicht sagt genau das, und der naechste Fall prueft das
        // Gegenteil.
        const actor = principal(role, "subject");
        for (const action of REALTIME_ACTIONS) {
          const allowed = await authorization.authorize({ scope, principal: actor, channel: CHANNEL[kind], action });
          expect(allowed, `${kind}/${role}/${action}`).toBe(REALTIME_PERMISSIONS[kind][role][action]);
          cells += 1;
        }
      }
    }
    expect(cells).toBe(36);
    // Ein fremdes Subjekt darf den user-Kanal nicht, und die Ansicht sagt es
    // als Fussnote statt als Ja.
    for (const action of REALTIME_ACTIONS) {
      expect(await authorization.authorize({
        scope, principal: principal("authenticated", "someone-else"), channel: CHANNEL.user, action,
      }), action).toBe(false);
    }
    // Eine fremde Organisation scheitert vor jedem Praefix.
    expect(await authorization.authorize({
      scope, principal: { ...principal("service_role", "subject"), organizationId: "other" },
      channel: CHANNEL.public, action: "subscribe",
    })).toBe(false);
  });

  it("translates every text of both pages into en, fr and it", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = realtimeTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const keys = (await Promise.all([source(SETTINGS_VIEW), source(POLICIES_VIEW)]))
      .flatMap((file) => [...file.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]) as string));
    expect(keys.length).toBeGreaterThan(25);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
