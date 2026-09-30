import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { LANDING } from "@/lib/i18n/landing";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * Wer sich vertippt, findet zurueck.
 *
 * Bis zum ersten Besuch im Browser gab es `app/not-found.tsx` nicht, und
 * Next.js zeigte seine Vorgabe: „404 — This page could not be found.", ohne
 * Kopf, ohne Navigation und ohne einen einzigen Link. Drei Fehler in einer
 * Seite: kein Weg zurueck, der Satz in allen vier Sprachen auf Englisch, und
 * im Tab der deutsche Titel der Startseite, waehrend `lang` auf `en` stand.
 *
 * Kein bestehender Test konnte das sehen. Eine fehlende Route hat keine
 * Komponente, die der Render-Vertrag rendern koennte, und die Vorgabe kommt
 * aus dem Framework, nicht aus diesem Quelltext. Geprueft wird darum, dass es
 * die Seite gibt, dass sie den Kopf traegt, dass sie mindestens einen Weg
 * zurueck anbietet und dass ihre Texte in allen vier Sprachen stehen.
 */

describe("not found contract", () => {
  it("gives the page a header and a way back", async () => {
    const page = await readFile("app/not-found.tsx", "utf8");
    // Der Kopf bringt Navigation, Sprachwahl und Themenschalter mit. Ohne ihn
    // ist die Seite eine Sackgasse.
    //
    // Geprueft wird die **Verwendung**, nicht der Import. Die erste Fassung
    // stand auf `toContain("SiteHeader")`, und eine Mutationsprobe, die das
    // Element aus dem Baum nahm, liess den Vertrag gruen: Die Import-Zeile
    // enthaelt den Namen ja weiterhin. Dieselbe Klasse wie die zu lockere
    // Erwartung in `(2.101)`.
    expect(page).toMatch(/<SiteHeader\s*\/>/);
    // Mindestens ein Link, der wirklich irgendwohin fuehrt.
    expect(page).toMatch(/href="\/"/);
    // Der Titel kommt aus dem Woerterbuch, nicht aus dem Wurzel-Layout. Sonst
    // steht im Tab der Titel der Startseite.
    expect(page).toContain("generateMetadata");
    expect(page).toContain("notFound");
    // Kein fest verdrahteter Satz: alles ueber das Woerterbuch.
    expect(page).not.toMatch(/>[A-Za-zÄÖÜäöü][^<>{}]{12,}</);
  });

  it("says it in all four languages", async () => {
    const keys = Object.keys(LANDING.de.notFound).sort();
    expect(keys).toEqual(["docs", "heading", "home", "lead", "title"]);
    for (const locale of LOCALES) {
      const entry = LANDING[locale].notFound;
      expect(Object.keys(entry).sort(), locale).toEqual(keys);
      for (const key of keys) {
        const value = entry[key as keyof typeof entry];
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
    // Und sie sagen es wirklich verschieden. Vier gleiche Zeichenketten waeren
    // vier fehlende Uebersetzungen, die der Test oben nicht bemerkt.
    const headings = new Set(LOCALES.map((locale) => LANDING[locale].notFound.heading));
    expect(headings.size).toBe(LOCALES.length);
  });
});
