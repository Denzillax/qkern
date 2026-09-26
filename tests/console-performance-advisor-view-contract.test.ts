import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { PERFORMANCE_CHECK_REASONS, PERFORMANCE_RULE_IDS, PERFORMANCE_RULES } from "@/lib/console/performance-advisor-texts";

/**
 * Der Leistungsberater (2.40) liest nur. Die Ansicht schreibt nicht, die
 * Route exportiert nur GET, und jede Regel spricht alle vier Sprachen:
 * Deutsch als Schluessel, dazu en, fr und it.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("console performance advisor view contract", () => {
  it("is a real view and no longer a placeholder", async () => {
    expect(REAL_VIEWS).toContain("advisors-performance");
    expect(isPlaceholder("advisors-performance" as never)).toBe(false);
    expect("advisors-performance" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "advisors-performance": return <PerformanceAdvisorView');
  });

  it("only reads, says what it needs and keeps the refresh button stable", async () => {
    const view = await source("components/console/performance-advisor-view.tsx");
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    expect(view).toContain("/advisors/performance`");
    expect(view).toContain("Der Berater prüft nur die aufgeführten Regeln, und er braucht Statistiken aus dem Betrieb. Eine frische Datenbank hat noch keine.");
    expect(view).toContain("Keine Befunde in den geprüften Regeln");
    expect(view).toContain("Was geprüft wurde");
    expect(view).toContain("StableLabel");
    const route = await source("app/api/v1/projects/[projectId]/environments/[environment]/advisors/performance/route.ts");
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain('"Cache-Control": "private, no-store"');
    // Kein Zuruecksetzen eines Zaehlers, nirgends.
    for (const file of [view, route, await source("lib/server/data-plane/service.ts")]) {
      expect(file).not.toContain("pg_stat_statements_reset");
      expect(file).not.toContain("pg_stat_reset");
    }
  });

  it("translates every rule and every reason into en, fr and it", () => {
    for (const rule of PERFORMANCE_RULE_IDS) {
      const text = PERFORMANCE_RULES[rule];
      for (const german of [text.title, text.summary, text.remedy, text.reads]) {
        expect(german, rule).toMatch(/\S/);
        for (const locale of ["en", "fr", "it"] as const) {
          expect(CONSOLE_TRANSLATIONS[locale][german], `${locale}: ${rule}`).toMatch(/\S/);
        }
      }
    }
    for (const [reason, german] of Object.entries(PERFORMANCE_CHECK_REASONS)) {
      for (const locale of ["en", "fr", "it"] as const) {
        expect(CONSOLE_TRANSLATIONS[locale][german], `${locale}: ${reason}`).toMatch(/\S/);
      }
    }
  });
});
