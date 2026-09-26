import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import {
  healthAdvisorTexts,
  HEALTH_DETAILS,
  HEALTH_MEASURES,
  HEALTH_STATES,
  HEALTH_STATE_TEXTS,
  HEALTH_SUBSYSTEMS,
  HEALTH_SUBSYSTEM_IDS,
} from "@/lib/console/health-advisor-texts";

/**
 * Die Projekt-Gesundheit (2.44) liest nur. Die Ansicht schreibt nicht, die
 * Route exportiert nur GET, jeder Text spricht alle vier Sprachen, und kein
 * Feld der Antwort koennte ein Geheimnis tragen.
 */
async function source(file: string) {
  return await readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("console health advisor view contract", () => {
  it("is a real view and no longer a placeholder", async () => {
    expect(REAL_VIEWS).toContain("advisors-health");
    expect(isPlaceholder("advisors-health" as never)).toBe(false);
    expect("advisors-health" in PLACEHOLDERS).toBe(false);
    const app = await source("components/console/console-app.tsx");
    expect(app).toContain('case "advisors-health": return <HealthAdvisorView');
  });

  it("only reads, keeps the refresh button stable and says what it cannot promise", async () => {
    const view = await source("components/console/health-advisor-view.tsx");
    expect(view).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    expect(view).toContain("/advisors/health`");
    expect(view).toContain("Gesund heisst hier: erreichbar und eingerichtet. Ob deine Anwendung funktioniert, sagt diese Seite nicht.");
    expect(view).toContain("Was nicht geprüft werden konnte");
    expect(view).toContain("Gesamturteil");
    expect(view).toContain("StableLabel");
    const route = await source("app/api/v1/projects/[projectId]/environments/[environment]/advisors/health/route.ts");
    expect(route).not.toMatch(/export (?:const|function|async function) (?:POST|PUT|PATCH|DELETE)\b/);
    expect(route).toContain('"Cache-Control": "private, no-store"');
    // Jede Probe liest; keine schreibt, loescht oder ruft etwas auf.
    expect(route).not.toMatch(/\.(?:create|update|delete|invoke|enqueue|dispatch|write)[A-Z(]/);
  });

  it("translates every state, subsystem, detail and measure into en, fr and it", () => {
    for (const german of healthAdvisorTexts()) {
      expect(german).toMatch(/\S/);
      for (const locale of ["en", "fr", "it"] as const) {
        expect(CONSOLE_TRANSLATIONS[locale][german], `${locale}: ${german}`).toMatch(/\S/);
      }
    }
    expect(Object.keys(HEALTH_SUBSYSTEMS).sort()).toEqual([...HEALTH_SUBSYSTEM_IDS].sort());
    expect(Object.keys(HEALTH_STATE_TEXTS).sort()).toEqual([...HEALTH_STATES].sort());
  });

  /**
   * Der strukturelle Teil der Geheimhaltung: Ein Befund besteht aus einem
   * Schluessel dieser beiden Tabellen und hoechstens einer Zahl. Keiner dieser
   * Texte traegt einen Platzhalter, in den eine Variable laufen koennte, und
   * keiner traegt schon selbst etwas, das wie ein Wert aussieht. Die Woerter
   * "Token" und "Secret" duerfen vorkommen: Sie benennen dort, was die Seite
   * gerade **nicht** zeigt.
   */
  it("keeps every answerable text free of a slot a value could slip into", async () => {
    const slot = /(?:\$\{|%s|\{\{|\{[a-z]|:\/\/|\bqk_|\bBearer\b|[0-9a-f]{16})/i;
    for (const text of [...Object.values(HEALTH_DETAILS), ...Object.values(HEALTH_MEASURES)]) {
      expect(slot.test(text), text).toBe(false);
    }
    // Das Regelmodul bildet den Beleg nur aus diesen Schluesseln; die Ansicht
    // setzt davor hoechstens eine Zahl.
    const rules = await source("lib/server/advisors/health-rules.ts");
    expect(rules).toContain("label: HEALTH_MEASURES[measure]");
    expect(rules).toContain("detail: HEALTH_DETAILS[detail]");
    expect(rules).not.toMatch(/`[^`]*\$\{/);
    // Secrets darf nur als Verweis auf die andere Seite vorkommen, nie als Wert.
    expect(HEALTH_DETAILS.vaultConnected).toContain("Functions & Jobs");
  });

  it("names the health route in the OpenAPI contract and in the handbook", async () => {
    const openapi = await source("lib/openapi.ts");
    expect(openapi).toContain('advisors/health"');
    expect(openapi).toContain("ProjectHealthAdvisorResponse");
    const handbook = await source("docs/HANDBUCH.md");
    expect(handbook).toContain("### Projekt-Gesundheit");
    expect(handbook).toContain("Seit `2.44.0`");
  });
});
