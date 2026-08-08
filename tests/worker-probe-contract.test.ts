import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Jeder Prozess mit einer Schleife startet seine Health-Probe.
 *
 * Dieser Test entstand aus einem **Fehler in einer Release Note**. Release 1.46
 * behauptete, `createLoopbackRuntimeProbeFromEnv` rufe „kein einziger Prozess"
 * auf. Vier von sieben taten es seit der Baseline `1.8.0`; die Suche, auf die
 * ich mich verlassen hatte, war gross-/kleinschreibungsempfindlich und traf den
 * echten Funktionsnamen nicht.
 *
 * Dieselbe Lehre wie in Release 1.39 und 1.40: Eine Zahl oder eine Aussage, die
 * nur behauptet wird, ist keine Messung. Was hier stand, wird jetzt gezaehlt.
 */

const ROOT = process.cwd();
const WORKERS = readdirSync(path.join(ROOT, "workers")).filter((file) => /\.m?tsx?$/.test(file));

/**
 * Prozesse ohne Probe — mit Grund, der traegt.
 *
 * Wie die `ALLOWED`-Liste des Erreichbarkeitsvertrags ist das die Stelle, an
 * der diese Pruefung stumpf werden kann.
 */
const WITHOUT_PROBE: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: "realtime-runtime.mts",
    reason:
      "Der Realtime-Prozess ist ein Server, keine Schleife. `ready` verlangt eine "
      + "gelungene Runde, und was dort eine Runde waere, ist nicht entschieden: Ohne "
      + "Postgres Changes tickt gar nichts. Ein Herzschlag-Timer waere ein Signal, das "
      + "nur behauptet, dass der Prozess lebt — das sagt `live` bereits.",
  },
];

describe("worker probe contract", () => {
  it("has workers to check", () => {
    expect(WORKERS.length).toBeGreaterThanOrEqual(7);
  });

  it("starts the probe in every looping process", () => {
    const excused = new Set(WITHOUT_PROBE.map((entry) => entry.file));
    const silent = WORKERS
      .filter((file) => !excused.has(file))
      .filter((file) => !readFileSync(path.join(ROOT, "workers", file), "utf8")
        .includes("createLoopbackRuntimeProbeFromEnv"))
      .sort();

    expect(silent, [
      "Diese Prozesse starten keine Health-Probe. Eine Schleife, die jede Sekunde",
      "scheitert, ist dann von einer untaetigen nicht zu unterscheiden — genau das",
      "hat Release 1.45 eine Stunde gekostet.",
    ].join(" ")).toEqual([]);
  });

  it("keeps the excuse list honest", () => {
    for (const entry of WITHOUT_PROBE) {
      expect(WORKERS, `${entry.file} gibt es nicht mehr`).toContain(entry.file);
      expect(entry.reason.length, `${entry.file} hat keinen Grund`).toBeGreaterThan(60);
    }
  });
});
