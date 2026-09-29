import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, PLACEHOLDERS, REAL_VIEWS } from "@/components/console/navigation";
import {
  LOG_EXPLORER_OUT_OF_REACH,
  LOG_EXPLORER_SOURCES,
  LOG_EXPLORER_SOURCE_DEFINITIONS,
} from "@/lib/console/log-explorer";

/**
 * Der Log-Explorer (2.65) am Quelltext geprueft.
 *
 * Der Schnitt steht und faellt mit einer Behauptung: Diese Seite oeffnet
 * **keinen** Abfrageweg in die Control Plane. Eine Behauptung, die nur in
 * einem Kommentar stuende, waere beim naechsten „nur ein kleines Feld fuer
 * einen eigenen Ausdruck" verschwunden. Darum liest dieser Vertrag den
 * Quelltext.
 */
const VIEW = path.resolve(process.cwd(), "components/console/log-explorer-view.tsx");
const MODULE = path.resolve(process.cwd(), "lib/console/log-explorer.ts");
const ROUTE = path.resolve(process.cwd(),
  "app/api/v1/projects/[projectId]/environments/[environment]/logs/search/route.ts");

async function view(): Promise<string> { return readFile(VIEW, "utf8"); }

describe("log explorer view contract", () => {
  it("carries no SQL and no way to send one", async () => {
    for (const file of [VIEW, ROUTE]) {
      const source = await readFile(file, "utf8");
      for (const forbidden of [/\bSELECT\b/, /\bFROM\s+[a-z_]/i, /\bINSERT\s+INTO\b/i,
        /\bUPDATE\s+[a-z_]+\s+SET\b/i, /\bDROP\b/i, /\bWHERE\b/, /pg_catalog/i,
        /\bstatement\b/, /\bqueryReadOnly\b/]) {
        expect(source, `${path.basename(file)}: SQL im Quelltext: ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });

  it("holds no connection to the control plane and reaches no raw repository", async () => {
    const source = await readFile(ROUTE, "utf8");
    for (const forbidden of ["getPostgresPool", "PostgresControlPlane", "withTenant",
      "getAuthPostgresPool", "controlPlaneService"]) {
      expect(source, `direkter Zugriff: ${forbidden}`).not.toContain(forbidden);
    }
    // Stattdessen: je Quelle die vorhandene Tuer und der vorhandene Dienst.
    for (const door of ["adminProjectAuthScope", "adminComputeContext",
      "adminProjectStorageContext"]) {
      expect(source, door).toContain(door);
    }
    for (const read of ["listAuditEvents", "readFunctionInvocationLog", "readObjectLog"]) {
      expect(source, read).toContain(read);
    }
  });

  it("has no write verb, in the view and in the route", async () => {
    const source = await view();
    expect(source).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    for (const forbidden of [/\bPOST\b/, /\bPATCH\b/, /\bDELETE\b/, /\bPUT\b/]) {
      expect(source, `Schreibverb in der Ansicht: ${forbidden}`).not.toMatch(forbidden);
    }
    const route = await readFile(ROUTE, "utf8");
    const exported = [...route.matchAll(/^export const ([A-Z]+) =/gm)].map((match) => match[1]);
    expect(exported).toEqual(["GET"]);
  });

  it("asks exactly one route, its own", async () => {
    const source = await view();
    const targets = [...source.matchAll(/fetch\(([^,]+),/g)].map((match) => match[1].trim());
    expect(targets).toEqual(["url"]);
    expect(source).toContain("const base = `/api/v1/projects/${projectId}/environments/${environment}/logs/search`");
    for (const forbidden of ["/query", "/rows", "/changesets", "/apply", "/tables/"]) {
      expect(source, `fremde Route: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("answers with private, no-store", async () => {
    const route = await readFile(ROUTE, "utf8");
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });

  it("says plainly that it is not SQL and why the control plane stays closed", async () => {
    const module = await readFile(MODULE, "utf8");
    expect(module).toContain("Dies ist keine SQL-Abfrage über Ihre Logs.");
    expect(module).toContain("liegen in der Control Plane");
    expect(module).toContain("sondern in Ihrer Projektdatenbank");
    const source = await view();
    for (const key of ["LOG_EXPLORER_NOT_SQL", "LOG_EXPLORER_WHY_NOT_SQL",
      "LOG_EXPLORER_SAME_DOOR", "LOG_EXPLORER_ORDER", "LOG_EXPLORER_BUDGET",
      "LOG_EXPLORER_SAVED"]) {
      expect(source, key).toContain(`t(${key})`);
    }
  });

  it("shows what it cannot reach instead of leaving it out silently", async () => {
    const source = await view();
    expect(source).toContain("LOG_EXPLORER_OUT_OF_REACH.map");
    // Jede der vier unerreichbaren Quellen hat einen Grund, keine bloss ein
    // Etikett. Bis 2.97 waren es fuenf; die Ausgabe des Containers ist seit
    // 2.67.0 eine erreichbare Quelle.
    expect(LOG_EXPLORER_OUT_OF_REACH.length).toBeGreaterThanOrEqual(4);
    expect(LOG_EXPLORER_OUT_OF_REACH.map((entry) => entry.label))
      .not.toContain("Ausgabe eines Function-Containers");
    expect(LOG_EXPLORER_SOURCES).toContain("function_output");
    for (const entry of LOG_EXPLORER_OUT_OF_REACH) {
      expect(entry.reason.length, entry.label).toBeGreaterThan(60);
    }
    // Und jede Quelle, die er **erreicht**, nennt ihre vorhandene Route und
    // die Rolle, die sie schon heute verlangt.
    for (const id of LOG_EXPLORER_SOURCES) {
      const definition = LOG_EXPLORER_SOURCE_DEFINITIONS[id];
      expect(definition.capability, id).toMatch(/^project_[a-z]+_admin$/);
      expect(definition.route, id).not.toMatch(/^\//);
    }
  });

  it("keeps a saved search free of anything that could be a query", async () => {
    const source = await view();
    expect(source).toContain("window.localStorage");
    // Der gespeicherte Entwurf traegt drei Felder, und keines ist ein Text,
    // den der Server ausfuehren koennte.
    const draft = source.match(/type Draft = \{([\s\S]*?)\n\};/);
    expect(draft, "Draft nicht gefunden").not.toBeNull();
    const fields = [...draft![1].matchAll(/^\s{2}([a-zA-Z]+)[?]?:/gm)].map((match) => match[1]);
    expect(fields.sort()).toEqual(["filters", "range", "sources"]);
  });

  it("replaces the placeholder and routes the view", async () => {
    expect(Object.keys(PLACEHOLDERS)).not.toContain("logs-explorer");
    expect(REAL_VIEWS as readonly string[]).toContain("logs-explorer");
    const children = NAV.flatMap((group) => group.children ?? []);
    expect(children.some((child) => child.id === "logs-explorer")).toBe(true);
    const app = await readFile(
      path.resolve(process.cwd(), "components/console/console-app.tsx"), "utf8");
    expect(app).toContain('case "logs-explorer": return <LogExplorerView');
  });
});
