import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  nextInvoiceOutlook,
  paymentTermDays,
  usageMeterRatio,
  usageMeterWidth,
} from "@/lib/console/billing";
import { getPricingDictionary } from "@/lib/i18n/pricing";
import { PRICING_PLAN_IDS } from "@/lib/pricing/plans";

/**
 * Abrechnung und Nutzung, verstaendlich und ohne erfundenen Tarif (2.140).
 *
 * Der Vertrag `console-billing-view-contract` haelt fest, dass die Ansicht
 * nur liest und keinen Betrag selbst kennt. Dieser hier haelt vier Zusagen,
 * die mit dem Tarifkatalog aus 2.75.0 dazukamen:
 *
 * 1. **Kein Tarif wird als gebunden dargestellt.** An einem Projekt haengt
 *    keiner, weil es im Backend keine Tarifzeile dazu gibt. Die Seite sagt
 *    das, zeigt daneben den Katalog und verspricht keinen Wechsel, den kein
 *    Weg traegt.
 * 2. **Kein Balken ohne konfigurierte Grenze.** Ein Balken ist ein Bild, und
 *    ein Entwickler liest es als Zusage. Er erscheint nur, wo `limit` in der
 *    Antwort der Route wirklich eine Zahl traegt.
 * 3. **Kein Betrag und keine Grenze steht als Literal im Quelltext.** Beides
 *    kommt aus einer Antwort oder aus dem Katalog; eine Zahl in der Ansicht
 *    waere eine zweite Wahrheit.
 * 4. **Jeder Betrag laeuft durch das Geldmodul.** Ein zweites Zahlenformat
 *    neben `lib/console/money.ts` waere eine Rechnung, die anders aussieht
 *    als die Projektion.
 *
 * Dazu die Ableitungen rund um die naechste Rechnung. Was er nicht kann: Er
 * rendert nichts. Dass der Balken im Browser auch so breit ist, wie der
 * Anteil sagt, sieht niemand hier.
 */
const BILLING = "components/console/billing-settings-view.tsx";
const USAGE = "components/console/usage-view.tsx";
const INVOICES = "components/console/invoices-card.tsx";

const read = (file: string) => readFile(path.resolve(process.cwd(), file), "utf8");
/** Code ohne Kommentare: Die Begruendungen nennen Beispielbetraege und Grenzen. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("console billing reading contract", () => {
  it("presents no plan as bound to the project and invents no way to switch", async () => {
    const view = await read(BILLING);
    // Der Satz steht da, und er steht als Erstes in der Karte.
    expect(view).toContain('t("An diesem Projekt hängt kein Tarif.")');
    expect(view).toContain('t("Im Backend gibt es keine Tarifzeile zu einem Projekt.');
    // Kein Knopf und keine Beschriftung, die einen Wechsel verspricht.
    expect(view).not.toMatch(/t\("(?:Tarif wechseln|Tarif ändern|Tarif buchen|Tarif wählen|Upgrade|Jetzt upgraden)"\)/u);
    // Und kein Feld, das einen Tarif als den eigenen fuehrt. Gaebe es eines,
    // muesste es aus einer Tarifzeile kommen, und die gibt es nicht.
    expect(strip(view)).not.toMatch(/\b(?:currentPlan|activePlan|myPlan|selectedPlan|plan\.selectable)\b/u);
    // Die Namen der Tarife stehen nicht in der Ansicht: Sie kommen aus dem
    // Katalog, sonst haetten Console und Preisseite zwei Namenslisten.
    for (const id of PRICING_PLAN_IDS) {
      const name = getPricingDictionary("de").plans[id].name;
      expect(view, `${name} steht als Literal in der Ansicht`).not.toContain(`"${name}"`);
    }
    expect(view).toContain("getPricingDictionary(consoleLocale())");
    expect(view).toContain("PRICING_PLANS.map");
    // Der Weg zur Tarifverwaltung ist die Preisseite, und zwar als Verweis.
    expect(view).toContain('href="/pricing"');
    expect(view).toContain('t("Preisseite öffnen")');
  });

  it("draws a bar only where a limit is really configured", async () => {
    const usage = await read(USAGE);
    // Genau ein Balken in der ganzen Ansicht.
    expect(usage.match(/className=\{`progress /gu) ?? []).toHaveLength(1);
    // Und er steht im zweiten Zweig: erst der Satz ohne Grenze, dann der
    // Balken. Die Reihenfolge ist die Zusage, nicht bloss die Anwesenheit.
    expect(usage).toMatch(/ratio===null[\s\S]{0,700}?keine Grenze gesetzt[\s\S]{0,700}?className=\{`progress /u);
    expect(usage).toContain('t("Für diese Metrik ist keine Grenze gesetzt.');
    // Die Grenze kommt aus der Antwort der Route und wird nicht geraten.
    expect(usage).toContain("usageMeterRatio(item.used,item.limit)");

    // Ohne Grenze gibt es keinen Anteil, und damit nichts zu zeichnen.
    expect(usageMeterRatio("500", null)).toBeNull();
    // Eine Grenze von null ist keine Grenze; ein Balken daran waere eine
    // Division, die nichts bedeutet.
    expect(usageMeterRatio("500", "0")).toBeNull();
    expect(usageMeterRatio("500", "nicht-eine-zahl")).toBeNull();
    expect(usageMeterRatio("500", "1000")).toBe(0.5);
    expect(usageMeterRatio("0", "1000")).toBe(0);
    // Ueber der Grenze bleibt der Anteil ueber eins: Der Balken kappt, die
    // Zahl daneben nicht.
    expect(usageMeterRatio("1500", "1000")).toBe(1.5);
    // Jenseits von Number.MAX_SAFE_INTEGER, wie Egress in Bytes es erreicht.
    expect(usageMeterRatio("9007199254740993000", "18014398509481986000")).toBe(0.5);
    expect(usageMeterWidth(0.5)).toBe(50);
    expect(usageMeterWidth(1.5)).toBe(100);
    expect(usageMeterWidth(-1)).toBe(0);
  });

  it("writes no amount and no limit into the sources", async () => {
    for (const file of [BILLING, USAGE, INVOICES]) {
      const code = strip(await read(file));
      expect(code, file).not.toMatch(/\b(?:CHF|EUR|USD|GBP)\b/u);
      expect(code, file).not.toMatch(/\d+[.,]\d{2}\b/u);
      // Eine Grenze neben dem Wort, das sie benennt: der Fall, in dem eine
      // Ansicht sich selbst eine Schwelle setzt.
      expect(code, file).not.toMatch(/(?:limit|Grenze|quota|threshold|Schwelle)\s*[:=]\s*["'`]?-?\d/iu);
      // Eine Menge mit einer Einheit, die niemand konfiguriert hat.
      expect(code, file).not.toMatch(/\d[\d'’.,]*\s*(?:GB|MB|TB|PB|KB|GiB|MiB)\b/u);
    }
    // Und die Nutzung liest die Grenze wirklich aus der Antwort.
    expect(await read(USAGE)).toContain("item.limit===null");
  });

  it("routes every amount through the money module", async () => {
    for (const file of [BILLING, INVOICES]) {
      const code = strip(await read(file));
      expect(code, file).toContain('from "@/lib/console/money"');
      // Die Einfuhrzeilen nennen die Formatierer selbst und wuerden sonst als
      // Ausgabe durchgehen. Mehrzeilige Einfuhren laufen bis zum `from "...";`.
      const body = code.replace(/import\s[\s\S]*?from\s+"[^"]+";/gu, "");
      // **Jede** Stelle, nicht jeder Name. Die Mutationsprobe hat gezeigt,
      // warum: Ein `{projection.totalMicros}` in einer Karte lief gruen
      // durch, weil derselbe Zugriff in einer anderen Karte durch den
      // Formatierer ging. Erlaubt ist darum nur zweierlei je Fundstelle --
      // sie steht direkt im Formatierer, oder sie ist eine Pruefung auf null.
      // Alles andere landet roh in der Ausgabe, als BigInt-String mit sechs
      // Nullen zu viel.
      let places = 0;
      for (const match of body.matchAll(/\b[A-Za-z_$][\w$]*\.[\w$]*Micros\b/gu)) {
        places += 1;
        const at = match.index ?? 0;
        const before = body.slice(Math.max(0, at - 24), at);
        const after = body.slice(at + match[0].length, at + match[0].length + 14);
        expect(
          /(?:formatMoneyMicros\(|formatUnitPriceMicros\()$/u.test(before) ||
            /^\s*(?:!==|===)\s*null/u.test(after),
          `${file}: ${match[0]} steht roh in der Ausgabe`,
        ).toBe(true);
      }
      expect(places, `${file}: kein Mikro-Betrag gefunden`).toBeGreaterThan(0);
      expect(code, file).not.toMatch(/Micros[^\n]*\.toString\(\)/u);
      expect(code, file).not.toMatch(/Number\([^)]*Micros/u);
    }
    // Der Tarifpreis kommt aus dem Katalog und wird nicht hier gerechnet.
    const view = strip(await read(BILLING));
    expect(view).toContain("formatPlanPrice(plan, pricing.words)");
    expect(view).not.toMatch(/monthlyMicros\s*[*/+-]/u);
  });

  it("derives what it can about the next invoice and names no date it has not", async () => {
    expect(nextInvoiceOutlook("2026-09"))
      .toEqual({ period: "2026-09", periodLastDay: "2026-09-30", closedFrom: "2026-10-01" });
    // Der Jahreswechsel: der Folgemonat liegt im naechsten Jahr.
    expect(nextInvoiceOutlook("2026-12"))
      .toEqual({ period: "2026-12", periodLastDay: "2026-12-31", closedFrom: "2027-01-01" });
    expect(nextInvoiceOutlook("2028-02")?.periodLastDay).toBe("2028-02-29");
    expect(nextInvoiceOutlook("2026-13")).toBeNull();

    // Die Frist einer Rechnung kommt aus ihrem Dokument, nicht aus der Console.
    expect(paymentTermDays("2026-10-01T00:00:00.000Z", "2026-10-31T00:00:00.000Z")).toBe(30);
    expect(paymentTermDays("2026-10-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z")).toBeNull();
    expect(paymentTermDays("", "")).toBeNull();

    const view = await read(BILLING);
    expect(view).toContain("nextInvoiceOutlook(projection.period)");
    // Jede abgeleitete Angabe traegt ihre Herkunft neben sich.
    expect(view).toContain('t("aus der Antwort von usage/billing")');
    expect(view).toContain('t("aus der Periode gerechnet, in UTC")');
    expect(view).toContain('t("der Rechnungslauf nimmt nur eine abgeschlossene Periode an")');
    // Und der Satz, dass es keinen Termin gibt.
    expect(view).toContain('t("Einen Termin gibt es nicht.');
    // Kein Datum aus der Uhr des Browsers: Was hier stuende, waere nicht
    // abgeleitet, sondern geraten.
    expect(strip(view)).not.toMatch(/new Date\(/u);
    // Die Fälligkeit der ausgestellten Rechnung kommt aus dem Dokument.
    const card = await read(INVOICES);
    expect(card).toContain("paymentTermDays(issuedAt, dueAt)");
    expect(card).toContain("term(invoice.issuedAt, invoice.dueAt)");
    expect(card).toContain('t("Die Fälligkeit steht in der Rechnung selbst;');
  });
});
