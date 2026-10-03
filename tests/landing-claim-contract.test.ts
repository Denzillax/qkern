import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LANDING_CLAIM, getLandingDictionary } from "@/lib/i18n/landing";
import { LOCALES } from "@/lib/i18n/locales";
import { EASY_NAV, NAV } from "@/components/console/navigation";

/**
 * Der Claim auf dem Hero und der Abschnitt, der ihn einloest (2.141).
 *
 * **Warum ein Vertrag auf einem Werbesatz.** Nicht wegen des Satzes, sondern
 * wegen dreier Eigenschaften, die ohne Pruefung leise verfallen.
 *
 * Erstens steht der Claim an **einer** Stelle. Waere er in den vier
 * Woerterbuechern, haette er vier Gelegenheiten, sich zu unterscheiden, und
 * niemand faellt auf, wenn die franzoesische Fassung eines Tages etwas anderes
 * verspricht als die deutsche.
 *
 * Zweitens darf der Abschnitt darunter keine Zahl selbst schreiben. Er sagt, wie
 * viele Gruppen die beiden Anordnungen haben, und diese Zahl aendert sich mit
 * jedem neuen Menuepunkt. Abgeschrieben wird sie beim naechsten falsch, und zwar
 * auf der Seite, die Kunden lesen.
 *
 * Drittens die Farbe der zweiten Zeile. Gemessen im Browser: `#004dd5` auf dem
 * dunklen Hero `#080f1d` ergibt 2,76 zu 1. Das ist selbst fuer grosse Schrift
 * zu wenig, denn AA verlangt dort 3 zu 1. Der Vertrag rechnet beide Modi mit
 * derselben Formel nach, mit der ich gemessen habe, damit eine kuenftige
 * Farbaenderung nicht wieder in einem der beiden Modi untergeht.
 *
 * **Was er nicht kann.** Er sagt nicht, ob der Satz gut ist, und er rendert
 * nichts. Dass die zwei Zeilen wirklich uebereinander stehen, steht als Regel im
 * Stylesheet und nicht als Bild.
 */
const PAGE = path.resolve(process.cwd(), "app/page.tsx");
const GLOBALS = path.resolve(process.cwd(), "app/globals.css");
const MODULE_CSS = path.resolve(process.cwd(), "app/page.module.css");

/** WCAG 2.1: Kanal linearisieren, gewichten, Verhaeltnis mit 0,05 Offset. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((unit) => (unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("landing claim contract", () => {
  it("keeps the claim in one place and puts it in the hero heading", async () => {
    const page = await readFile(PAGE, "utf8");
    expect(LANDING_CLAIM.simple).toBe("Simple when you want it.");
    expect(LANDING_CLAIM.powerful).toBe("Powerful when you need it.");
    expect(page).toMatch(/<h1 className=\{styles\.claim\}>/);
    expect(page).toContain("{LANDING_CLAIM.simple}");
    expect(page).toContain("{LANDING_CLAIM.powerful}");
    // Und kein Woerterbuch traegt ihn, auch nicht in Teilen.
    for (const locale of LOCALES) {
      const words = JSON.stringify(getLandingDictionary(locale));
      expect(words, `${locale} schreibt den Claim selbst`).not.toContain("when you want it");
      expect(words, `${locale} schreibt den Claim selbst`).not.toContain("when you need it");
    }
  });

  it("explains the claim with both arrangements in all four languages", async () => {
    const german = getLandingDictionary("de");
    for (const locale of LOCALES) {
      const words = getLandingDictionary(locale);
      expect(words.modes.easy.name).toBe("Easy");
      expect(words.modes.advanced.name).toBe("Advanced");
      expect(words.modes.easy.points.length, locale).toBeGreaterThanOrEqual(3);
      expect(words.modes.advanced.points.length, locale).toBeGreaterThanOrEqual(3);
      // Der Satz, dass nichts abgeschaltet ist, ist der Kern der Zusage.
      expect(words.modes.both.length, locale).toBeGreaterThan(40);
      if (locale === "de") continue;
      expect(words.modes.title, `${locale} hat den deutschen Titel`).not.toBe(german.modes.title);
      expect(words.modes.lead, `${locale} hat die deutsche Zeile`).not.toBe(german.modes.lead);
    }
    // Keine Ziffer in den Worten: Die Zahl der Gruppen kommt aus der Navigation.
    for (const locale of LOCALES) {
      const words = getLandingDictionary(locale);
      const prose = [words.modes.title, words.modes.lead, words.modes.both, words.modes.preference,
        ...words.modes.easy.points, ...words.modes.advanced.points].join(" ");
      expect(prose, `${locale} nennt eine Zahl in Worten`).not.toMatch(/\d/);
    }
  });

  it("reads the group counts instead of writing them down", async () => {
    const page = await readFile(PAGE, "utf8");
    // Auch nicht ausgeschrieben: "neun Gruppen" im Hero war genau derselbe
    // Fehler wie eine Ziffer, nur schwerer zu finden. Die Zahl steht an der
    // einen Stelle, die sie liest.
    for (const locale of LOCALES) {
      const hero = getLandingDictionary(locale).hero;
      expect(`${hero.title} ${hero.lead}`.toLowerCase(), `${locale} schreibt eine Gruppenzahl aus`)
        // Ohne Wortgrenzen und mit kleingeschriebenem Text: Beim ersten Versuch
        // stand hier eine Wortgrenze, die als Steuerzeichen in der Datei landete,
        // und die Regel traf damit nichts. Gefunden hat das die Mutationsprobe,
        // die gruen blieb, obwohl "Neun Gruppen" im Hero stand.
        .not.toMatch(/neun|nine|neuf|nove|neunzehn|nineteen|diciannove/);
    }
    expect(page).toContain("EASY_NAV.length");
    expect(page).toContain("NAV.length");
    expect(page, "die Seite schreibt eine Gruppenzahl selbst").not.toMatch(/\d+ (Gruppen|groups)/);
    // Und die beiden Zahlen sind wirklich verschieden, sonst waere der Abschnitt
    // eine Behauptung ohne Unterschied.
    expect(NAV.length).toBeGreaterThan(EASY_NAV.length);
  });

  it("gives the accent line enough contrast in both modes", async () => {
    const css = await readFile(GLOBALS, "utf8");
    const module = await readFile(MODULE_CSS, "utf8");
    expect(module).toMatch(/\.claimStrong \{[^}]*--qkern-accent-text/);

    const tokens = [...css.matchAll(/--qkern-accent-text: (#[0-9a-f]{6});/g)].map((hit) => hit[1]);
    expect(tokens.length, "der Token fehlt in einem der beiden Modi").toBe(2);
    const [light, dark] = tokens;
    // Die Gruende dieser Seite: heller Grund `#f8f9fc`, dunkler Hero `#080f1d`.
    expect(contrast(light, "#f8f9fc")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark, "#080f1d")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every anchor of the page, and adds the new one", async () => {
    const page = await readFile(PAGE, "utf8");
    for (const anchor of ["product", "verification", "ai", "developers", "security", "pricing", "modes"]) {
      expect(page, `Anker ${anchor} fehlt`).toContain(`id="${anchor}"`);
    }
    // Die Kopfzeile zeigt weiter auf die Anker, die es gibt.
    for (const locale of LOCALES) {
      for (const [, target] of getLandingDictionary(locale).header.nav) {
        if (!target.startsWith("/#")) continue;
        expect(page, `${locale}: ${target} hat kein Ziel`).toContain(`id="${target.slice(2)}"`);
      }
    }
  });
});
