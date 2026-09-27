import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  AUTH_RATE_LIMITS_FAILURE_MODE,
  AUTH_RATE_LIMITS_HASHED,
  AUTH_RATE_LIMITS_KEY,
  AUTH_RATE_LIMITS_NOT_A_LOCKOUT,
  AUTH_RATE_LIMITS_NOT_DISTRIBUTED,
  AUTH_RATE_LIMITS_REFRESH_SCOPE,
  AUTH_RATE_LIMITS_TELLS_NOTHING,
  AUTH_RATE_LIMITS_WARNING,
  AUTH_RATE_LIMITS_WHERE,
  AUTH_RATE_LIMIT_KIND_TEXTS,
  authRateLimitTexts,
} from "@/lib/console/auth-rate-limits-texts";

/**
 * Auth → Rate Limits (2.56): eine echte Seite mit genau einem Schreibweg,
 * einer vollstaendigen Vorschau davor, keinem Schluessel darin und vier
 * Sprachen — und mit Saetzen, die sagen, wogegen eine Grenze nicht hilft.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/auth-rate-limits-view.tsx";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/rate-limits/route.ts";
const PURE = "lib/server/project-auth/rate-limits.ts";

describe("console auth rate limits view contract", () => {
  it("makes the page real and takes the placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("auth-rate-limits");
    expect(isPlaceholder("auth-rate-limits" as never)).toBe(false);
    expect("auth-rate-limits" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "auth-rate-limits": return <AuthRateLimitsView');
    const navigation = await source("components/console/navigation.ts");
    expect(navigation).not.toContain("Grenzen für Anmeldungen, Mails und Token je Zeitfenster.");
    expect(navigation).toContain('{ id: "auth-rate-limits", label: "Rate Limits" }');
  });

  it("writes through the one admin route and nowhere else", async () => {
    const view = await source(VIEW);
    expect(view).toContain("/auth/admin/rate-limits");
    // Genau ein Schreibverb, und das ist das PUT dieser Route.
    expect([...view.matchAll(/method:\s*"(\w+)"/g)].map((match) => match[1])).toEqual(["PUT"]);
    expect(view).not.toMatch(/\/auth\/(?!admin\/rate-limits)/);
    const route = await source(ROUTE);
    expect(route).toContain("adminProjectAuthScope(");
    expect(route).toContain("projectAuthNoStore(");
    expect(route).toContain("hasTrustedOrigin(");
    expect(route).toContain("csrfRejected()");
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PATCH|DELETE)\b/);
    expect(await source("lib/server/project-auth/http.ts")).toContain('"Cache-Control": "private, no-store"');
  });

  it("shows no key, no hash and no counter state", async () => {
    const view = await source(VIEW);
    for (const forbidden of [
      "subjectHash", "subject_hash", "hash", "email", "ipAddress", "attempts",
      "accessToken", "refreshToken", "qk_",
    ]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
    // Gelesen werden genau die sechs Felder der Route.
    for (const field of ["data.limits", "data.defaults", "data.bounds", "data.configured", "data.updatedAt", "loaded.limits"]) {
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
    expect(view).toContain("AUTH_RATE_LIMITS_WARNING");
    // Jede Aenderung im Formular schliesst die Vorschau wieder, damit nie
    // etwas anderes angewendet wird als das, was in der Vorschau stand.
    expect(view).toContain("setPreview(false); setMessage(\"\");");
    // Die Vorschau nennt jede der sechs Zahlen vorher und nachher.
    expect(view).toContain("data.limits[kind].max}/{data.limits[kind].windowSeconds}s → {draft[kind].max}/{draft[kind].windowSeconds}s");
    for (const row of ["Arten, die sich ändern", "Davon strenger als bisher"]) {
      expect(view, row).toContain(`t("${row}")`);
    }
    expect(view).toContain('t("Abbrechen")');
  });

  it("says plainly what a limit does and what it does not protect against", async () => {
    const view = await source(VIEW);
    for (const name of [
      "AUTH_RATE_LIMITS_KEY", "AUTH_RATE_LIMITS_HASHED", "AUTH_RATE_LIMITS_WHERE",
      "AUTH_RATE_LIMITS_TELLS_NOTHING", "AUTH_RATE_LIMITS_FAILURE_MODE",
      "AUTH_RATE_LIMITS_NOT_DISTRIBUTED", "AUTH_RATE_LIMITS_NOT_A_LOCKOUT",
      "AUTH_RATE_LIMITS_REFRESH_SCOPE",
    ]) {
      expect(view, name).toContain(name);
    }
    // Der ehrlichste Satz der Seite nennt den verteilten Angriff beim Namen
    // und sagt, was stattdessen helfen wuerde.
    expect(AUTH_RATE_LIMITS_NOT_DISTRIBUTED).toContain("verteilten Angriff");
    expect(AUTH_RATE_LIMITS_NOT_DISTRIBUTED).toContain("Captcha");
    expect(AUTH_RATE_LIMITS_NOT_A_LOCKOUT).toContain("keine Kontosperre");
    expect(AUTH_RATE_LIMITS_REFRESH_SCOPE).toContain("Sitzungsfamilie");
    // Und die beiden Saetze, um die es beim Zaehlen geht.
    expect(AUTH_RATE_LIMITS_KEY).toContain("Nicht nach IP-Adresse");
    expect(AUTH_RATE_LIMITS_HASHED).toContain("SHA-256");
    expect(AUTH_RATE_LIMITS_WHERE).toContain("PostgreSQL");
    expect(AUTH_RATE_LIMITS_TELLS_NOTHING).toContain("dieselbe für eine bekannte und eine unbekannte Adresse");
    expect(AUTH_RATE_LIMITS_FAILURE_MODE).toContain("geschlossen");
    expect(AUTH_RATE_LIMITS_FAILURE_MODE).toContain("geöffnet");
    for (const sentence of [
      AUTH_RATE_LIMITS_KEY, AUTH_RATE_LIMITS_HASHED, AUTH_RATE_LIMITS_WHERE,
      AUTH_RATE_LIMITS_TELLS_NOTHING, AUTH_RATE_LIMITS_FAILURE_MODE,
      AUTH_RATE_LIMITS_NOT_DISTRIBUTED, AUTH_RATE_LIMITS_NOT_A_LOCKOUT,
      AUTH_RATE_LIMITS_REFRESH_SCOPE, AUTH_RATE_LIMITS_WARNING,
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

  it("draws the decision from a pure module that knows no database and no colour", async () => {
    const pure = await source(PURE);
    expect(pure).not.toContain("react");
    expect(pure).not.toContain("from \"pg\"");
    expect(pure).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    const service = await source("lib/server/project-auth/service.ts");
    expect(service).toContain("projectAuthRateAllowed(");
    expect(service).toContain("projectAuthRateWindowStart(");
    expect(service).toContain("projectAuthRateSubjectHash(");
    // Alle sechs Stellen, an denen eine Grenze wirklich greift: Registrierung,
    // Magic Link, Passwort zuruecksetzen, Anmeldung mit Passwort, Anmeldung mit
    // Passkey (2.79, nach Kennung gezaehlt) und Erneuerung.
    expect([...service.matchAll(/this\.assertStoredRateLimit\(/g)]).toHaveLength(6);
    expect(service).toContain('throw new ProjectAuthError("RATE_LIMITED", retryAfterSeconds)');
    // Die Zaehlung geht durch das Repository und nicht an einem Zaehler im
    // Prozessspeicher vorbei.
    expect(service).toContain("repository.countRateLimitAttempt(");
  });

  it("translates every kind, every reason and every sentence into en, fr and it", async () => {
    expect(Object.keys(AUTH_RATE_LIMIT_KIND_TEXTS)).toEqual(["sign_in", "mail", "refresh"]);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = authRateLimitTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
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
