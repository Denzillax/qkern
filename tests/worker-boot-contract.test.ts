import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Jeder ausgelieferte Prozess startet wirklich.
 *
 * Release 1.44 hat gefunden, dass **kein einziger** der sieben Worker starten
 * konnte. `package.json` hat kein `"type": "module"`, also uebersetzt tsx jede
 * `.ts` als CommonJS — und jeder Worker benutzt Top-Level-await. Der Prozess
 * brach ab, bevor eine Zeile davon lief.
 *
 * Zertifiziert war jedes Mal, was der Prozess aufruft, nie sein Start. Release
 * 1.42 hat dem Queue-Worker einen Wirt gegeben und 1.43 die Kette bis in den
 * Container belegt — beide Male lief der Wirt als Objekt, und beide Release
 * Notes behaupteten `npm run worker:queues`.
 *
 * Gemessen wird deshalb genau eines: Der Prozess kommt bis zu **seiner eigenen**
 * Konfigurationsgrenze. Ob er danach ohne Datenbank weiterlaeuft, ist hier nicht
 * die Frage — dass er dorthin gelangt, war es.
 */

const ROOT = process.cwd();
const WORKERS = readdirSync(path.join(ROOT, "workers")).filter((file) => /\.m?tsx?$/.test(file));

/**
 * Die Meldungen, an denen ein Start scheitert, **bevor** eigener Code laeuft.
 * Genau diese Klasse ist bis 1.44 durch jede Zertifizierung gefallen.
 */
const BOOT_FAILURES = [
  "Top-level await",
  "Transform failed",
  "SyntaxError",
  "ERR_MODULE_NOT_FOUND",
  "Cannot find module",
];

describe("worker boot contract", () => {
  it("has workers to check", () => {
    // Ohne diese Zusage waere der Test bei einem Umbau lautlos gruen.
    expect(WORKERS.length).toBeGreaterThanOrEqual(7);
  });

  it.each(WORKERS)("starts %s far enough to reach its own boundary", (worker) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", `workers/${worker}`], {
      cwd: ROOT,
      timeout: 60_000,
      encoding: "utf8",
      // Leere Konfiguration mit Absicht: Jeder Worker verlangt sein eigenes
      // Enable-Flag und bricht danach ab. Was uns interessiert, ist die Zeile
      // davor.
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
        TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: "test",
      } as NodeJS.ProcessEnv,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    for (const failure of BOOT_FAILURES) {
      expect(output, `${worker} scheitert vor der eigenen Grenze:\n${output.slice(0, 600)}`)
        .not.toContain(failure);
    }
  }, 70_000);
});
