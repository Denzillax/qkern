import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { qkernOpenAPI } from "@/lib/openapi";

/**
 * Der Vertrag zwischen den Routen und ihrer Beschreibung (2.73, erweitert 2.76).
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
 * Seit (2.76) gilt dasselbe je Verb und nicht mehr nur je Pfad. Ein Pfad allein
 * sagt zu wenig: Eine Route, deren Pfad beschrieben ist, konnte still ein
 * `DELETE` dazubekommen, ohne dass hier etwas auffiel. Darum liest der Test die
 * Verb-Exporte jeder Routendatei und vergleicht sie mit den Operationen unter
 * ihrem Pfad.
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

/**
 * Die Verben, die Next.js aus einer `route.ts` als Handler nimmt. `TRACE` fehlt
 * absichtlich: Next.js leitet es nicht, und ein `trace` im Dokument waere
 * darum eine Zusage ohne Deckung, die der Test genau so melden soll.
 */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * `OPTIONS` bleibt aus dem Vergleich heraus, weil es hier ueberall dasselbe
 * tut: Es antwortet auf den CORS-Vorflug und traegt keine eigene Zusage. Damit
 * diese Ausnahme nicht zur Hintertuer wird, prueft ein eigener Fall weiter
 * unten, dass jeder `OPTIONS`-Export wirklich nur an einen Preflight-Helfer
 * weiterreicht.
 */
const PREFLIGHT_ONLY_METHOD: HttpMethod = "OPTIONS";

/** Felder, die ein Path-Item laut OpenAPI neben den Operationen tragen darf. */
const PATH_ITEM_FIELDS = new Set(["$ref", "summary", "description", "servers", "parameters"]);

/** Die Operationsnamen, die im Dokument ueberhaupt als Verb gelten. */
const OPENAPI_OPERATIONS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/**
 * Die Exportformen, in denen eine Routendatei ihre Handler bekanntgibt. Der
 * Name in Gruppe 1 entscheidet, ob es ein Verb ist; alles andere (etwa
 * `export const dynamic` oder eine Handler-Fabrik) ist kein Verb und darum
 * uninteressant.
 *
 * Wichtig ist die Strenge: Eine Zeile, die mit `export` beginnt und in keine
 * dieser Formen passt, koennte ein Verb verstecken (`export { h as DELETE }`).
 * Dann faellt der Test und nennt Datei und Zeile, statt das Verb stillschweigend
 * zu uebersehen.
 */
const EXPORT_FORMS: ReadonlyArray<RegExp> = [
  // export const GET = ..., auch mit Typannotation: export const GET: Handler = ...
  /^export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]*)?=/,
  // export function GET(...) und export async function POST(...)
  /^export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[(<]/,
  // Reine Typen haben keine Laufzeitflaeche und koennen kein Handler sein.
  /^export\s+(?:type|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
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

/**
 * Kommentare weg, bevor die Exporte gelesen werden. Ein auskommentierter
 * `export const DELETE` ist kein Handler, und ein Vertrag, der ihn zaehlt,
 * verlangt eine Beschreibung fuer eine Flaeche, die es nicht gibt.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

type RouteFile = {
  /** Der Pfad in der Form der OpenAPI-Pfade. */
  readonly path: string;
  /** Der Dateiname relativ zum Repository, damit ein Fehler adressierbar ist. */
  readonly file: string;
  readonly methods: ReadonlySet<HttpMethod>;
  /** Zeilen mit `export`, die in keine bekannte Form passen. */
  readonly unreadable: readonly string[];
  /** Die Rohzeilen der `OPTIONS`-Exporte, fuer die Probe auf den Vorflug. */
  readonly preflightLines: readonly string[];
};

function readRouteFile(absolute: string, segments: readonly string[]): RouteFile {
  const verbs = new Set(HTTP_METHODS as readonly string[]);
  const methods = new Set<HttpMethod>();
  const unreadable: string[] = [];
  const preflightLines: string[] = [];

  for (const line of withoutComments(readFileSync(absolute, "utf8")).split(/\r?\n/)) {
    // Nur Exporte am Zeilenanfang: Ein `export` im Rumpf gibt es in Next-Routen
    // nicht, und alles Eingerueckte gehoert zu einem Objekt oder einer Fabrik.
    if (!/^export\b/.test(line)) continue;
    const matched = EXPORT_FORMS.map((form) => form.exec(line)).find((result) => result !== null);
    if (!matched) {
      unreadable.push(line.trim());
      continue;
    }
    const name = matched[1];
    if (!verbs.has(name)) continue;
    methods.add(name as HttpMethod);
    if (name === PREFLIGHT_ONLY_METHOD) preflightLines.push(line.trim());
  }

  return {
    path: toOpenApiPath(segments),
    file: relative(resolve(API_ROOT, "..", ".."), absolute).replace(/\\/g, "/"),
    methods,
    unreadable,
    preflightLines,
  };
}

function collectRouteFiles(directory: string, segments: readonly string[] = []): RouteFile[] {
  const found: RouteFile[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...collectRouteFiles(resolve(directory, entry.name), [...segments, entry.name]));
    } else if (entry.name === "route.ts") {
      found.push(readRouteFile(resolve(directory, entry.name), segments));
    }
  }
  return found;
}

/** Die Operationen unter einem Pfad, getrennt von allem, was kein Verb ist. */
function readDocumentedMethods(pathItem: unknown): { methods: Set<HttpMethod>; unknownKeys: string[] } {
  const methods = new Set<HttpMethod>();
  const unknownKeys: string[] = [];
  for (const key of Object.keys((pathItem ?? {}) as Record<string, unknown>)) {
    if (PATH_ITEM_FIELDS.has(key)) continue;
    if (!OPENAPI_OPERATIONS.has(key)) {
      unknownKeys.push(key);
      continue;
    }
    // `trace` ist eine OpenAPI-Operation, aber kein Next-Verb. Es landet hier
    // bewusst als Verb, damit es als Zusage ohne Deckung auffaellt.
    methods.add(key.toUpperCase() as HttpMethod);
  }
  return { methods, unknownKeys };
}

describe("OpenAPI route coverage (2.73)", () => {
  const routeFiles = collectRouteFiles(API_ROOT).sort((left, right) => left.path.localeCompare(right.path));
  const routePaths = routeFiles.map((route) => route.path).sort();
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

describe("OpenAPI method coverage (2.76)", () => {
  const routeFiles = collectRouteFiles(API_ROOT).sort((left, right) => left.path.localeCompare(right.path));
  const exceptions = new Set(UNDOCUMENTED_ROUTES.map((entry) => entry.path));
  const documented = new Map<string, Set<HttpMethod>>(
    Object.entries(qkernOpenAPI.paths as Record<string, unknown>).map(([path, item]) => [
      path,
      readDocumentedMethods(item).methods,
    ]),
  );

  /** Die zu vergleichenden Verben einer Route: alles ausser dem Vorflug. */
  const promisedMethods = (route: RouteFile): HttpMethod[] =>
    [...route.methods].filter((method) => method !== PREFLIGHT_ONLY_METHOD).sort();

  it("reads a verb out of every route file, so an unreadable file cannot pass as empty", () => {
    // Derselbe Riegel wie beim Pfad-Vertrag, eine Ebene tiefer: Ein Leser, der
    // nichts findet, wuerde jede undokumentierte Flaeche durchlassen.
    const unreadable = routeFiles
      .filter((route) => route.unreadable.length > 0)
      .map((route) => `${route.file}: ${route.unreadable.join(" | ")}`);
    expect(unreadable, "route files with an export form this test cannot read").toEqual([]);

    const withoutAnyMethod = routeFiles.filter((route) => route.methods.size === 0).map((route) => route.file);
    expect(withoutAnyMethod, "route files without a single recognized HTTP verb export").toEqual([]);

    const total = routeFiles.reduce((sum, route) => sum + promisedMethods(route).length, 0);
    expect(total).toBeGreaterThan(150);
    expect(routeFiles.filter((route) => route.methods.has(PREFLIGHT_ONLY_METHOD)).length).toBeGreaterThan(20);

    // Zwei Stichproben aus dem Bestand: eine reine Lesung und eine Route mit
    // mehreren Verben. Sie halten den Leser an der Wirklichkeit fest.
    const health = routeFiles.find((route) => route.path === "/health");
    expect(health && [...health.methods]).toEqual(["GET"]);
    const buckets = routeFiles.find(
      (route) => route.path === "/v1/projects/{projectId}/environments/{environment}/storage/buckets",
    );
    expect(buckets && promisedMethods(buckets)).toEqual(["GET", "POST"]);
  });

  it("describes every exported verb", () => {
    const undocumented: string[] = [];
    for (const route of routeFiles) {
      if (exceptions.has(route.path)) continue;
      const described = documented.get(route.path);
      if (!described) continue; // Der fehlende Pfad ist Sache des Pfad-Vertrags.
      for (const method of promisedMethods(route)) {
        if (!described.has(method)) undocumented.push(`${route.file} ${method}`);
      }
    }
    expect(undocumented, "exported handlers with no OpenAPI operation under their path").toEqual([]);
  });

  it("has an exported handler behind every described verb", () => {
    const byPath = new Map(routeFiles.map((route) => [route.path, route]));
    const uncovered: string[] = [];
    for (const [path, methods] of documented) {
      const route = byPath.get(path);
      if (!route) continue; // Der fehlende Pfad ist Sache des Pfad-Vertrags.
      for (const method of [...methods].sort()) {
        if (!route.methods.has(method)) uncovered.push(`${route.file} ${method}`);
      }
    }
    expect(uncovered, "OpenAPI operations that the route file does not export").toEqual([]);
  });

  it("keeps the OPTIONS exception honest: every OPTIONS export is only a preflight", () => {
    const suspicious = routeFiles.flatMap((route) =>
      route.preflightLines
        .filter((line) => !/Preflight\s*\(/.test(line))
        .map((line) => `${route.file}: ${line}`),
    );
    expect(suspicious, "OPTIONS exports that do more than answer the CORS preflight").toEqual([]);
  });

  it("finds only known fields under a documented path", () => {
    const unexpected: string[] = [];
    for (const [path, item] of Object.entries(qkernOpenAPI.paths as Record<string, unknown>)) {
      for (const key of readDocumentedMethods(item).unknownKeys) unexpected.push(`${path}: ${key}`);
    }
    expect(unexpected, "keys under an OpenAPI path that are neither an operation nor a path-item field").toEqual([]);
  });
});
