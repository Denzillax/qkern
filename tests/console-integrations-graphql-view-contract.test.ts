import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_API_GRAPHQL_LIMITS } from "@/lib/data-api-graphql-limits";
import {
  GRAPHQL_CONSOLE_ROLE,
  GRAPHQL_LIMIT_DEPTH,
  GRAPHQL_LIMIT_FIELDS,
  GRAPHQL_LIMIT_ROWS,
  GRAPHQL_NO_COST_ESTIMATE,
  GRAPHQL_NO_HISTORY,
  GRAPHQL_NO_INTROSPECTION,
  GRAPHQL_NO_MUTATIONS,
  GRAPHQL_OWN_PARSER,
  GRAPHQL_PAGE_READ_ONLY,
  GRAPHQL_SAME_PATH,
  GRAPHQL_SCHEMA_FROM_CATALOG,
  GRAPHQL_SCHEMA_NOT_PER_CALLER,
  GRAPHQL_SCHEMA_OMISSIONS,
  GRAPHQL_SEQUENTIAL,
  GRAPHQL_WHAT,
  GRAPHQL_WHY_LIMITS,
} from "@/lib/console/integrations-graphql-texts";

/**
 * Die Ansicht Integrationen, GraphQL (2.83) muss ihre Grenzen zeigen.
 *
 * Der Slice baut einen Ausschnitt einer Sprache, deren Namen jeder kennt. Genau
 * darum ist die Gefahr hier nicht, dass etwas nicht funktioniert, sondern dass
 * die Seite nach mehr aussieht als sie ist: Wer "GraphQL" liest, erwartet
 * Mutationen, Fragmente, Variablen und Introspektion. Faellt einer dieser
 * Saetze weg, soll dieser Vertrag fallen.
 *
 * Er haelt ausserdem fest, dass die Seite nur zwei Wege kennt und beide lesend
 * sind. Ein dritter Weg an dieser Seite waere ein zweiter Schreibweg, und genau
 * den soll es nicht geben.
 */
const VIEW = path.resolve(process.cwd(), "components/console/integrations-graphql-view.tsx");

async function view(): Promise<string> {
  return readFile(VIEW, "utf8");
}

describe("console integrations GraphQL view contract", () => {
  it("names on the page what the surface cannot do", async () => {
    const source = await view();
    const required = {
      GRAPHQL_WHAT, GRAPHQL_NO_MUTATIONS, GRAPHQL_SAME_PATH, GRAPHQL_OWN_PARSER,
      GRAPHQL_SCHEMA_FROM_CATALOG, GRAPHQL_SCHEMA_OMISSIONS, GRAPHQL_SCHEMA_NOT_PER_CALLER,
      GRAPHQL_WHY_LIMITS, GRAPHQL_LIMIT_DEPTH, GRAPHQL_LIMIT_FIELDS, GRAPHQL_LIMIT_ROWS,
      GRAPHQL_SEQUENTIAL, GRAPHQL_NO_INTROSPECTION, GRAPHQL_PAGE_READ_ONLY,
      GRAPHQL_CONSOLE_ROLE, GRAPHQL_NO_HISTORY, GRAPHQL_NO_COST_ESTIMATE,
    };
    for (const name of Object.keys(required)) {
      // Der Text steht als Konstante im Modul und laeuft ueber t(variable);
      // geprueft wird, dass die Ansicht ihn wirklich rendert.
      expect(source, name).toContain(`t(${name})`);
    }
  });

  it("asks only for the one read route, with GET and POST and nothing else", async () => {
    const source = await view();
    const routes = [...source.matchAll(/const route = `([^`]+)`/g)].map((match) => match[1]);
    expect(routes).toEqual([
      "/api/v1/projects/${projectId}/environments/${environment}/graphql",
    ]);
    // Jeder Abruf geht an genau diese eine Adresse. Ein zweiter Pfad waere eine
    // zweite Tuer, und die Seite hat keine.
    const targets = [...source.matchAll(/fetch\((route|`[^`]*`)/g)].map((match) => match[1]);
    expect(targets).toEqual(["route", "route"]);
    const methods = [...source.matchAll(/method: "([A-Z]+)"/g)].map((match) => match[1]);
    expect(methods).toEqual(["POST"]);
    // Kein Schreibweg: keine Mutation, kein DELETE, kein PATCH, kein PUT.
    for (const verb of ["DELETE", "PATCH", "PUT"]) {
      expect(source, verb).not.toContain(`method: "${verb}"`);
    }
    expect(source).not.toContain("mutation");
  });

  it("shows the limits from the shared table and invents none of them", async () => {
    const source = await view();
    // Die Zahlen kommen aus der Antwort der Route, also aus derselben Tabelle,
    // mit der der Parser prueft. Eine Zahl im Quelltext der Ansicht waere eine
    // zweite Wahrheit.
    for (const limit of ["maxDepth", "maxFields", "maxTables", "maxRowsPerField",
      "maxRowsPerQuery", "defaultRowsPerField", "maxFiltersPerField", "maxQueryBytes"]) {
      expect(source, limit).toContain(`limits.${limit}`);
    }
    for (const literal of [String(DATA_API_GRAPHQL_LIMITS.maxFields),
      String(DATA_API_GRAPHQL_LIMITS.maxRowsPerQuery), String(DATA_API_GRAPHQL_LIMITS.maxQueryBytes)]) {
      expect(source, literal).not.toContain(`{${literal}}`);
    }
    // Der Ausschnitt der Sprache kommt ebenso von der Route und nicht von hier.
    expect(source).toContain("schema.grammar.accepted");
    expect(source).toContain("schema.grammar.refused");
  });

  it("renders every number through console-display", async () => {
    const source = await view();
    expect(source).toContain('from "@/components/console/console-display"');
    for (const forbidden of ["toLocaleString(", "toLocaleDateString(", "toFixed(", "new Intl."]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps the button width stable across its states", async () => {
    const source = await view();
    // Zwei Knoepfe wechseln ihre Beschriftung: der Ladeknopf und der
    // Ausfuehrungsknopf. Beide fuehren ihre Varianten mit.
    expect([...source.matchAll(/<StableLabel/g)]).toHaveLength(2);
    expect([...source.matchAll(/variants=\{tAll\(/g)]).toHaveLength(2);
  });
});
