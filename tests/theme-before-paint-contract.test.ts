import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Das gewaehlte Thema steht am Dokument, bevor der Browser zeichnet.
 *
 * Der Umschalter speichert die Wahl seit Langem in `localStorage`, gesetzt hat
 * sie aber erst ein Effekt **nach** der Hydration. Wer Hell waehlte und ein
 * dunkles System hatte, sah auf jeder Seite zuerst Dunkel und dann den
 * Umsprung. Gefunden hat das der erste Besuch im Browser, am 30. September
 * 2026, nach rund zwanzig Ausgaben, in denen jede Release Note "im Browser
 * nicht gesehen" sagte.
 *
 * Kein bestehender Test konnte es sehen: Der Render-Vertrag rendert ohne
 * Effekte und ohne Stylesheets, also gibt es dort weder ein erstes Zeichnen
 * noch eine Farbe. Dieser Vertrag prueft darum die einzige Stelle, an der die
 * Reihenfolge entschieden wird, naemlich das Wurzel-Layout, und zwar auf vier
 * Eigenschaften, von denen jede einzeln den Fehler zurueckbraechte:
 *
 * 1. Das Skript steht im `<head>`, also vor dem `<body>` und damit vor dem
 *    ersten Zeichnen.
 * 2. Es traegt kein `defer` und kein `async`, sonst liefe es zu spaet.
 * 3. Es liest denselben Schluessel, den der Umschalter schreibt.
 * 4. Es faengt seinen eigenen Fehler ab. In einem privaten Fenster wirft
 *    `localStorage`, und ein werfendes Skript im Kopf haelt die ganze Seite an.
 */

const KEY = "qkern-theme";

describe("theme before paint contract", () => {
  it("sets the stored theme in the document head, before the body", async () => {
    const layout = await readFile("app/layout.tsx", "utf8");

    const head = layout.indexOf("<head>");
    const body = layout.indexOf("<body>");
    expect(head).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(head);

    const inHead = layout.slice(head, body);
    expect(inHead).toContain("<script");
    // Weder `defer` noch `async`: beide verschieben das Skript hinter das
    // erste Zeichnen und stellen damit genau den Fehler wieder her.
    expect(inHead).not.toMatch(/<script[^>]*\b(defer|async)\b/);

    const source = layout.slice(0, head);
    expect(source + inHead).toContain(KEY);
    expect(source + inHead).toContain("prefers-color-scheme: dark");
    expect(source + inHead).toContain("dataset.theme");
    // Ohne `try` haelt ein werfendes `localStorage` die Seite an.
    expect(source + inHead).toMatch(/try\s*\{/);
    expect(source + inHead).toMatch(/catch\s*\(/);
  });

  it("reads the same key the toggle writes", async () => {
    const toggle = await readFile("components/theme-toggle.tsx", "utf8");
    expect(toggle).toContain(`localStorage.setItem("${KEY}"`);
    // Die Console schreibt denselben Schluessel aus den Anzeigeeinstellungen
    // (2.55). Drei Stellen, ein Schluessel; faellt eine aus der Reihe, sieht
    // ein angemeldeter Nutzer beim Wechsel zwischen Website und Console
    // wieder einen Umsprung.
    const console = await readFile("components/console/console-app.tsx", "utf8");
    expect(console).toContain(`"${KEY}"`);
  });
});
