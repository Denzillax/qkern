import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LANDING } from "@/lib/i18n/landing";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * Kein deutscher Text in den Bausteinen der Website.
 *
 * Die Console hat seit 2.3 einen Vertrag, der jeden Text durch `t()` zwingt.
 * Die Website hatte keinen, und beim ersten Besuch im Browser stand auf der
 * **englischen** Startseite am Themenknopf "Dark Mode aktivieren" und an
 * beiden Navigationen `aria-label="Hauptnavigation"`. Sichtbar war davon
 * nichts; ein Screenreader las es vor, und der Render-Vertrag erreicht diese
 * Bausteine nicht, weil sie keine Konsolenansichten sind.
 *
 * Geprueft wird die Stelle, an der es passiert: ein deutsches Wort, das als
 * Zeichenkette direkt in einem `aria-label`, `title` oder `placeholder` eines
 * Website-Bausteins steht. Uebersetzungen gehoeren in `lib/i18n/landing.ts`,
 * und die vier Woerterbuecher muessen dieselben Schluessel tragen.
 */

/** Nur die Bausteine der Website. Die Console hat ihren eigenen Vertrag. */
const DIR = "components";
const SKIP = new Set(["console"]);

/**
 * Woerter, die es so nur im Deutschen gibt. Eine Liste statt einer Heuristik,
 * weil "Menu", "Navigation" und "Mode" in mehreren Sprachen gleich aussehen
 * und eine Heuristik hier nur falsch anschlagen wuerde.
 */
const GERMAN = [
  "aktivieren", "Hauptnavigation", "waehlen", "wählen", "oeffnen", "öffnen",
  "schliessen", "schließen", "Einstellungen", "Anmelden", "Abmelden", "Zurueck", "Zurück",
];

const ATTRIBUTE = /(?:aria-label|title|placeholder)=\{?"([^"]+)"/g;

async function siteFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...await siteFiles(full)); continue; }
    if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("site labels contract", () => {
  it("keeps German out of the site components", async () => {
    const found: string[] = [];
    for (const file of await siteFiles(DIR)) {
      const text = await readFile(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        for (const match of lines[i].matchAll(ATTRIBUTE)) {
          const value = match[1];
          if (GERMAN.some((word) => value.includes(word))) found.push(`${file}:${i + 1}: "${value}"`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("gives every header label all four languages", async () => {
    const keys = Object.keys(LANDING.de.header).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(LANDING[locale].header).sort(), locale).toEqual(keys);
      for (const key of keys) {
        const value = LANDING[locale].header[key as keyof typeof LANDING.de.header];
        // `nav` ist eine Liste, alles andere ein Satz. Beide duerfen nicht leer
        // sein: Ein leeres `aria-label` ist schlimmer als ein deutsches, weil
        // der Screenreader dann gar nichts sagt.
        if (Array.isArray(value)) expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
        else expect(String(value).trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});
