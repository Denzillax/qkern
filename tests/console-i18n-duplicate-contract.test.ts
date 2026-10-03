import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kein Schluessel steht zweimal im selben Sprachblock (2.133).
 *
 * **Der Befund.** Beim Umbau der Auswahlfelder haben drei Agenten parallel
 * Texte eingefuegt, zwei davon denselben Schluessel ("Function waehlen"). In
 * JavaScript gewinnt der spaetere still; `tsc` meldet es als TS1117, die
 * Vitest-Suite lief dagegen gruen durch. Genau in dieser Luecke, zwischen
 * gruener Suite und nicht gelaufenem Typchecker, haette die Dublette bis in ein
 * Release stehen koennen.
 *
 * **Warum das mehr ist als Ordnung.** Zwei Eintraege mit demselben Schluessel
 * koennen verschiedene Uebersetzungen tragen, und welche gilt, haengt an der
 * Reihenfolge in der Datei. Eine Umsortierung wuerde dann die Sprache aendern,
 * ohne dass jemand einen Text angefasst hat.
 *
 * **Was er nicht kann.** Er liest die Datei als Text und nicht als Modul, denn
 * ein Modul hat die Dublette beim Laden schon verloren. Darum erkennt er
 * Schluessel an der Einrueckung von vier Leerzeichen, so wie die Datei sie
 * durchgehend schreibt.
 */
const FILE = path.resolve(process.cwd(), "lib/i18n/console.ts");
const BLOCK = /^ {2}(en|fr|it|de): \{/;
const KEY = /^ {4}(".*?"):/;

describe("console i18n duplicate contract", () => {
  it("carries every key at most once per language", async () => {
    const lines = (await readFile(FILE, "utf8")).split(/\r?\n/);
    let language: string | null = null;
    let seen = new Map<string, number>();
    const duplicates: string[] = [];

    for (const [index, line] of lines.entries()) {
      const block = BLOCK.exec(line);
      if (block) { language = block[1]; seen = new Map(); continue; }
      const key = KEY.exec(line);
      if (!key || !language) continue;
      const first = seen.get(key[1]);
      if (first !== undefined) {
        duplicates.push(`${language} ${key[1]}: Zeile ${first + 1} und ${index + 1}`);
      } else {
        seen.set(key[1], index);
      }
    }

    expect(duplicates).toEqual([]);
  });

  it("finds the language blocks it means to check", async () => {
    // Ohne diese Zusage waere die Pruefung oben leer gruen, sobald sich die
    // Form der Datei aendert.
    const lines = (await readFile(FILE, "utf8")).split(/\r?\n/);
    const blocks = lines.filter((line) => BLOCK.test(line));
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const keys = lines.filter((line) => KEY.test(line));
    expect(keys.length).toBeGreaterThan(1000);
  });
});
