import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kein Text darf eine Ausgabe nennen, die es noch nicht gibt.
 *
 * Fallnummern und Releasenummern sehen sich zum Verwechseln aehnlich: Der Fall
 * `(2.98)` liegt in `tests/postgres.integration.test.ts`, die Ausgabe `2.67.0`
 * in `package.json`. Am 29. September 2026 haben drei Agenten unabhaengig
 * voneinander ihre eigene Fallnummer in der Form einer Ausgabe geschrieben,
 * fuenfzehn Mal, darunter die OpenAPI-Beschreibung und das Handbuch. Ein Leser
 * haette in den Release Notes nach `2.98.0` gesucht und nichts gefunden.
 *
 * Geprueft wird nur die **dreistellige** Form. Die zweistellige `2.98` meint in
 * diesem Projekt die Fallnummer und dient als Zeitmarke ("seit der Welle, die
 * Fall 2.92 brachte"); sie steht so in Dutzenden Kommentaren und ist keine
 * Verwechslung. Ein Vertrag, der sie anschlaegt, waere ein Vertrag gegen den
 * Hausbrauch.
 *
 * Geprueft wird nur die eine Richtung, die immer falsch ist: **grösser als die
 * ausgelieferte Version**. Ein Verweis auf eine aeltere Ausgabe ist gewollt und
 * ueberall im Bestand. Damit faellt der Vertrag genau dann, wenn jemand eine
 * Zukunft behauptet, und nie, wenn jemand die Vergangenheit nennt.
 *
 * Nicht geprueft werden `docs/RELEASE_*.md` (die aktuelle Note nennt ihre
 * eigene, noch nicht gesetzte Nummer, solange die Version am Ende des
 * Release-Schnitts steigt), `docs/evidence/` (archivierte Logs werden nie
 * bearbeitet), `node_modules` und **diese Datei selbst**: Ein Vertrag, der den
 * Fehler beschreibt, den er verhindert, muss ihn benennen duerfen. Beim ersten
 * Lauf ist er genau darueber gefallen.
 */

/** `1.90.0`, `2.67.0`: drei Zahlen, in Backticks oder nackt. */
const VERSION = /(?<![\d.])(\d+)\.(\d+)\.(\d+)(?![\d.])/g;

const ROOTS = ["lib", "app", "components", "tests", "mcp", "scripts", "db", "docs"] as const;
const SKIP_DIRS = new Set(["node_modules", ".next", "evidence", "coverage"]);
const READ = new Set([".ts", ".tsx", ".md", ".mjs", ".sql"]);

/**
 * Namen, hinter denen eine **fremde** Version steht und nicht die von QKERN.
 *
 * Gesucht wird nur **unmittelbar vor** der Zahl, nicht irgendwo in der Zeile.
 * Die erste Fassung filterte ganze Zeilen und hat damit sofort einen echten
 * Fehler verdeckt: Im Satz "bis `2.97.0` gab es die Ausgabe nicht, das Image
 * schon" liess das Wort "Image" die falsche Zahl durch. Ein Filter, der mehr
 * verdeckt als er erlaubt, ist schlimmer als keiner.
 */
const FOREIGN = new RegExp(
  "(postgres(ql)?|node|alpine|vault|clamav|versitygw|minio|mailpit|dex|docker|next\\.js|vitest|" +
  "typescript|argon2|aws-sdk|@aws/[a-z-]*|npm|iceberg|pgvector|icu|unicode|openapi|json schema|" +
  "react|turbopack|sha256|v)" +
  "[ :@/v-]{0,3}$",
  "i",
);

/** Wie viele Zeichen vor der Zahl nach einem fremden Namen gesehen wird. */
const LOOKBEHIND = 24;

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...await files(full)); continue; }
    if (!READ.has(path.extname(entry.name))) continue;
    if (entry.name.startsWith("RELEASE_")) continue;
    if (entry.name === "version-reference-contract.test.ts") continue;
    out.push(full);
  }
  return out;
}

function greater(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

describe("version reference contract", () => {
  it("never names a release that has not shipped", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    const shipped = pkg.version.split(".").map(Number);
    expect(shipped).toHaveLength(3);

    const found: string[] = [];
    for (const root of ROOTS) {
      for (const file of await files(root)) {
        const text = await readFile(file, "utf8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          for (const match of line.matchAll(VERSION)) {
            const before = line.slice(Math.max(0, match.index - LOOKBEHIND), match.index);
            if (FOREIGN.test(before)) continue;
            const version = [Number(match[1]), Number(match[2]), Number(match[3])];
            // Nur die Familie von QKERN: eine 1 oder 2 vorne. Alles andere ist
            // eine fremde Nummer, die hier nichts beweist.
            if (version[0] !== 1 && version[0] !== 2) continue;
            if (greater(version, shipped)) found.push(`${file}:${i + 1}: ${match[0]} in "${line.trim().slice(0, 100)}"`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });

  /**
   * Die Sperrdatei nennt dieselbe Version wie das Paket.
   *
   * Der Versionssprung am Release-Schnitt fasst `package.json` an, nicht
   * `package-lock.json`; die zieht erst ein `npm install` nach. Beim Schnitt
   * von `2.67.0` blieb sie darum auf `2.66.0` stehen, und ein Agent ist beim
   * Installieren darueber gestolpert. Zwei Zeilen, die sich widersprechen,
   * sind billiger zu pruefen als zu erklaeren.
   */
  it("keeps the lockfile on the version of the package", async () => {
    const [pkg, lock] = await Promise.all([
      readFile("package.json", "utf8").then((text) => JSON.parse(text) as { version: string }),
      readFile("package-lock.json", "utf8").then((text) =>
        JSON.parse(text) as { version: string; packages: Record<string, { version?: string }> }),
    ]);
    expect(lock.version).toBe(pkg.version);
    // Die Wurzel des Baums traegt die Version ein zweites Mal. npm schreibt
    // beide, also muessen auch beide stimmen.
    expect(lock.packages[""]?.version).toBe(pkg.version);
  });
});
