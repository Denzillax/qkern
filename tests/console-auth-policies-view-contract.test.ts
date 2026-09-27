import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  AUTH_ACCESS_FOREIGN_ROLE_NOTE,
  AUTH_ACCESS_LIST_SOURCE_NOTE,
  AUTH_ACCESS_MAPPING,
  AUTH_ACCESS_READ_ONLY_NOTE,
  AUTH_ACCESS_RESTRICTIVE_NOTE,
  AUTH_ACCESS_RLS_OFF_NOTE,
  AUTH_ACCESS_UNCERTAIN_NOTE,
  AUTH_ACCESS_VERDICTS,
  AUTH_ACCESS_VERDICT_TEXTS,
  authPoliciesTexts,
} from "@/lib/console/auth-policies-texts";

/**
 * Auth -> Policies (2.62) liest nur, und die Seite benennt die Abbildung, ohne
 * die eine Policy-Liste nichts bedeutet. Der Vertrag prueft das an der Quelle:
 * kein Schreibverb, kein Eingabefeld, die Abbildung samt Realtime-Tuer im
 * Wortlaut, der Satz zu einer Tabelle ohne Row Level Security, der Satz zu
 * einer Bedingung, die diese Seite nicht ausrechnen kann -- und jeder Text in
 * allen vier Sprachen.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/auth-policies-view.tsx";
const TEXTS = "lib/console/auth-policies-texts.ts";
const RULES = "lib/server/data-plane/auth-access-rules.ts";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/auth/access/route.ts";

describe("console auth policies view contract", () => {
  it("makes the page real and takes its placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("auth-policies");
    expect(isPlaceholder("auth-policies")).toBe(false);
    expect("auth-policies" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "auth-policies": return <AuthPoliciesView');
    const navigation = await source("components/console/navigation.ts");
    // Das alte Versprechen steht nirgends mehr, auch nicht als Erklaerung.
    expect(navigation).not.toContain("Gleiche Lage wie unter Datenbank → Policies.");
    expect(navigation).toContain('{ id: "auth-policies", label: "Policies" }');
  });

  it("writes nothing anywhere on this path", async () => {
    const files = await Promise.all([source(VIEW), source(TEXTS), source(RULES), source(ROUTE)]);
    for (const file of files) {
      expect(file).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    const route = files[3];
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain('"Cache-Control": "private, no-store"');
    // Dieselbe Tuer und dieselbe Parameterpruefung wie /schema/policies.
    expect(route).toContain("generatedDataContext(request, scope, false");
    expect(route).toContain('(key) => key !== "schema"');
    expect(route).toContain('request.nextUrl.searchParams.getAll("schema").length > 1');
    // Die Ansicht hat kein Eingabefeld und keinen Speicherknopf.
    expect(files[0]).not.toContain("<input");
    expect(files[0]).not.toContain("<form");
    expect(files[0]).not.toContain("<textarea");
    // Die reinen Module bleiben rein: kein Abruf, kein React, keine Datenbank.
    for (const pure of [files[1], files[2]]) {
      expect(pure).not.toContain("fetch(");
      expect(pure).not.toContain("use client");
      expect(pure).not.toContain("client.query");
    }
    // Das Regelmodul kennt keinen Zeileninhalt: Es fragt nie eine Tabelle ab.
    expect(files[2]).not.toMatch(/\bFROM\s+pg_/);
    expect(files[2]).not.toContain("pg_catalog");
    expect(files[2]).not.toContain("query(");
  });

  it("names the mapping on the page and not in a footnote", async () => {
    const view = await source(VIEW);
    expect(view).toContain("AUTH_ACCESS_MAPPING");
    // Fuenf Schritte, und der letzte ist die Realtime-Tuer.
    expect(AUTH_ACCESS_MAPPING).toHaveLength(5);
    expect(AUTH_ACCESS_MAPPING.map((entry) => entry.title)).toEqual([
      "Die Datenbankrolle", "Die Claims", "Die Einstellungen", "Row Level Security bleibt an",
      "Dieselben Claims an der Realtime-Tür",
    ]);
    const mapping = AUTH_ACCESS_MAPPING.map((entry) => entry.body).join("\n");
    // Die Rolle: eine Anwendungsrolle, kein SET ROLE, kein Umgehen.
    expect(mapping).toContain("SET ROLE");
    expect(mapping).toContain("Anwendungsrolle");
    // Die Claims und die Einstellungen mit Namen.
    for (const claim of ["authenticated", "sub", "email_verified", "aal", "session_id", "app_metadata"]) {
      expect(mapping, claim).toContain(claim);
    }
    for (const setting of ["request.jwt.claims", "request.jwt.claim.role", "request.jwt.claim.sub", "qkern.actor_ref", "current_setting", "row_security = on"]) {
      expect(mapping, setting).toContain(setting);
    }
    // Ein Service Key umgeht nichts, und dieselben Claims gelten an der Realtime-Tuer.
    expect(mapping).toContain("service_role");
    for (const channel of ["public:", "private:", "user:<sub>", "changes:"]) {
      expect(mapping, channel).toContain(channel);
    }
    // Und die Ansicht zeigt die wirklich gelesene Rolle, nicht nur den Claim.
    expect(view).toContain("access.role");
    expect(view).toContain("access.claimRole");
  });

  it("says per row what the verdict cannot know, and says what row security off means", async () => {
    const view = await source(VIEW);
    expect(AUTH_ACCESS_RLS_OFF_NOTE).toContain("verweigert die Data API die Tabelle vollständig");
    expect(AUTH_ACCESS_VERDICT_TEXTS.refused.explains).toContain("GENERATED_DATA_API_RLS_REQUIRED");
    expect(AUTH_ACCESS_UNCERTAIN_NOTE).toContain("nicht in einer Fussnote");
    expect(view).toContain("AUTH_ACCESS_RLS_OFF_NOTE");
    expect(view).toContain("AUTH_ACCESS_UNCERTAIN_NOTE");
    expect(view).toContain("AUTH_ACCESS_READ_ONLY_NOTE");
    expect(view).toContain("AUTH_ACCESS_FOREIGN_ROLE_NOTE");
    expect(view).toContain("AUTH_ACCESS_RESTRICTIVE_NOTE");
    expect(view).toContain("AUTH_ACCESS_LIST_SOURCE_NOTE");
    // Die Unsicherheit steht in der Zeile der Tabelle, nicht am Seitenende.
    expect(view).toContain("table.uncertain");
    expect(view).toContain("AUTH_ACCESS_CONDITION_TEXTS.request.explains");
    // Die Seite sagt, dass sie nichts aendert und wo es geht.
    expect(AUTH_ACCESS_READ_ONLY_NOTE).toContain("Change Set");
    expect(AUTH_ACCESS_LIST_SOURCE_NOTE).toContain("pg_policy");
    expect(AUTH_ACCESS_RESTRICTIVE_NOTE).toContain("erlaubt nichts");
    // Jedes Urteil steht der Ansicht mit Text und Ton zur Verfuegung.
    for (const verdict of AUTH_ACCESS_VERDICTS) {
      expect(AUTH_ACCESS_VERDICT_TEXTS[verdict].explains.length, verdict).toBeGreaterThanOrEqual(60);
    }
    // Fuenf Zustaende, nicht einer.
    for (const state of ["loading", "ready", "disabled", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    // Neu laden springt nicht in der Breite.
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
  });

  it("translates every derived text and every literal of the view into en, fr and it", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = authPoliciesTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const view = await source(VIEW);
    const keys = [...view.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(15);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    // Das Versprechen des Platzhalters ist auch aus den Katalogen weg.
    for (const locale of ["en", "fr", "it"] as const) {
      expect(CONSOLE_TRANSLATIONS[locale]["RLS-Regeln aus Sicht der Anmeldung. Gleiche Lage wie unter Datenbank → Policies."]).toBeUndefined();
    }
  });
});
