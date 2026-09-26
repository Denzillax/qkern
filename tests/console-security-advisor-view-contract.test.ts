import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { SECURITY_CHECK_REASONS, SECURITY_RULE_IDS, SECURITY_RULES } from "@/lib/console/security-advisor-texts";

/**
 * Der Sicherheitsberater (2.39) liest nur. Die Ansicht schreibt nicht, die
 * Route exportiert nur GET, und jede Regel spricht alle vier Sprachen:
 * Deutsch als Schluessel, dazu en, fr und it.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("console security advisor view contract", () => {
  it("is a real view and no longer a placeholder", async () => {
    expect(REAL_VIEWS).toContain("advisors-security");
    expect(isPlaceholder("advisors-security" as never)).toBe(false);
    expect("advisors-security" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "advisors-security": return <SecurityAdvisorView');
  });

  it("only reads, says what it cannot see and keeps the refresh button stable", async () => {
    const view = await source("components/console/security-advisor-view.tsx");
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    expect(view).toContain("/advisors/security`");
    expect(view).toContain("Der Berater prüft nur die aufgeführten Regeln. Was er nicht sieht, steht darunter.");
    expect(view).toContain("Keine Befunde in den geprüften Regeln");
    expect(view).toContain("Was geprüft wurde");
    expect(view).toContain("StableLabel");
    const route = await source("app/api/v1/projects/[projectId]/environments/[environment]/advisors/security/route.ts");
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });

  it("translates every rule and every reason into en, fr and it", () => {
    for (const rule of SECURITY_RULE_IDS) {
      const text = SECURITY_RULES[rule];
      for (const german of [text.title, text.summary, text.remedy, text.reads]) {
        expect(german, rule).toMatch(/\S/);
        for (const locale of ["en", "fr", "it"] as const) {
          expect(CONSOLE_TRANSLATIONS[locale][german], `${locale}: ${rule}`).toMatch(/\S/);
        }
      }
    }
    for (const [reason, german] of Object.entries(SECURITY_CHECK_REASONS)) {
      for (const locale of ["en", "fr", "it"] as const) {
        expect(CONSOLE_TRANSLATIONS[locale][german], `${locale}: ${reason}`).toMatch(/\S/);
      }
    }
  });
});
