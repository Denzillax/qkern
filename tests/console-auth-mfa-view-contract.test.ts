import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  AUTH_MFA_CANNOT_DO,
  AUTH_MFA_DISABLE_WARNING,
  AUTH_MFA_ENABLE_WARNING,
  AUTH_MFA_ENFORCEMENT_HONESTY,
  AUTH_MFA_FACTOR_TEXTS,
  AUTH_MFA_ONLY_TOTP,
  AUTH_MFA_STATE_TEXTS,
  AUTH_MFA_WITHOUT_FACTOR,
  authMfaTexts,
} from "@/lib/console/auth-mfa-texts";

/**
 * Auth → Mehrfaktor (2.52): eine echte Seite mit genau einem Schreibweg,
 * einer vollstaendigen Vorschau davor, keinem Geheimnis darin und vier
 * Sprachen.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

const VIEW = "components/console/auth-mfa-view.tsx";
const ROUTE = "app/api/v1/projects/[projectId]/environments/[environment]/auth/admin/mfa/route.ts";
const PURE = "lib/server/project-auth/mfa-enforcement.ts";

describe("console auth mfa view contract", () => {
  it("makes the page real and takes the placeholder claim off the navigation", async () => {
    expect(REAL_VIEWS).toContain("auth-mfa");
    expect(isPlaceholder("auth-mfa" as never)).toBe(false);
    expect("auth-mfa" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "auth-mfa": return <AuthMfaView');
    const navigation = await source("components/console/navigation.ts");
    expect(navigation).not.toContain("Erzwingen je Projekt und weitere Faktoren fehlen.");
    expect(navigation).toContain('{ id: "auth-mfa", label: "Mehrfaktor" }');
  });

  it("writes through the one admin route and nowhere else", async () => {
    const view = await source(VIEW);
    expect(view).toContain("/auth/admin/mfa");
    // Genau ein Schreibverb, und das ist das PUT dieser Route.
    expect([...view.matchAll(/method:\s*"(\w+)"/g)].map((match) => match[1])).toEqual(["PUT"]);
    expect(view).not.toMatch(/\/auth\/(?!admin\/mfa)/);
    const route = await source(ROUTE);
    expect(route).toContain("adminProjectAuthScope(");
    expect(route).toContain("projectAuthNoStore(");
    expect(route).toContain("hasTrustedOrigin(");
    expect(route).toContain("csrfRejected()");
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PATCH|DELETE)\b/);
    expect(await source("lib/server/project-auth/http.ts")).toContain('"Cache-Control": "private, no-store"');
  });

  it("shows no secret, no recovery code and no token", async () => {
    const view = await source(VIEW);
    for (const forbidden of ["secret", "recoveryCode", "recovery_code", "challengeToken", "enrollmentToken", "accessToken", "refreshToken", "qk_", "otpauth"]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
    // Gelesen werden genau die sechs Felder der Route.
    for (const field of ["policy.required", "policy.users", "policy.enrolled", "policy.notEnrolled", "policy.updatedAt", "policy.factors"]) {
      expect(view, field).toContain(field);
    }
    for (const field of ["email", "actorRef", "metadata"]) {
      expect(view, field).not.toContain(field);
    }
  });

  it("puts a full preview in front of every change and never submits straight away", async () => {
    const view = await source(VIEW);
    // Der Knopf, der die Vorschau oeffnet, ruft nicht die Route.
    expect(view).toContain("setPreview(!policy.required)");
    // Erst der Knopf in der Vorschau wendet an.
    expect(view).toContain("void apply(target)");
    expect(view.indexOf("setPreview(!policy.required)")).toBeLessThan(view.indexOf("void apply(target)"));
    expect(view).toContain("AUTH_MFA_ENABLE_WARNING");
    expect(view).toContain("AUTH_MFA_DISABLE_WARNING");
    // Die Vorschau nennt die Zahlen, um die es geht.
    for (const row of ["App-Nutzer in dieser Umgebung", "Davon mit bestätigtem Faktor", "Davon ohne Faktor, müssen ihn zuerst einrichten"]) {
      expect(view, row).toContain(`t("${row}")`);
    }
    expect(view).toContain('t("Abbrechen")');
  });

  it("says plainly what enforcement does, what happens without a factor, and that only TOTP exists", async () => {
    const view = await source(VIEW);
    for (const name of ["AUTH_MFA_ENFORCEMENT_HONESTY", "AUTH_MFA_WITHOUT_FACTOR", "AUTH_MFA_ONLY_TOTP", "AUTH_MFA_CANNOT_DO"]) {
      expect(view, name).toContain(name);
    }
    expect(AUTH_MFA_ENFORCEMENT_HONESTY).toContain("keine brauchbare Sitzung");
    expect(AUTH_MFA_WITHOUT_FACTOR).toContain("Einrichtungsschein");
    expect(AUTH_MFA_ONLY_TOTP).toContain("WebAuthn");
    expect(AUTH_MFA_ONLY_TOTP).toContain("Passkeys");
    expect(Object.keys(AUTH_MFA_FACTOR_TEXTS)).toEqual(["totp"]);
    for (const sentence of [AUTH_MFA_ENFORCEMENT_HONESTY, AUTH_MFA_WITHOUT_FACTOR, AUTH_MFA_ONLY_TOTP, AUTH_MFA_ENABLE_WARNING, AUTH_MFA_DISABLE_WARNING, AUTH_MFA_CANNOT_DO]) {
      expect(sentence.length).toBeGreaterThanOrEqual(80);
    }
    for (const state of ["loading", "ready", "unavailable", "error"]) {
      expect(view, state).toContain(`"${state}"`);
    }
    expect(view).toContain("StableLabel");
    expect(view).toContain('tAll("Lädt…", "Neu laden")');
    expect(view).toContain('tAll("Erzwingen aufheben", "Erzwingen einschalten")');
  });

  it("draws the decision from a pure module that knows no database and no colour", async () => {
    const pure = await source(PURE);
    expect(pure).not.toContain("react");
    expect(pure).not.toContain("pg");
    expect(pure).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    const service = await source("lib/server/project-auth/service.ts");
    expect(service).toContain("projectAuthMfaOutcome(");
    expect(service).toContain("projectAuthSessionUsable(");
    // Alle drei Stellen, an denen eine Sitzung brauchbar wird.
    expect([...service.matchAll(/projectAuthSessionUsable\(/g)]).toHaveLength(2);
    expect(service).toContain('throw new ProjectAuthError("MFA_REQUIRED")');
  });

  it("translates every state, every factor and every sentence into en, fr and it", async () => {
    expect(Object.keys(AUTH_MFA_STATE_TEXTS).sort()).toEqual(["optional", "required"]);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = authMfaTexts().filter((key) => !(CONSOLE_TRANSLATIONS[locale][key] ?? "").trim());
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
