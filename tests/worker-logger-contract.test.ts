import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ein Prozess setzt jeden Logger, den seine Komposition anbietet.
 *
 * Release 1.51 hat gefunden, dass `workers/migration-runtime.mts` nur den
 * Runtime-Logger setzte. Der Worker-Logger — der jedes einzelne
 * Auftragsereignis fuehrt, von `migration.claimed` bis `migration.failed` — war
 * nie gesetzt. Alles Auftragsbezogene ging verloren, seit es den Prozess gibt,
 * und aufgefallen ist es erst, als jemand eine bestimmte Zeile suchte.
 *
 * Die Erwartung wird **abgeleitet**, nicht gepflegt: Der Test liest, welche
 * `…Logger`-Abhaengigkeiten die aufgerufene Fabrik entgegennimmt, und verlangt
 * sie im Prozess. Eine handgepflegte Liste waere die naechste Stelle, an der
 * etwas vergessen wird — die Lektion aus Release 1.40.
 */

const ROOT = process.cwd();
const WORKERS = path.join(ROOT, "workers");

/** `createXFromEnv` — die Fabriken, die ein Prozess aufruft. */
const FACTORY = /\b(create[A-Za-z0-9]*FromEnv)\b/g;

/** `xLogger?: …` in der Abhaengigkeitsliste einer Fabrik. */
const LOGGER_OPTION = /\b([a-z][A-Za-z0-9]*Logger)\?:/g;

function sources(directory: string, out: string[] = []): string[] {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules") continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Der Quelltext von `lib/server`, einmal gelesen. */
const LIBRARY = sources(path.join(ROOT, "lib", "server"))
  .map((file) => readFileSync(file, "utf8"));

/**
 * Welche Logger eine Fabrik anbietet.
 *
 * Gesucht wird der Textabschnitt ab der Signatur bis zum Rumpfbeginn — dort
 * steht die Abhaengigkeitsliste, entweder inline oder als benannter Typ. Der
 * benannte Typ wird mitgelesen, sonst faende der Test die Optionen nicht.
 */
function offeredLoggers(factory: string): string[] {
  const found = new Set<string>();
  for (const source of LIBRARY) {
    const at = source.indexOf(`export function ${factory}(`);
    if (at === -1) continue;
    const head = source.slice(at, at + 800);
    for (const match of head.matchAll(LOGGER_OPTION)) found.add(match[1]);
    // `dependencies: XDependencies` — der Typ steht woanders in derselben Datei.
    for (const named of head.matchAll(/dependencies\s*:\s*([A-Za-z0-9_]+)/g)) {
      const typeAt = source.indexOf(`type ${named[1]} = {`);
      if (typeAt === -1) continue;
      const body = source.slice(typeAt, source.indexOf("};", typeAt) + 2);
      for (const match of body.matchAll(LOGGER_OPTION)) found.add(match[1]);
    }
  }
  return [...found].sort();
}

const ENTRYPOINTS = readdirSync(WORKERS).filter((file) => /\.m?tsx?$/.test(file));

describe("worker logger contract", () => {
  it("has workers to check", () => {
    expect(ENTRYPOINTS.length).toBeGreaterThanOrEqual(7);
  });

  it.each(ENTRYPOINTS)("sets every logger its factories offer in %s", (worker) => {
    const source = readFileSync(path.join(WORKERS, worker), "utf8");
    const factories = [...new Set([...source.matchAll(FACTORY)].map((match) => match[1]))];
    const missing = factories
      .flatMap((factory) => offeredLoggers(factory).map((logger) => ({ factory, logger })))
      .filter(({ logger }) => !new RegExp(`\\b${logger}\\s*:`).test(source))
      .map(({ factory, logger }) => `${factory} bietet ${logger}`)
      .sort();

    expect(missing, [
      `${worker} laesst Logger ungesetzt, die seine Komposition anbietet.`,
      "Ein Prozess, der sie nicht setzt, verwirft jedes Ereignis, das sie fuehren",
      "— und niemand merkt es, bis jemand eine bestimmte Zeile sucht.",
    ].join(" ")).toEqual([]);
  });
});
