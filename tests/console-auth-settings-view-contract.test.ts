import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  AUTH_RETURN_TARGETS_AUDIT,
  AUTH_RETURN_TARGETS_EMPTY,
  AUTH_RETURN_TARGETS_FORM,
  AUTH_RETURN_TARGETS_NARROWING,
  AUTH_RETURN_TARGETS_WARNING,
  AUTH_RETURN_TARGETS_WHAT,
  AUTH_RETURN_TARGETS_WHERE,
  AUTH_RETURN_TARGET_REJECTIONS,
  AUTH_SMTP_CERTIFIED,
  AUTH_SMTP_FIELD_TEXTS,
  AUTH_SMTP_HONESTY,
  AUTH_SMTP_HOW_TO_CHANGE,
  AUTH_SMTP_MODE_TEXTS,
  AUTH_SMTP_NO_SECRET,
  AUTH_SMTP_ORIGIN_TEXTS,
  AUTH_TEMPLATES_HONESTY,
  AUTH_TEMPLATES_HOW_TO_CHANGE,
  AUTH_TEMPLATES_ONE_LANGUAGE,
  AUTH_TEMPLATES_WHAT_VARIES,
  AUTH_TEMPLATE_PURPOSE_TEXTS,
  authSettingsTexts,
} from "@/lib/console/auth-settings-texts";

/**
 * Die drei Auth-Seiten rund um die Anmeldung (2.54): eine mit genau einem
 * Schreibweg und einer vollstaendigen Vorschau davor, zwei ohne jeden —
 * und keine davon mit einem Geheimnis darin.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const TARGETS_VIEW = "components/console/auth-return-targets-view.tsx";
const SMTP_VIEW = "components/console/auth-smtp-view.tsx";
const TEMPLATES_VIEW = "components/console/auth-templates-view.tsx";
const TARGETS_ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/return-targets/route.ts";
const MAIL_ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/mail/route.ts";
const PURE = "lib/server/project-auth/return-targets.ts";

describe("console auth settings view contract", () => {
  it("makes the three pages real and takes the placeholder claims off the navigation", async () => {
    for (const id of ["auth-url", "auth-smtp", "auth-templates"]) {
      expect(REAL_VIEWS).toContain(id);
      expect(isPlaceholder(id as never)).toBe(false);
      expect(id in PLACEHOLDERS).toBe(false);
    }
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "auth-url": return <AuthReturnTargetsView');
    expect(app).toContain('case "auth-smtp": return <AuthSmtpView');
    expect(app).toContain('case "auth-templates": return <AuthTemplatesView');
    const navigation = await source("components/console/navigation.ts");
    expect(navigation).not.toContain("Site-URL und erlaubte Rücksprungziele für Magic Link und OIDC.");
    expect(navigation).not.toContain("Mails gehen heute mit festem Text.");
    expect(navigation).not.toContain("die Einstellung liegt in der Umgebung, nicht in der Console.");
    expect(navigation).toContain('{ id: "auth-url", label: "URL-Konfiguration" }');
    expect(navigation).toContain('{ id: "auth-smtp", label: "SMTP" }');
    expect(navigation).toContain('{ id: "auth-templates", label: "E-Mail-Vorlagen" }');
  });

  it("writes through the one admin route and nowhere else", async () => {
    const view = await source(TARGETS_VIEW);
    expect(view).toContain("/auth/admin/return-targets");
    expect([...view.matchAll(/method:\s*"(\w+)"/g)].map((match) => match[1])).toEqual(["PUT"]);
    expect(view).not.toMatch(/\/auth\/(?!admin\/return-targets)/);
    const route = await source(TARGETS_ROUTE);
    expect(route).toContain("adminProjectAuthScope(");
    expect(route).toContain("projectAuthNoStore(");
    expect(route).toContain("hasTrustedOrigin(");
    expect(route).toContain("csrfRejected()");
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PATCH|DELETE)\b/);
  });

  it("has no write anywhere it would write into nothing", async () => {
    for (const file of [SMTP_VIEW, TEMPLATES_VIEW]) {
      const view = await source(file);
      expect([...view.matchAll(/method:\s*"(\w+)"/g)].map((match) => match[1]), file).toEqual([]);
      // Kein Eingabefeld, kein Speichern-Knopf, auch kein ausgegrauter.
      for (const forbidden of ["<input", "<textarea", "<select", "<form", "onSubmit"]) {
        expect(view, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
    const route = await source(MAIL_ROUTE);
    expect(route).not.toMatch(/export (?:const|function|async function) (?:PUT|POST|PATCH|DELETE)\b/);
    expect(route).toContain("adminProjectAuthScope(");
    expect(route).toContain("projectAuthNoStore(");
  });

  it("shows no password, no connection string and no token", async () => {
    for (const file of [TARGETS_VIEW, SMTP_VIEW, TEMPLATES_VIEW]) {
      const view = await source(file);
      for (const forbidden of [
        "password", "Passwort", "username", "secret", "credential",
        "accessToken", "refreshToken", "qk_", "dsn", "DSN",
      ]) {
        expect(view, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
      // Keine zusammengesetzte Verbindungszeichenkette, auch nicht gebaut.
      expect(view, file).not.toMatch(/smtps?:\/\//);
    }
    const settings = await source("lib/server/project-auth/mail-settings.ts");
    // Der Server liest das Passwort gar nicht erst in den Lesewert hinein.
    expect(settings).not.toContain("QKERN_PROJECT_AUTH_SMTP_PASSWORD?.");
    expect(settings).not.toMatch(/value:\s*env\.QKERN_PROJECT_AUTH_SMTP_(PASSWORD|USERNAME)/);
  });

  it("puts a full preview in front of the one change and never submits straight away", async () => {
    const view = await source(TARGETS_VIEW);
    expect(view).toContain("setPreview(true)");
    expect(view).toContain("void apply()");
    expect(view.indexOf("setPreview(true)")).toBeLessThan(view.indexOf("void apply()"));
    expect(view).toContain("AUTH_RETURN_TARGETS_WARNING");
    for (const row of ["Ziele danach", "Neu hinzu", "Fallen weg"]) {
      expect(view, row).toContain(`t("${row}")`);
    }
    expect(view).toContain('t("Abbrechen")');
    // Die Vorschau nennt jede Herkunft, die wegfaellt, einzeln.
    expect(view).toContain("removed.map(");
  });

  it("says plainly that the list only narrows, and shows the outer bound it narrows", async () => {
    const view = await source(TARGETS_VIEW);
    for (const name of [
      "AUTH_RETURN_TARGETS_WHAT", "AUTH_RETURN_TARGETS_NARROWING", "AUTH_RETURN_TARGETS_EMPTY",
      "AUTH_RETURN_TARGETS_FORM", "AUTH_RETURN_TARGETS_WHERE", "AUTH_RETURN_TARGETS_AUDIT",
    ]) {
      expect(view, name).toContain(name);
    }
    expect(view).toContain("data.outerBound.map(");
    expect(AUTH_RETURN_TARGETS_NARROWING).toContain("nur verengen, nie weiten");
    expect(AUTH_RETURN_TARGETS_EMPTY).toContain("verengt nichts");
    expect(AUTH_RETURN_TARGETS_WHERE).toContain("leitet selbst nie");
    expect(AUTH_RETURN_TARGET_REJECTIONS.outside_outer_bound).toContain("nur verengen");
    for (const sentence of [
      AUTH_RETURN_TARGETS_WHAT, AUTH_RETURN_TARGETS_NARROWING, AUTH_RETURN_TARGETS_EMPTY,
      AUTH_RETURN_TARGETS_FORM, AUTH_RETURN_TARGETS_WHERE, AUTH_RETURN_TARGETS_AUDIT,
      AUTH_RETURN_TARGETS_WARNING,
    ]) {
      expect(sentence.length).toBeGreaterThanOrEqual(80);
    }
  });

  it("says plainly that the mail path lives in the environment and that there are no templates", async () => {
    const smtp = await source(SMTP_VIEW);
    for (const name of ["AUTH_SMTP_HONESTY", "AUTH_SMTP_NO_SECRET", "AUTH_SMTP_HOW_TO_CHANGE", "AUTH_SMTP_CERTIFIED"]) {
      expect(smtp, name).toContain(name);
    }
    const templates = await source(TEMPLATES_VIEW);
    for (const name of [
      "AUTH_TEMPLATES_HONESTY", "AUTH_TEMPLATES_HOW_TO_CHANGE",
      "AUTH_TEMPLATES_ONE_LANGUAGE", "AUTH_TEMPLATES_WHAT_VARIES",
    ]) {
      expect(templates, name).toContain(name);
    }
    expect(AUTH_SMTP_HONESTY).toContain("liest nur");
    expect(AUTH_SMTP_NO_SECRET).toContain("verlässt den Server nie");
    expect(AUTH_TEMPLATES_HONESTY).toContain("keine bearbeitbaren Vorlagen");
    expect(AUTH_TEMPLATES_HOW_TO_CHANGE).toContain("ausliefern");
    expect(AUTH_TEMPLATES_ONE_LANGUAGE).toContain("Englisch");
    for (const sentence of [
      AUTH_SMTP_HONESTY, AUTH_SMTP_NO_SECRET, AUTH_SMTP_HOW_TO_CHANGE, AUTH_SMTP_CERTIFIED,
      AUTH_TEMPLATES_HONESTY, AUTH_TEMPLATES_HOW_TO_CHANGE, AUTH_TEMPLATES_ONE_LANGUAGE,
      AUTH_TEMPLATES_WHAT_VARIES,
    ]) {
      expect(sentence.length).toBeGreaterThanOrEqual(80);
    }
  });

  it("keeps the four states and the stable labels on every page", async () => {
    for (const file of [TARGETS_VIEW, SMTP_VIEW, TEMPLATES_VIEW]) {
      const view = await source(file);
      for (const state of ["loading", "ready", "unavailable", "error"]) {
        expect(view, `${file}: ${state}`).toContain(`"${state}"`);
      }
      expect(view, file).toContain("StableLabel");
      expect(view, file).toContain('tAll("Lädt…", "Neu laden")');
    }
  });

  it("draws the decision from a pure module that knows no database and no colour", async () => {
    const pure = await source(PURE);
    expect(pure).not.toContain("react");
    expect(pure).not.toContain("pg");
    expect(pure).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    const service = await source("lib/server/project-auth/service.ts");
    expect(service).toContain("projectAuthReturnTargetAllowed(");
    expect(service).toContain("parseProjectAuthReturnTargets(");
    // Genau eine Stelle nimmt ein Ruecksprungziel an, und alle fuenf Wege
    // gehen durch sie. Der fuenfte ist SAML (2.99): Wer die Rueckspruenge einer
    // Umgebung verengt, verengt damit auch die des SAML-Weges.
    expect([...service.matchAll(/private async returnTarget\(/g)]).toHaveLength(1);
    expect([...service.matchAll(/await this\.returnTarget\(scope, input\.redirectTo\)/g)]).toHaveLength(5);
    expect(service).not.toContain("allowedRedirectOrigins.has(");
  });

  it("translates every rejection, every mode, every origin and every sentence into en, fr and it", async () => {
    expect(Object.keys(AUTH_SMTP_MODE_TEXTS).sort()).toEqual(["development_noop", "disabled", "smtp"]);
    expect(Object.keys(AUTH_SMTP_ORIGIN_TEXTS).sort()).toEqual(["default", "environment", "unset"]);
    expect(Object.keys(AUTH_SMTP_FIELD_TEXTS).sort())
      .toEqual(["actionBaseUrl", "host", "port", "security", "sender"]);
    expect(Object.keys(AUTH_TEMPLATE_PURPOSE_TEXTS).sort())
      .toEqual(["email_verification", "magic_link", "password_reset"]);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = authSettingsTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
    const keys = new Set<string>();
    for (const file of [TARGETS_VIEW, SMTP_VIEW, TEMPLATES_VIEW]) {
      const view = await source(file);
      for (const match of view.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)) {
        keys.add(JSON.parse(match[1]) as string);
      }
    }
    expect(keys.size).toBeGreaterThan(40);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = [...keys].filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });
});
