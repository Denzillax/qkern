import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Was startet, ist erreichbar — und was nicht erreichbar ist, wirkt nicht.
 *
 * Dieser Sprint hat siebenmal dasselbe gefunden: gebaut, zertifiziert und
 * trotzdem wirkungslos, weil niemand es aufruft. Realtime-Poller (1.14),
 * Event-Log (1.15), Webhook-Outbox (1.19), Functions-Sandbox (1.22),
 * Usage-Emitter (1.29), Prune-Pfade (1.37) — und der Queue-Worker, den dieser
 * Test beim ersten Lauf gefunden hat.
 *
 * Jedes Mal war es Handarbeit. Hier wird daraus eine stehende Pruefung: Der
 * Importgraph wird von jedem Prozesseinstieg aus gelaufen, und was in
 * `lib/server` liegt, ohne dabei beruehrt zu werden, ist ein Fund.
 *
 * Der Test beweist **Erreichbarkeit, nicht Wirkung**. Ein Modul kann importiert
 * und trotzdem nie ausgefuehrt werden. Das ist die schwaechere Aussage und die
 * einzige, die ein Importgraph tragen kann — sie haette aber alle sieben Faelle
 * gefunden, denn in allen sieben fehlte schon der Import.
 */

const ROOT = process.cwd();

/** `from "…"` und `import("…")`. Statische wie dynamische Kanten zaehlen. */
const SPECIFIER = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

/**
 * Module ohne Prozesseinstieg, die dennoch bleiben duerfen — mit Grund.
 *
 * Diese Liste ist die Stelle, an der dieser Test stumpf werden kann. Wer hier
 * etwas eintraegt, ohne den Grund zu meinen, hat die Pruefung abgeschaltet und
 * nicht bestanden.
 */
const ALLOWED: ReadonlyArray<{ file: string; reason: string }> = [];

function walk(directory: string, out: string[] = []): string[] {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Nur `@/…` und relative Bezuege. Ein Paketname aus `node_modules` ist keine
 * Kante dieses Graphen.
 */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  const candidates = [
    base, `${base}.ts`, `${base}.tsx`, `${base}.mts`,
    path.join(base, "index.ts"), path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function relative(file: string) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

/**
 * Ein Prozesseinstieg ist, was Next.js laedt oder was `node` direkt startet.
 * Testdateien gehoeren ausdruecklich nicht dazu — genau das ist der Punkt.
 */
function entrypoints(): string[] {
  const found = [
    ...walk(path.join(ROOT, "app")).filter((file) => /[\\/](route|page|layout)\.tsx?$/.test(file)),
    ...walk(path.join(ROOT, "workers")),
    ...walk(path.join(ROOT, "scripts")).filter((file) => file.endsWith(".ts")),
    path.join(ROOT, "middleware.ts"),
  ].filter((file) => existsSync(file));
  return found;
}

function reachable(): Set<string> {
  const seen = new Set<string>();
  const queue = entrypoints();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(match[1], file);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

describe("entrypoint reachability contract", () => {
  it("finds the entrypoints it is supposed to walk", () => {
    const found = entrypoints().map(relative);
    // Ohne diese Zusage waere der Test bei einem Umbau der Ordnerstruktur
    // lautlos gruen: Null Einstiege heissen null Funde.
    expect(found.length).toBeGreaterThan(50);
    expect(found).toContain("workers/realtime-runtime.mts");
    expect(found).toContain("workers/compute-runtime.mts");
  });

  it("reaches every server module from some process entrypoint", () => {
    const seen = reachable();
    const allowed = new Set(ALLOWED.map((entry) => entry.file));
    const orphans = walk(path.join(ROOT, "lib", "server"))
      .filter((file) => !seen.has(file))
      .map(relative)
      .filter((file) => !allowed.has(file))
      .sort();

    expect(orphans, [
      "Diese Module erreicht kein Prozesseinstieg. Entweder fehlt der Aufrufweg",
      "— dann ist das der Fund — oder sie sind tot und gehoeren geloescht.",
      "Ein Eintrag in ALLOWED braucht einen Grund, der traegt.",
    ].join(" ")).toEqual([]);
  // Explizites Budget wie bei den anderen Quellscan-Vertraegen (1.84): Der
  // Erreichbarkeitsgraph liest jedes Servermodul, und unter der I/O-Last
  // eines vollen Suitenlaufs riss die 5-Sekunden-Voreinstellung.
  }, 30_000);

  it("keeps the allowlist honest", () => {
    for (const entry of ALLOWED) {
      expect(existsSync(path.join(ROOT, entry.file)), `${entry.file} gibt es nicht mehr`).toBe(true);
      expect(entry.reason.length, `${entry.file} hat keinen Grund`).toBeGreaterThan(30);
    }
  });
});
