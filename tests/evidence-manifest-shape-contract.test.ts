import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Jedes archivierte Manifest hat eine von zwei Formen.
 *
 * **Der Befund, der dahinter steht.** `readArchivedManifests` ueberspringt still
 * jedes Manifest, dem eines der vier Felder `stack`, `passed`, `failed`,
 * `exitCode` fehlt. Das ist fuer den einen Schnellstart-Durchlauf vom
 * 26. September richtig, denn der zaehlt Schritte und keine Faelle. Es ist aber
 * auch genau der Weg, auf dem ein kaputtes Manifest unbemerkt verschwindet: Die
 * Zahl auf der Startseite wuerde kleiner, die Seite bliebe gruen, und niemand
 * saehe es. Ein Lauf, der nicht gezaehlt wird, ist ein Lauf, der nicht
 * stattgefunden hat.
 *
 * **Was dieser Vertrag dagegen haelt.** Er liest dieselben Ordner wie die Seite
 * und verlangt je Datei eine der beiden Formen. Eine dritte faellt laut, mit
 * Namen. Damit kann ein Generator, der ein Feld vergisst, die Zahl nicht mehr
 * leise senken.
 *
 * **Was er nicht kann.** Er prueft die Form und nicht den Inhalt: Ob die Zahlen
 * zu ihrem Log passen, haelt `scripts/certification-manifest.mjs`, das sie aus
 * dem Rohlog liest, und `status-numbers-contract` bindet die Behauptungen in
 * `STATUS.md` an die gruenen Manifeste.
 */
const ROOT = path.resolve(process.cwd(), "docs/evidence");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Manifest = Record<string, unknown>;

function isRun(manifest: Manifest): boolean {
  return typeof manifest.stack === "string" && typeof manifest.passed === "number" &&
    typeof manifest.failed === "number" && typeof manifest.exitCode === "number";
}

function isWalkthrough(manifest: Manifest): boolean {
  return typeof manifest.stack === "string" && typeof manifest.steps === "number" &&
    typeof manifest.stepsPassed === "number" && typeof manifest.exitCode === "number";
}

/**
 * Einmal je Lauf und parallel gelesen (2.158). Drei Pruefungen lasen die ueber
 * 700 Manifeste jede fuer sich und nacheinander; unter der vollen Suite lief
 * das ueber die fuenf Sekunden. Reihenfolge und Inhalt sind dieselben.
 */
let manifestList: Promise<{ file: string; manifest: Manifest }[]> | undefined;
function archivedManifests(): Promise<{ file: string; manifest: Manifest }[]> {
  manifestList ??= readArchivedManifests();
  return manifestList;
}

async function readArchivedManifests(): Promise<{ file: string; manifest: Manifest }[]> {
  const files: string[] = [];
  for (const day of await readdir(ROOT, { withFileTypes: true })) {
    if (!day.isDirectory() || !DAY.test(day.name)) continue;
    for (const entry of await readdir(path.join(ROOT, day.name))) {
      if (entry.endsWith(".manifest.json")) files.push(`${day.name}/${entry}`);
    }
  }
  return Promise.all(files.map(async (file) => ({
    file,
    manifest: JSON.parse(await readFile(path.join(ROOT, file), "utf8")) as Manifest,
  })));
}

describe("evidence manifest shape contract", () => {
  it("carries either run numbers or walkthrough steps in every archived manifest", async () => {
    const manifests = await archivedManifests();
    // Unter der Zahl stuende sonst nichts: Faellt das Lesen aus, waere die
    // Zusage darunter leer gruen.
    expect(manifests.length).toBeGreaterThan(700);

    const strange = manifests
      .filter(({ manifest }) => !isRun(manifest) && !isWalkthrough(manifest))
      .map(({ file }) => file);
    expect(strange).toEqual([]);
  });

  it("names every manifest that the landing page does not count", async () => {
    // Die Seite zaehlt nur Laeufe. Welche Dateien das nicht sind, soll man
    // nachlesen koennen, statt die Differenz zweier Zahlen zu raten.
    const manifests = await archivedManifests();
    const notCounted = manifests.filter(({ manifest }) => !isRun(manifest)).map(({ file }) => file);

    expect(notCounted).toEqual(["2026-09-26/quickstart-walkthrough.manifest.json"]);
  });

  it("parses as JSON and names a stack in every archived manifest", async () => {
    const manifests = await archivedManifests();
    const nameless = manifests
      .filter(({ manifest }) => typeof manifest.stack !== "string" || manifest.stack.trim() === "")
      .map(({ file }) => file);

    expect(nameless).toEqual([]);
  });
});
