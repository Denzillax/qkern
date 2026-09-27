import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  AUTH_PROTECTION_BUILT_IN,
  AUTH_PROTECTION_BUILT_IN_HONESTY,
  AUTH_PROTECTION_DIGESTS,
  AUTH_PROTECTION_FAILURE_MODE,
  AUTH_PROTECTION_LIST_FAILURE,
  AUTH_PROTECTION_LIST_FILE,
  AUTH_PROTECTION_MIN_LENGTH,
  AUTH_PROTECTION_NEVER_LOGGED,
  AUTH_PROTECTION_NOTICE_TEXTS,
  AUTH_PROTECTION_NOT_DISTRIBUTED,
  AUTH_PROTECTION_NO_BOT_DEFENCE,
  AUTH_PROTECTION_NO_CAPTCHA,
  AUTH_PROTECTION_NO_THIRD_PARTY,
  AUTH_PROTECTION_REVEALS,
  AUTH_PROTECTION_WARNING,
  AUTH_PROTECTION_WHERE,
  AUTH_PROTECTION_WHY_NAMED,
  authProtectionTexts,
} from "@/lib/console/auth-protection-texts";

/**
 * Auth → Passwortschutz (2.53): eine echte Seite mit genau einem Schreibweg,
 * einer vollstaendigen Vorschau davor, keinem Passwort darin und vier
 * Sprachen — und mit Saetzen, die sagen, was dieser Slice **nicht** baut.
 *
 * Der Platzhalter nannte drei Dinge. Dieser Vertrag besteht darauf, dass die
 * Seite die beiden fehlenden beim Namen nennt, statt sie unter einem Titel
 * mitversprechen zu lassen.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/auth-protection-view.tsx";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/password-protection/route.ts";
const PURE = "lib/server/project-auth/password-leaks.ts";

describe("console auth protection view contract", () => {
  it("makes the page real and takes the placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("auth-protection");
    expect(isPlaceholder("auth-protection" as never)).toBe(false);
    expect("auth-protection" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "auth-protection": return <AuthProtectionView');
    const navigation = await source("components/console/navigation.ts");
    // Der alte Hinweis versprach drei Dinge; er darf nicht stehen bleiben.
    expect(navigation).not.toContain("Captcha, Passwortprüfung gegen bekannte Lecks, Bot-Abwehr.");
    expect(navigation).toContain('{ id: "auth-protection", label: "Passwortschutz" }');
  });

  it("writes through the one admin route and nowhere else", async () => {
    const view = await source(VIEW);
    expect(view).toContain("/auth/admin/password-protection");
    // Genau ein Schreibverb, und das ist das PUT dieser Route.
    expect([...view.matchAll(/method:\s*"(\w+)"/g)].map((match) => match[1])).toEqual(["PUT"]);
    expect(view).not.toMatch(/\/auth\/(?!admin\/password-protection)/);
    const route = await source(ROUTE);
    expect(route).toContain("adminProjectAuthScope(");
    expect(route).toContain("projectAuthNoStore(");
    expect(route).toContain("hasTrustedOrigin(");
    expect(route).toContain("csrfRejected()");
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PATCH|DELETE)\b/);
    expect(await source("lib/server/project-auth/http.ts")).toContain('"Cache-Control": "private, no-store"');
  });

  it("never takes a password, a digest or a file path anywhere near the console", async () => {
    const view = await source(VIEW);
    for (const forbidden of [
      "password:", "digest", "sha1(", "hash", "LEAKED_PASSWORD_FILE", "readFile",
      "accessToken", "refreshToken", "qk_", "type=\"password\"",
    ]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
    // Die Route hat kein Feld, in das ein Passwort passen wuerde: Ihr Schema
    // nennt genau drei Felder, und keines davon ist ein Passwort.
    const route = await source(ROUTE);
    expect(route).toContain("leakedPasswordCheck: z.boolean()");
    expect(route).toContain("minLength: z.number().int()");
    expect(route).toContain("notice: z.enum(PROJECT_AUTH_PASSWORD_NOTICES)");
    expect(route).toContain(".strict()");
    expect(route).not.toMatch(/password:\s*z\./);
    // Gelesen werden genau die Felder der Route.
    for (const field of [
      "data.protection", "data.defaults", "data.bounds", "data.notices", "data.list",
      "data.configured", "data.updatedAt", "loaded.protection",
    ]) {
      expect(view, field).toContain(field);
    }
  });

  it("puts a full preview in front of every change and never submits straight away", async () => {
    const view = await source(VIEW);
    // Der Knopf, der die Vorschau oeffnet, ruft nicht die Route.
    expect(view).toContain("setPreview(true)");
    // Erst der Knopf in der Vorschau wendet an.
    expect(view).toContain("void apply()");
    expect(view.indexOf("setPreview(true)")).toBeLessThan(view.indexOf("void apply()"));
    expect(view).toContain("AUTH_PROTECTION_WARNING");
    // Jede Aenderung im Formular schliesst die Vorschau wieder, damit nie
    // etwas anderes angewendet wird als das, was in der Vorschau stand.
    expect(view).toContain("setPreview(false); setMessage(\"\");");
    // Die Vorschau nennt jeden der drei Werte vorher und nachher.
    expect(view).toContain("{data.protection.minLength} → {draft.minLength}");
    expect(view).toContain("AUTH_PROTECTION_NOTICE_TEXTS[data.protection.notice])} → {t(AUTH_PROTECTION_NOTICE_TEXTS[draft.notice])}");
    expect(view).toContain('t("Geltende Liste")');
    expect(view).toContain('t("Abbrechen")');
  });

  it("says plainly what the check does, what it reveals and what it does not build", async () => {
    const view = await source(VIEW);
    for (const name of [
      "AUTH_PROTECTION_NO_THIRD_PARTY", "AUTH_PROTECTION_WHERE", "AUTH_PROTECTION_DIGESTS",
      "AUTH_PROTECTION_REVEALS", "AUTH_PROTECTION_WHY_NAMED", "AUTH_PROTECTION_NEVER_LOGGED",
      "AUTH_PROTECTION_FAILURE_MODE", "AUTH_PROTECTION_LIST_FILE", "AUTH_PROTECTION_LIST_FAILURE",
      "AUTH_PROTECTION_BUILT_IN", "AUTH_PROTECTION_BUILT_IN_HONESTY", "AUTH_PROTECTION_MIN_LENGTH",
      "AUTH_PROTECTION_NO_CAPTCHA", "AUTH_PROTECTION_NO_BOT_DEFENCE",
      "AUTH_PROTECTION_NOT_DISTRIBUTED",
    ]) {
      expect(view, name).toContain(name);
    }

    // Der tragende Satz des Slices: kein fremder Dienst, und Have I Been
    // Pwned beim Namen genannt, statt es zu umschreiben.
    expect(AUTH_PROTECTION_NO_THIRD_PARTY).toContain("ausschliesslich lokal");
    expect(AUTH_PROTECTION_NO_THIRD_PARTY).toContain("Have I Been Pwned");
    expect(AUTH_PROTECTION_NO_THIRD_PARTY).toContain("Präfix seines Hashes");
    // Wo durchgesetzt wird, und wo ausdruecklich nicht.
    expect(AUTH_PROTECTION_WHERE).toContain("Registrierung");
    expect(AUTH_PROTECTION_WHERE).toContain("Zurücksetzen");
    expect(AUTH_PROTECTION_WHERE).toContain("Nicht in dieser Console");
    expect(AUTH_PROTECTION_WHERE).toContain("nicht in der Route");
    // Was verglichen wird und wie genau das ist.
    expect(AUTH_PROTECTION_DIGESTS).toContain("SHA-1");
    expect(AUTH_PROTECTION_DIGESTS).toContain("möglicher Treffer");
    // Was eine Ablehnung verraet -- und was sie nicht verraet.
    expect(AUTH_PROTECTION_REVEALS).toContain("aus bekannten Lecks stammt");
    expect(AUTH_PROTECTION_REVEALS).toContain("Nicht, wie oft");
    expect(AUTH_PROTECTION_WHY_NAMED).toContain("handelbar");
    expect(AUTH_PROTECTION_NEVER_LOGGED).toContain("keiner Logzeile");
    expect(AUTH_PROTECTION_FAILURE_MODE).toContain("keine Erlaubnis");
    // Die Liste: Format, Fehlerfall, Quelle.
    expect(AUTH_PROTECTION_LIST_FILE).toContain("QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE");
    expect(AUTH_PROTECTION_LIST_FAILURE).toContain("startet Project Auth nicht");
    expect(AUTH_PROTECTION_BUILT_IN).toContain("25 Einträge");
    expect(AUTH_PROTECTION_BUILT_IN).toContain("SplashData");
    // Und der unbequemste Satz der Seite: Die eingebaute Liste hilft nichts.
    expect(AUTH_PROTECTION_BUILT_IN_HONESTY).toContain("kürzer als die zwölf Zeichen");
    expect(AUTH_PROTECTION_BUILT_IN_HONESTY).toContain("keinen Schutz");
    expect(AUTH_PROTECTION_MIN_LENGTH).toContain("12 und 128");
    // Die beiden Dinge, die der Platzhalter mitversprach und die fehlen.
    expect(AUTH_PROTECTION_NO_CAPTCHA).toContain("Kein Captcha");
    expect(AUTH_PROTECTION_NO_CAPTCHA).toContain("fremden Dienst");
    expect(AUTH_PROTECTION_NO_CAPTCHA).toContain("Browser-Herausforderung");
    expect(AUTH_PROTECTION_NO_BOT_DEFENCE).toContain("Keine Bot-Abwehr");
    expect(AUTH_PROTECTION_NO_BOT_DEFENCE).toContain("Auth → Rate Limits");
    expect(AUTH_PROTECTION_NOT_DISTRIBUTED).toContain("keinen verteilten Angriff");
    expect(AUTH_PROTECTION_WARNING).toContain("Argon2id");

    for (const sentence of [
      AUTH_PROTECTION_NO_THIRD_PARTY, AUTH_PROTECTION_WHERE, AUTH_PROTECTION_DIGESTS,
      AUTH_PROTECTION_REVEALS, AUTH_PROTECTION_WHY_NAMED, AUTH_PROTECTION_NEVER_LOGGED,
      AUTH_PROTECTION_FAILURE_MODE, AUTH_PROTECTION_LIST_FILE, AUTH_PROTECTION_LIST_FAILURE,
      AUTH_PROTECTION_BUILT_IN, AUTH_PROTECTION_BUILT_IN_HONESTY, AUTH_PROTECTION_MIN_LENGTH,
      AUTH_PROTECTION_NO_CAPTCHA, AUTH_PROTECTION_NO_BOT_DEFENCE,
      AUTH_PROTECTION_NOT_DISTRIBUTED, AUTH_PROTECTION_WARNING,
    ]) {
      expect(sentence.length).toBeGreaterThanOrEqual(80);
    }
    for (const state of ["loading", "ready", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
    expect(view).toContain('tAll("Wird gespeichert…", "Jetzt anwenden")');
  });

  it("shows how many entries the list holds and where it came from", async () => {
    const view = await source(VIEW);
    expect(view).toContain("data.list.entries");
    expect(view).toContain("data.list.builtInEntries");
    expect(view).toContain("data.list.builtInSource");
    expect(view).toContain("AUTH_PROTECTION_LIST_SOURCE_TEXTS[data.list.source]");
    // Und die Seite sagt es dort besonders deutlich, wo es zaehlt: wenn der
    // Schalter an ist und trotzdem nur die eingebaute Liste gilt.
    expect(view).toContain('data.list.source === "built_in" && draft.leakedPasswordCheck');
    expect(view).toContain("{toothless &&");
  });

  it("draws the decision from a pure module that knows no database, no network and no colour", async () => {
    const pure = await source(PURE);
    expect(pure).not.toContain("react");
    expect(pure).not.toContain("from \"pg\"");
    expect(pure).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    // Kein Netz und keine Platte: Das Modul importiert genau node:crypto.
    expect([...pure.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]))
      .toEqual(["node:crypto"]);
    for (const forbidden of ["fetch(", "https://", "pwnedpasswords", "node:fs", "node:https"]) {
      expect(pure, forbidden).not.toContain(forbidden);
    }

    const service = await source("lib/server/project-auth/service.ts");
    expect(service).toContain("projectAuthPasswordIsLeaked(");
    expect(service).toContain("parseProjectAuthPasswordProtection(");
    // Beide Stellen, an denen ein Passwort gesetzt wird, und keine dritte.
    expect([...service.matchAll(/this\.assertPasswordProtection\(/g)]).toHaveLength(2);
    expect([...service.matchAll(/passwords\.hash\(/g)]).toHaveLength(2);
    // Der Wortlaut entscheidet ueber den Code, und zwar an genau einer Stelle.
    expect(service).toContain(
      'throw new ProjectAuthError(protection.notice === "named" ? "LEAKED_PASSWORD" : "WEAK_PASSWORD")',
    );
    expect(service).toContain('throw new ProjectAuthError("WEAK_PASSWORD")');
    expect(service).toContain('| "LEAKED_PASSWORD"');
    // Und die Antwort der Route sagt es, mit genau zwei Wortlauten.
    const http = await source("lib/server/project-auth/http.ts");
    expect(http).toContain("Password appears in a known credential leak");
    expect(http).toContain("Password does not meet the policy of this project");
  });

  it("translates every wording, every reason and every sentence into en, fr and it", async () => {
    expect(Object.keys(AUTH_PROTECTION_NOTICE_TEXTS)).toEqual(["named", "generic"]);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = authProtectionTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const view = await source(VIEW);
    const keys = [...view.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)]
      .map((match) => JSON.parse(match[1]) as string);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
