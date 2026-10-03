import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { PRICING, getPricingDictionary, type PricingDictionary } from "@/lib/i18n/pricing";
import {
  PRICING_PLANS,
  PRICING_PLAN_IDS,
  PRICING_CURRENCY,
  formatPlanAmount,
  formatPlanPrice,
} from "@/lib/pricing/plans";

/**
 * Was die Preisseite zusagt (2.135).
 *
 * Eine Preisseite ist die eine Seite, auf der ein Fehler Geld kostet oder
 * Vertrauen. Dieser Vertrag haelt sechs Zusagen fest:
 *
 * 1. Die Reihenfolge der Tarife steht fest, von Free bis Business.
 * 2. Genau ein Tarif traegt "Most Popular". Zwei Hervorhebungen heben nichts
 *    hervor.
 * 3. Jeder Preis steht in Franken und in genau der Form, die die Seite zeigt.
 * 4. Nirgends steht ein literaler Grenzwert, solange die Tariflimits offen
 *    sind. Eine erfundene Zahl waere ein Versprechen.
 * 5. Alle vier Sprachen sind vollstaendig, keine kopiert die deutsche Vorlage.
 * 6. Business ist nicht direkt waehlbar und fuehrt in kein Bestellformular.
 */

const SOURCE_FILES = ["app/pricing/page.tsx", "lib/pricing/plans.ts", "lib/i18n/pricing.ts"];

async function readSource(relative: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relative), "utf8");
}

type Leaf = { path: string; value: string };

function leaves(value: unknown, at = ""): Leaf[] {
  if (typeof value === "string") return [{ path: at, value }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => leaves(entry, `${at}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, entry]) => leaves(entry, at ? `${at}.${key}` : key));
  return [];
}

describe("pricing page contract", () => {
  it("keeps the five plans in the ordered sequence", () => {
    expect(PRICING_PLANS.map((plan) => plan.id)).toEqual(["free", "launch", "pro", "scale", "business"]);
    expect(PRICING_PLAN_IDS).toEqual(["free", "launch", "pro", "scale", "business"]);
    // Die Preise steigen streng, damit die Reihenfolge der Karten mit der
    // Reihenfolge der Betraege uebereinstimmt.
    const amounts = PRICING_PLANS.map((plan) => plan.monthlyMicros);
    for (let index = 1; index < amounts.length; index += 1) {
      expect(amounts[index] > amounts[index - 1], `Tarif ${PRICING_PLANS[index].id} ist nicht teurer als der davor`).toBe(true);
    }
    for (const locale of LOCALES) {
      const dictionary = getPricingDictionary(locale);
      expect(PRICING_PLAN_IDS.map((id) => dictionary.plans[id].name)).toEqual(["Free", "Launch", "Pro", "Scale", "Business"]);
    }
  });

  it("marks exactly one plan as Most Popular, and it is Pro", () => {
    const featured = PRICING_PLANS.filter((plan) => plan.mostPopular);
    expect(featured.map((plan) => plan.id)).toEqual(["pro"]);
    for (const locale of LOCALES) {
      expect(getPricingDictionary(locale).words.badge).toBe("Most Popular");
    }
  });

  it("states every price in CHF, in the form the page shows", async () => {
    expect(PRICING_CURRENCY).toBe("CHF");
    const expected: Record<string, string> = { free: "CHF 0", launch: "CHF 9", pro: "CHF 29", scale: "CHF 79", business: "CHF 199" };
    for (const plan of PRICING_PLANS) {
      expect(formatPlanAmount(plan.monthlyMicros)).toBe(expected[plan.id]);
    }
    expect(formatPlanPrice(PRICING_PLANS[2], { from: "ab", perMonth: "/ Monat" })).toBe("CHF 29 / Monat");
    expect(formatPlanPrice(PRICING_PLANS[4], { from: "ab", perMonth: "/ Monat" })).toBe("ab CHF 199 / Monat");

    for (const locale of LOCALES) {
      const dictionary = getPricingDictionary(locale);
      for (const plan of PRICING_PLANS) {
        const line = formatPlanPrice(plan, { from: dictionary.words.from, perMonth: dictionary.words.perMonth });
        expect(line, `${locale} ${plan.id}`).toMatch(/CHF \d{1,3}(\.\d\d)?/);
        expect(line.endsWith(dictionary.words.perMonth), `${locale} ${plan.id}: Einheit fehlt`).toBe(true);
        expect(line.startsWith(`${dictionary.words.from} `), `${locale} ${plan.id}: "ab" steht falsch`).toBe(plan.fromPrice);
        // Keine zweite Waehrung, auch nicht als Zeichen.
        expect(line).not.toMatch(/USD|EUR|\$|€|\bFr\./);
      }
    }
  });

  it("never writes a literal amount or a made-up limit into the sources", async () => {
    for (const relative of SOURCE_FILES) {
      const source = await readSource(relative);
      const body = relative === "lib/pricing/plans.ts"
        // Nur in `plans.ts` darf ein Betrag stehen, denn dort ist seine eine
        // Stelle. Die Kommentare dieser Datei nennen Beispielbetraege, also
        // pruefen wir hier den Code ohne Kommentare.
        ? source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
        : source;
      if (relative !== "lib/pricing/plans.ts") {
        expect(body, `${relative} nennt einen Betrag selbst`).not.toMatch(/CHF\s*\d/);
      }
      expect(body, `${relative} nennt eine erfundene Grenze`)
        .not.toMatch(/\d+\s*(GB|MB|TB|GiB|MiB|K\b|Mio\.?)/i);
      expect(body, `${relative} nennt eine erfundene Grenze`)
        .not.toMatch(/\d[\d'.,]*\s*(requests?|Anfragen|calls?|Aufrufe|rows?|Zeilen|users?|Nutzer|seats?|Sitze|projects?|Projekte|utenti|utilisateurs)/i);
    }
  });

  it("keeps the landing page from carrying a second price list", async () => {
    // Der Widerspruch, den dieser Fall verbietet, war echt: Die Startseite trug
    // drei Tarife mit eigenen Betraegen im Markup, Business stand dort bei 99
    // und auf `/pricing` bei 199. Wer scrollte, sah beides. Seit 2.135 liest
    // der Abschnitt dieselbe Quelle, und dieser Fall haelt das fest.
    const page = await readSource("app/page.tsx");
    expect(page, "die Startseite nennt einen Betrag selbst").not.toMatch(/CHF\s*\d/);
    expect(page, "die Startseite rechnet Preise aus einer eigenen Liste").not.toMatch(/\[0,\s*\d+/);
    expect(page).toContain("PRICING_PLANS.map");
    expect(page).toContain('href="/pricing"');
    // Und das Woerterbuch der Startseite fuehrt keine Tarife mehr.
    const dictionary = await readSource("lib/i18n/landing.ts");
    expect(dictionary).not.toMatch(/pricing: \{[^}]*plans:/s);
  });

  it("has every pricing text in all four locales, translated and without digits", () => {
    const reference = leaves(PRICING.de).map((leaf) => leaf.path);
    expect(reference.length).toBeGreaterThan(0);
    const german = new Map(leaves(PRICING.de).map((leaf) => [leaf.path, leaf.value]));
    for (const locale of LOCALES) {
      const found = leaves(PRICING[locale as Locale]);
      expect(found.map((leaf) => leaf.path), `${locale}: andere Struktur als Deutsch`).toEqual(reference);
      for (const leaf of found) {
        expect(leaf.value.trim().length, `${locale}: ${leaf.path} ist leer`).toBeGreaterThan(0);
        // Eine Ziffer in einem Wort-Eintrag waere entweder ein zweiter Preis
        // oder eine Grenze, die niemand festgelegt hat.
        expect(leaf.value, `${locale}: ${leaf.path} enthaelt eine Zahl`).not.toMatch(/\d/);
      }
      if (locale === "de") continue;
      const copied = found.filter((leaf) => leaf.value.length > 12 && german.get(leaf.path) === leaf.value);
      expect(copied.map((leaf) => `${leaf.path}: ${leaf.value}`), `${locale} kopiert Deutsch`).toEqual([]);
    }
  });

  it("carries the English call to action labels the order names", () => {
    const en: PricingDictionary = PRICING.en;
    expect(PRICING_PLAN_IDS.map((id) => en.cta[id])).toEqual(["Start free", "Choose Launch", "Choose Pro", "Choose Scale", "Contact Sales"]);
    for (const locale of LOCALES) {
      const dictionary = getPricingDictionary(locale);
      for (const id of PRICING_PLAN_IDS) expect(dictionary.cta[id].trim().length).toBeGreaterThan(0);
    }
  });

  it("does not let Business be chosen, and invents no checkout", async () => {
    const business = PRICING_PLANS[PRICING_PLANS.length - 1];
    expect(business.id).toBe("business");
    expect(business.selectable).toBe(false);
    expect(business.fromPrice).toBe(true);
    expect(business.cta.kind).toBe("contact");
    expect(PRICING_PLANS.filter((plan) => plan.selectable).map((plan) => plan.id)).toEqual(["free", "launch", "pro", "scale"]);
    for (const plan of PRICING_PLANS) {
      if (plan.selectable) expect(plan.cta, `${plan.id}`).toEqual({ kind: "register", href: "/register" });
    }

    // Kein Bestellweg in der Seite: kein Checkout, kein Zahlungsanbieter, kein
    // Formular, das eine Buchung vortaeuscht.
    const source = await readSource("app/pricing/page.tsx");
    expect(source).not.toMatch(/checkout|stripe|subscribe|abonnieren|\/billing\/new|<form/i);
    expect(source).toContain("PRICING_PLANS");
  });

  it("links the pricing page from the header and the footer", async () => {
    const landing = await readSource("lib/i18n/landing.ts");
    // Die Navigation jeder Sprache zeigt auf die Seite, nicht mehr auf den
    // Anker der Startseite.
    expect((landing.match(/"\/pricing"/g) ?? []).length).toBe(LOCALES.length);
    expect(landing).not.toContain('"/#pricing"');
    const footer = await readSource("components/site-footer.tsx");
    expect(footer).toContain('href="/pricing"');
    // Die bestehenden Ziele bleiben erreichbar.
    for (const href of ["/#product", "/#verification", "/#ai", "/docs", "/console", "/#developers", "/#security"]) {
      expect(footer.includes(`href="${href}"`), `Footer verliert ${href}`).toBe(true);
    }
  });
});
