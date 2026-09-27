import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { qkernOpenAPI } from "@/lib/openapi";

/**
 * Der Vertrag zwischen den Routen und ihrer Beschreibung (2.73).
 *
 * Die Beschreibung in `lib/openapi.ts` ist von Hand gepflegt, und genau darum
 * hinkte sie hinter den Routen her: Eine neue `route.ts` faellt niemandem auf,
 * wenn nichts danach fragt. Dieser Test fragt danach. Er sucht jede Datei
 * `app/api/**\/route.ts`, rechnet ihren Pfad in die Form der OpenAPI-Pfade um
 * und verlangt, dass jeder Pfad im Dokument steht.
 *
 * Er prueft beide Richtungen, weil beide Richtungen luegen koennen: Eine Route
 * ohne Beschreibung ist eine Zusage, die niemand kennt; ein beschriebener Pfad
 * ohne Route ist eine Zusage ohne Deckung.
 *
 * Eine Route, die bewusst nicht beschrieben wird, gehoert auf
 * `UNDOCUMENTED_ROUTES` **mit Grund**. Eine stille Auslassung laesst dieser
 * Test nicht durch, und ein Grund, der nicht mehr gilt, faellt ebenfalls auf:
 * Ein Eintrag ohne Route ist genauso ein Fehler wie eine Route ohne Eintrag.
 *
 * Ohne Datenbank: Gelesen werden nur das Dateisystem und das exportierte
 * Objekt. Ein Docker-Stack koennte hier nichts beweisen, was diese beiden
 * Quellen nicht schon sagen.
 */
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "app", "api");

/**
 * Die Routen, die absichtlich keine oeffentliche Zusage sind, je mit dem Grund
 * im Klartext. Der Grund steht hier und nicht in einem Ticket, weil der
 * naechste Leser ihn hier sucht.
 */
const UNDOCUMENTED_ROUTES: ReadonlyArray<{ path: string; reason: string }> = [
  {
    path: "/v1/console",
    reason:
      "Der Sammelschnappschuss fuer die Schale der eigenen Console: Nutzer, " +
      "Organisation und die vier Listen, die eine Seite gerade braucht. Er ist " +
      "auf diese eine Oberflaeche geschnitten und wandert mit ihr, hat kein " +
      "Datenkuvert wie die uebrigen Routen und ist bewusst keine Zusage an " +
      "fremde Aufrufer. Wer die Inhalte als API will, nimmt /v1/projects, " +
      "/v1/changesets und die Migrations-Routen, die einzeln beschrieben sind.",
  },
];

/** Eine Route-Datei zu dem Pfad, unter dem Next.js sie ausliefert. */
function toOpenApiPath(segments: readonly string[]): string {
  const rendered = segments
    // Route-Gruppen wie `(console)` erscheinen nie in der URL.
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .map((segment) => {
      const dynamic = /^\[{1,2}(?:\.\.\.)?(.+?)\]{1,2}$/.exec(segment);
      return dynamic ? `{${dynamic[1]}}` : segment;
    });
  return `/${rendered.join("/")}`;
}

function collectRoutePaths(directory: string, segments: readonly string[] = []): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...collectRoutePaths(resolve(directory, entry.name), [...segments, entry.name]));
    } else if (entry.name === "route.ts") {
      found.push(toOpenApiPath(segments));
    }
  }
  return found;
}

describe("OpenAPI route coverage (2.73)", () => {
  const routePaths = collectRoutePaths(API_ROOT).sort();
  const documentedPaths = Object.keys(qkernOpenAPI.paths).sort();
  const exceptions = new Set(UNDOCUMENTED_ROUTES.map((entry) => entry.path));

  it("finds the route files at all, so a broken walk cannot pass as coverage", () => {
    // Ohne diese Zusicherung wuerde ein leeres Ergebnis jede Luecke bestehen
    // lassen, und der Test waere ein gruener Haken ohne Aussage.
    expect(routePaths.length).toBeGreaterThan(100);
    expect(routePaths).toContain("/health");
    expect(routePaths).toContain("/v1/projects/{projectId}/environments/{environment}/schema");
    expect(new Set(routePaths).size).toBe(routePaths.length);
  });

  it("describes every route, except the ones excepted with a reason", () => {
    const missing = routePaths.filter((path) => !documentedPaths.includes(path) && !exceptions.has(path));
    expect(missing, "routes without an OpenAPI path and without an explicit exception").toEqual([]);
  });

  it("has a route behind every described path", () => {
    const orphaned = documentedPaths.filter((path) => !routePaths.includes(path));
    expect(orphaned, "OpenAPI paths that no route serves").toEqual([]);
  });

  it("keeps the exception list honest: every entry names a real route and a reason", () => {
    for (const entry of UNDOCUMENTED_ROUTES) {
      expect(routePaths, `${entry.path} is excepted but no route serves it`).toContain(entry.path);
      // Ein Pfad, der beschrieben **und** ausgenommen ist, sagt zwei Dinge auf
      // einmal; dann gilt die Beschreibung und der Eintrag muss weg.
      expect(documentedPaths, `${entry.path} is both described and excepted`).not.toContain(entry.path);
      expect(entry.reason.trim().length, `${entry.path} is excepted without a reason`).toBeGreaterThan(40);
    }
    expect(new Set(exceptions).size).toBe(UNDOCUMENTED_ROUTES.length);
  });
});
