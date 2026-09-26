import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import { NAV, PLACEHOLDERS } from "@/components/console/navigation";
import { securityAdvisorTexts } from "@/lib/console/security-advisor-texts";
import { performanceAdvisorTexts } from "@/lib/console/performance-advisor-texts";

/**
 * Die Console spricht vier Sprachen (2.3). Der Schluessel jeder Uebersetzung
 * ist der deutsche Text im Code. Der Vertrag liest alle `t("...")`-Aufrufe
 * aus `console-app.tsx` und alle Labels und Erklaerungen der Navigation und
 * verlangt fuer jeden eine englische, franzoesische und italienische
 * Uebersetzung. Fehlt eine, faellt der Text stumm auf Deutsch zurueck —
 * genau das soll hier auffallen.
 */
async function consoleKeys(): Promise<string[]> {
  // Jede Ansicht der Console liegt als .tsx in diesem Ordner (seit 2.6 auch
  // ausserhalb von console-app.tsx); alle werden gelesen.
  const dir = path.resolve(process.cwd(), "components/console");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".tsx"));
  const keys = new Set<string>();
  for (const name of files) {
    const source = await readFile(path.join(dir, name), "utf8");
    for (const match of source.matchAll(/(?<![A-Za-z0-9_])t\(("(?:[^"\\]|\\.)*")\)/g)) keys.add(JSON.parse(match[1]) as string);
  }
  for (const group of NAV) { keys.add(group.label); for (const child of group.children ?? []) keys.add(child.label); }
  for (const entry of Object.values(PLACEHOLDERS)) { keys.add(entry.label); keys.add(entry.note); }
  // Die Texte des Sicherheitsberaters (2.39) kommen vom Server und laufen als t(variable) durch die Ansicht.
  for (const text of securityAdvisorTexts()) keys.add(text);
  // Dieselbe Lage beim Leistungsberater (2.40).
  for (const text of performanceAdvisorTexts()) keys.add(text);
  return [...keys];
}

describe("console i18n contract", () => {
  it("translates every console text into en, fr and it", async () => {
    const keys = await consoleKeys();
    expect(keys.length).toBeGreaterThan(400);
    for (const locale of ["en", "fr", "it"] as const) {
      const missing = keys.filter((key) => !(key in CONSOLE_TRANSLATIONS[locale]) || CONSOLE_TRANSLATIONS[locale][key].trim() === "");
      expect(missing, `${locale}: ${missing.length} Texte ohne Uebersetzung`).toEqual([]);
    }
  });

  it("carries no translation for a text that no longer exists", async () => {
    const keys = new Set(await consoleKeys());
    for (const locale of ["en", "fr", "it"] as const) {
      const stale = Object.keys(CONSOLE_TRANSLATIONS[locale]).filter((key) => !keys.has(key));
      expect(stale, `${locale}: verwaiste Uebersetzungen`).toEqual([]);
    }
  });

  it("keeps placeholders and ellipses aligned with the German source", async () => {
    for (const locale of ["en", "fr", "it"] as const) {
      for (const [key, value] of Object.entries(CONSOLE_TRANSLATIONS[locale])) {
        expect(value.endsWith("…"), `${locale}: ${key}`).toBe(key.endsWith("…"));
        expect(value.startsWith(" "), `${locale}: ${key}`).toBe(key.startsWith(" "));
      }
    }
  });
});
