import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import { QUERY_PLAN_NODE_MEANINGS } from "@/lib/console/query-insights";

/**
 * Berichte -> Abfrage-Einblicke (2.69) am Quelltext geprueft.
 *
 * Der Schnitt steht und faellt mit einer Behauptung: Diese Flaeche fuehrt die
 * Abfrage **nicht** aus. Eine Behauptung, die nur in einem Kommentar stuende,
 * waere beim naechsten "nur ein kleiner Schalter fuer die echten Zeiten"
 * verschwunden. Darum liest dieser Vertrag den Quelltext: Wer `ANALYZE`
 * hineinschreibt, faellt hier auf, bevor die erste Abfrage darueber laeuft.
 */
const VIEW = path.resolve(process.cwd(), "components/console/query-insights-view.tsx");
const MODULE = path.resolve(process.cwd(), "lib/console/query-insights.ts");
const ROUTE = path.resolve(process.cwd(),
  "app/api/v1/projects/[projectId]/environments/[environment]/query/explain/route.ts");
const SERVICE = path.resolve(process.cwd(), "lib/server/data-plane/service.ts");

async function view(): Promise<string> { return readFile(VIEW, "utf8"); }

/** Kommentare zaehlen nicht: der Vertrag prueft Code, nicht Prosa. */
function code(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("query insights view contract", () => {
  it("never asks for ANALYZE, in the view, the route or the service", async () => {
    // Ansicht und Route kennen das Wort gar nicht. Das reine Modul darf es
    // tragen, aber nur in seinen Ehrlichkeitssaetzen: dort erklaert es genau,
    // warum es nicht benutzt wird.
    for (const file of [VIEW, ROUTE]) {
      const source = code(await readFile(file, "utf8"));
      expect(source, `${path.basename(file)}: ANALYZE im Code`).not.toMatch(/\bANALYZE\b/);
    }
    for (const line of code(await readFile(MODULE, "utf8")).split(/\r?\n/)) {
      if (!/\bANALYZE\b/.test(line)) continue;
      expect(line, "ANALYZE ausserhalb eines Ehrlichkeitssatzes").toMatch(/^export const QUERY_PLAN_[A-Z_]+ = "/);
    }
    // Im Dienst steht genau ein EXPLAIN, und es traegt kein ANALYZE.
    const service = code(await readFile(SERVICE, "utf8"));
    const explains = [...service.matchAll(/EXPLAIN[^`\n]*/g)].map((match) => match[0]);
    expect(explains).toHaveLength(1);
    expect(explains[0]).toContain("FORMAT JSON");
    expect(explains[0]).not.toMatch(/\bANALYZE\b/);
    // Und die Antwort traegt die Zusage als Literal, nicht als Schalter.
    expect(service).toContain("analyzed: false");
  });

  it("opens no second read site: the plan goes through the existing service", async () => {
    const route = await readFile(ROUTE, "utf8");
    for (const forbidden of ["getPostgresPool", "PostgresControlPlane", "createPostgresPool",
      "connectionString", "withTenant", "pg"]) {
      expect(code(route), `direkter Zugriff: ${forbidden}`).not.toContain(forbidden);
    }
    // Stattdessen: dieselbe Aufloesung und dieselbe Faehigkeit wie die
    // Query-Route.
    expect(route).toContain("getProjectDataPlane");
    expect(route).toContain('requireCapability(context, "read")');
    expect(route).toContain("hasTrustedOrigin");
    expect(route).toContain('"Cache-Control": "private, no-store"');
    // Und der Plan laeuft durch `run`, also durch BEGIN READ ONLY und die
    // Grenzpruefung. Waere er daran vorbeigebaut, stuende hier ein
    // `pool.connect` statt `this.run`.
    const service = await readFile(SERVICE, "utf8");
    const method = service.slice(service.indexOf("async explainReadQuery"));
    expect(method.slice(0, method.indexOf("private async run"))).toContain("this.run(context, scope");
  });

  it("guards the statement before EXPLAIN is put in front of it", async () => {
    // EXPLAIN allein waere kein Schutz: `EXPLAIN ANALYZE DELETE ...` loescht.
    const service = await readFile(SERVICE, "utf8");
    const method = service.slice(service.indexOf("async explainReadQuery"));
    const body = method.slice(0, method.indexOf("private async run"));
    expect(body.indexOf("isReadOnlySql")).toBeGreaterThan(-1);
    expect(body.indexOf("isReadOnlySql")).toBeLessThan(body.indexOf("EXPLAIN"));
  });

  it("asks exactly one route, its own, and with no write verb in sight", async () => {
    const source = await view();
    const targets = [...source.matchAll(/fetch\(\s*([^,]+),/g)].map((match) => match[1].trim());
    expect(targets).toHaveLength(1);
    expect(source).toContain("/query/explain");
    for (const forbidden of ["/changesets", "/apply", "/rows", "/tables/"]) {
      expect(source, `fremde Route: ${forbidden}`).not.toContain(forbidden);
    }
    for (const forbidden of [/"PATCH"/, /"DELETE"/, /"PUT"/]) {
      expect(code(source), `Schreibverb in der Ansicht: ${forbidden}`).not.toMatch(forbidden);
    }
    const route = await readFile(ROUTE, "utf8");
    const exported = [...route.matchAll(/^export function ([A-Z]+)\(/gm)].map((match) => match[1]);
    expect(exported).toEqual(["POST"]);
  });

  it("runs nothing by itself: no load on mount and no polling", async () => {
    const source = code(await view());
    // Kein useEffect, kein Intervall: den Knopf drueckt der Mensch, genau wie
    // bei den SQL-Vorlagen.
    expect(source).not.toContain("useEffect");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("setTimeout");
  });

  it("says plainly what the plan shows and what it does not", async () => {
    const module = await readFile(MODULE, "utf8");
    expect(module).toContain("EXPLAIN ohne ANALYZE");
    expect(module).toContain("Schätzungen des Planers");
    expect(module).toContain("Literale Ihrer Abfrage");
    const source = await view();
    for (const key of ["QUERY_PLAN_NOT_EXECUTED", "QUERY_PLAN_WHY_NO_ANALYZE", "QUERY_PLAN_ESTIMATES",
      "QUERY_PLAN_COST_UNIT", "QUERY_PLAN_OWN_COST", "QUERY_PLAN_NO_CONDITIONS",
      "QUERY_PLAN_SAME_DOOR", "QUERY_PLAN_PLANNING_TIME"]) {
      expect(source, key).toContain(`t(${key})`);
    }
    // Jede Knotenart wird erklaert, keine steht nur als Etikett da.
    expect(Object.keys(QUERY_PLAN_NODE_MEANINGS).length).toBeGreaterThanOrEqual(15);
    expect(source).toContain("QUERY_PLAN_NODE_MEANINGS");
  });

  it("formats every number through the bound display, never on its own", async () => {
    const source = code(await view());
    for (const forbidden of [/new\s+Intl\./, /\.toFixed\(/, /\.toLocaleString\(/]) {
      expect(source, `eigene Formatierung: ${forbidden}`).not.toMatch(forbidden);
    }
    for (const bound of ["formatNumber", "formatDecimal", "formatPercent"]) {
      expect(source, bound).toContain(bound);
    }
  });

  it("keeps the button width stable across its states", async () => {
    const source = await view();
    expect(source).toContain("StableLabel");
    expect(source).toContain('tAll("Plan wird geholt…", "Plan zeigen")');
  });

  it("replaces the placeholder and routes the view", async () => {
    expect(Object.keys(PLACEHOLDERS)).not.toContain("obs-query-insights");
    expect(REAL_VIEWS as readonly string[]).toContain("obs-query-insights");
    const children = NAV.flatMap((group) => group.children ?? []);
    expect(children.some((child) => child.id === "obs-query-insights")).toBe(true);
    const app = await readFile(
      path.resolve(process.cwd(), "components/console/console-app.tsx"), "utf8");
    expect(app).toContain('case "obs-query-insights": return <QueryInsightsView');
  });
});
