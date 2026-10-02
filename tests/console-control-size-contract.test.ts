import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ankreuzfelder behalten ihre Groesse (2.133).
 *
 * **Der Befund.** `.settings-form input` setzt Hoehe und Innenabstand fuer
 * Textfelder und trifft dabei jedes `input` darunter, auch
 * `input[type="checkbox"]`. Im Tabellen-Entwurf stand darum ein 40 Pixel hohes
 * blaues Quadrat, und die Beschriftung rutschte darunter. Gesehen hat das
 * niemand, weil die Konsole bis `2.74.0` nie im Browser geoeffnet wurde; die
 * Render-Vertraege pruefen das Markup und nicht, was ein Browser daraus macht.
 * Betroffen waren neun Ansichten, nicht eine.
 *
 * **Warum ein Vertrag auf dem Stylesheet.** Die Regel muss **nach** den
 * Formularregeln stehen, sonst gewinnt bei gleicher Spezifitaet die fruehere.
 * Das ist eine Eigenschaft der Reihenfolge in der Datei, und genau die geht bei
 * der naechsten Umsortierung verloren, ohne dass etwas rot wird.
 *
 * **Was er nicht kann.** Er liest Text und rendert nichts. Ob ein Browser das
 * Kaestchen wirklich 15 Pixel breit zeichnet, sagt er nicht; er sagt, dass die
 * Regel da ist, dass sie spaet genug steht, dass sie nichts anderes mitnimmt
 * und dass jedes Ankreuzfeld der Konsole in einer Beschriftung steht.
 */
const CSS_PATH = path.resolve(process.cwd(), "app/globals.css");
const VIEWS = path.resolve(process.cwd(), "components/console");

describe("console control size contract", () => {
  it("sizes checkboxes and radios on their own", async () => {
    const css = await readFile(CSS_PATH, "utf8");
    expect(css).toMatch(/input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{[^}]*\bheight:/);
    // Nur die Groesse. Eine Regel ueber `label:has(> input[type="checkbox"])`
    // traegt (0,1,2) und ueberstimmt damit Rasterklassen wie `.bucket-row`;
    // aus einem Raster wuerde eine Zeile.
    expect(css).not.toMatch(/label:has\(> input\[type="(checkbox|radio)"\]\)/);
  });

  it("puts that rule after every rule that sizes a form input", async () => {
    const css = await readFile(CSS_PATH, "utf8");
    const own = css.lastIndexOf('input[type="checkbox"], input[type="radio"]');
    expect(own).toBeGreaterThan(0);

    const sizing = [...css.matchAll(/^[^\n{]*\sinput[^\n{]*\{[^}]*(?<!line-)height:/gm)];
    const late = sizing
      .filter((match) => (match.index ?? 0) > own)
      .map((match) => match[0].split("{")[0].trim());
    expect(late, "Regeln, die nach der Kaestchen-Regel noch an input drehen").toEqual([]);
  });

  it("gives every console checkbox a label around it", async () => {
    // Ein Kaestchen ausserhalb seiner Beschriftung ist neben dem Text nicht
    // anklickbar und fuer einen Screenreader namenlos.
    const files = (await readdir(VIEWS)).filter((name) => name.endsWith(".tsx"));
    const bare: string[] = [];
    for (const file of files) {
      const source = await readFile(path.join(VIEWS, file), "utf8");
      for (const hit of source.matchAll(/<input type="checkbox"/g)) {
        // Rueckwaerts bis zum naechsten `<label`: Liegt dazwischen ein
        // `</label>`, steht das Kaestchen ausserhalb. Zeilenweise geht das
        // nicht, weil die Beschriftung oft eine Zeile frueher oeffnet.
        const before = source.slice(0, hit.index ?? 0);
        const open = before.lastIndexOf("<label");
        const close = before.lastIndexOf("</label>");
        if (open < 0 || close > open) bare.push(`${file}: ${before.slice(-60).trim()}`);
      }
    }
    expect(bare).toEqual([]);
  });
});
