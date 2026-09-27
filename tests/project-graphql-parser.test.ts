import { describe, expect, it } from "vitest";
import { DATA_API_GRAPHQL_LIMITS } from "@/lib/data-api-graphql-limits";
import {
  PROJECT_GRAPHQL_GRAMMAR,
  ProjectGraphqlError,
  planProjectGraphqlQuery,
  projectGraphqlSdl,
  projectGraphqlTypes,
} from "@/lib/server/data-plane/graphql";
import type { GeneratedTable } from "@/lib/server/data-plane/generated-api";

/**
 * Der Ausschnitt der Sprache, den die GraphQL-Flaeche kennt (2.83).
 *
 * Ohne Datenbank: Der Parser ist rein, und genau darum ist er einzeln
 * pruefbar. Der Fall (2.83) in `postgres.integration.test.ts` fuegt dazu, was
 * nur die echte Datenbank zeigen kann, naemlich die Zeilensicherheit.
 *
 * Geprueft wird hier jede Ablehnung mit ihrem Namen. Ein gemeinsames
 * "syntax error" waere fuer den Aufrufer unbrauchbar und fuer diesen Test
 * nichtssagend: Er koennte dann nicht unterscheiden, ob eine Variable als
 * Variable abgewiesen wurde oder ob der Parser sie gar nicht gelesen hat.
 */
function reason(query: string): string {
  try {
    planProjectGraphqlQuery(query);
    return "accepted";
  } catch (error) {
    if (!(error instanceof ProjectGraphqlError)) throw error;
    return error.reason;
  }
}

function table(name: string, columns: Array<Partial<GeneratedTable["columns"][number]> & { name: string }>): GeneratedTable {
  return {
    schema: "shop",
    name,
    kind: "table",
    rowSecurityEnabled: true,
    primaryKey: columns.filter((column) => column.primaryKeyPosition !== undefined).map((column) => column.name),
    columns: columns.map((column) => ({
      dataType: "text", nullable: true, identity: false, generated: false, sensitive: false,
      primaryKeyPosition: null, selectable: true, insertable: true, updateable: true, ...column,
    })),
  };
}

describe("project graphql subset", () => {
  it("plans a query with aliases, arguments and a filter", () => {
    const plan = planProjectGraphqlQuery(
      `query Bestellungen {
         offen: orders(limit: 5, orderBy: "created_at", direction: "desc", where: ["status:eq:open"]) {
           id
           schluessel: id
           total
         }
       }`,
    );
    expect(plan.operationName).toBe("Bestellungen");
    expect(plan.fields).toHaveLength(1);
    const field = plan.fields[0]!;
    expect(field.responseKey).toBe("offen");
    expect(field.table).toBe("orders");
    expect(field.limit).toBe(5);
    expect(field.order).toEqual({ column: "created_at", direction: "desc" });
    expect(field.filters).toEqual([{ column: "status", operator: "eq", value: "open" }]);
    // Drei Antwortschluessel, zwei Spalten: `id` wird einmal gelesen und zweimal
    // ausgegeben. Genau so umgeht ein Alias die Datenbank nicht.
    expect(field.selection.map((entry) => entry.responseKey)).toEqual(["id", "schluessel", "total"]);
    expect(field.columns).toEqual(["id", "total"]);
    // Gezaehlt wird jedes Vorkommen: das Tabellenfeld und die drei Spaltenfelder.
    expect(plan.fieldCount).toBe(4);
    expect(plan.rowBudget).toBe(5);
  });

  it("accepts the shorthand form, comments and a JSON filter value", () => {
    const plan = planProjectGraphqlQuery('# die offenen\n{ orders(where: ["total:gte:100", "paid:eq:true"]) { id } }');
    expect(plan.operationName).toBeNull();
    expect(plan.rowBudget).toBe(DATA_API_GRAPHQL_LIMITS.defaultRowsPerField);
    expect(plan.fields[0]!.filters).toEqual([
      { column: "total", operator: "gte", value: 100 },
      { column: "paid", operator: "eq", value: true },
    ]);
  });

  it("names every part of the language it does not serve", () => {
    expect(reason("mutation { insert_orders { id } }")).toBe("mutation_not_supported");
    expect(reason("subscription { orders { id } }")).toBe("subscription_not_supported");
    expect(reason("fragment F on orders { id }")).toBe("fragment_not_supported");
    expect(reason("{ ...F }")).toBe("fragment_not_supported");
    expect(reason("{ ... on orders { id } }")).toBe("fragment_not_supported");
    expect(reason("query ($grenze: Int) { orders(limit: $grenze) { id } }")).toBe("variable_not_supported");
    expect(reason("{ orders(limit: $grenze) { id } }")).toBe("variable_not_supported");
    expect(reason("{ orders @include(if: true) { id } }")).toBe("directive_not_supported");
    expect(reason("{ __schema { queryType } }")).toBe("introspection_not_supported");
    expect(reason("{ orders { __typename } }")).toBe("introspection_not_supported");
    expect(reason("{ tarnung: __type { name } }")).toBe("introspection_not_supported");
    expect(reason("{ orders(where: { status: \"open\" }) { id } }")).toBe("object_argument_not_supported");
    expect(reason("{ orders(direction: DESC, orderBy: \"id\") { id } }")).toBe("enum_not_supported");
    expect(reason('{ orders(where: """status:eq:open""") { id } }')).toBe("block_string_not_supported");
    expect(reason("{ orders { id } } { orders { id } }")).toBe("multiple_operations");
    expect(reason("{ orders { id } } query Zweite { orders { id } }")).toBe("multiple_operations");
  });

  it("rejects a query that is deeper than the two levels it has", () => {
    expect(reason("{ orders { id { mehr } } }")).toBe("depth_exceeded");
    expect(reason("{ orders { kunde { name } } }")).toBe("depth_exceeded");
    expect(reason("{ orders }")).toBe("selection_required");
    expect(reason("{ orders { } }")).toBe("empty_selection");
  });

  it("counts every alias against the field limit", () => {
    // Die Grenze ist die Zahl der Felder, nicht die Zahl der verschiedenen
    // Namen. Ein Alias erzeugt ein Feld in der Antwort und muss darum zaehlen,
    // sonst waere `a: id b: id c: id …` ein Weg um die Grenze herum.
    const overBudget = Array.from(
      { length: DATA_API_GRAPHQL_LIMITS.maxFields },
      (_, index) => `a${index}: id`,
    ).join(" ");
    expect(reason(`{ orders { ${overBudget} } }`)).toBe("fields_exceeded");
    const atBudget = Array.from(
      { length: DATA_API_GRAPHQL_LIMITS.maxFields - 1 },
      (_, index) => `a${index}: id`,
    ).join(" ");
    expect(reason(`{ orders { ${atBudget} } }`)).toBe("accepted");
    // Und auf der obersten Ebene ebenso: zwei Aliasse auf dieselbe Tabelle sind
    // zwei Lesungen.
    const tables = Array.from(
      { length: DATA_API_GRAPHQL_LIMITS.maxTables + 1 },
      (_, index) => `t${index}: orders { id }`,
    ).join(" ");
    expect(reason(`{ ${tables} }`)).toBe("tables_exceeded");
  });

  it("keeps a row budget over the whole query", () => {
    const perField = DATA_API_GRAPHQL_LIMITS.maxRowsPerField;
    const fields = Math.floor(DATA_API_GRAPHQL_LIMITS.maxRowsPerQuery / perField) + 1;
    const query = Array.from({ length: fields }, (_, index) => `t${index}: orders(limit: ${perField}) { id }`).join(" ");
    expect(reason(`{ ${query} }`)).toBe("rows_exceeded");
    expect(reason(`{ orders(limit: ${perField + 1}) { id } }`)).toBe("invalid_argument");
    expect(reason("{ orders(limit: 0) { id } }")).toBe("invalid_argument");
  });

  it("checks the arguments it knows and refuses the rest", () => {
    expect(reason("{ orders(offset: 10) { id } }")).toBe("unknown_argument");
    expect(reason("{ orders(limit: 1, limit: 2) { id } }")).toBe("duplicate_argument");
    expect(reason("{ orders { id id } }")).toBe("duplicate_response_key");
    expect(reason("{ orders { id(gross: true) } }")).toBe("column_arguments_not_supported");
    // `direction` ohne `orderBy` sortierte nach dem Primaerschluessel und sähe
    // aus wie eine Zusage ueber die genannte Spalte.
    expect(reason('{ orders(direction: "desc") { id } }')).toBe("invalid_argument");
    expect(reason('{ orders(orderBy: "nicht gueltig") { id } }')).toBe("invalid_argument");
    expect(reason('{ orders(where: ["status:like:open"]) { id } }')).toBe("filter_invalid");
    expect(reason('{ orders(where: ["status:eq:"]) { id } }')).toBe("filter_invalid");
    expect(reason('{ orders(where: [["status:eq:open"]]) { id } }')).toBe("nested_list_not_supported");
    const filters = Array.from(
      { length: DATA_API_GRAPHQL_LIMITS.maxFiltersPerField + 1 },
      () => '"status:eq:open"',
    ).join(", ");
    expect(reason(`{ orders(where: [${filters}]) { id } }`)).toBe("filters_exceeded");
  });

  it("refuses a query above the byte limit before it reads a token", () => {
    const padding = "#".repeat(DATA_API_GRAPHQL_LIMITS.maxQueryBytes + 1);
    expect(reason(padding)).toBe("query_too_large");
    expect(reason("   ")).toBe("query_empty");
    expect(reason("{ orders { id }")).toBe("unexpected_end");
  });

  it("builds the schema from the catalog and leaves out what it must", () => {
    const types = projectGraphqlTypes([
      table("orders", [
        { name: "id", dataType: "uuid", nullable: false, primaryKeyPosition: 1 },
        { name: "anzahl", dataType: "bigint" },
        { name: "menge", dataType: "integer" },
        { name: "bezahlt", dataType: "boolean", nullable: false },
        { name: "gewicht", dataType: "double precision" },
        // Eine Spalte mit sensiblem Namen und eine ohne Leserecht stehen nicht
        // im Schema; das entscheidet der Katalog und nicht diese Datei.
        { name: "api_token", sensitive: true },
        { name: "intern", selectable: false },
      ]),
      // Ein Name, den GraphQL der Introspektion vorbehaelt, bleibt draussen.
      table("__heimlich", [{ name: "id", primaryKeyPosition: 1 }]),
      // Eine Tabelle, von der keine Spalte uebrig bleibt, ergaebe einen leeren Typ.
      table("nurgeheim", [{ name: "secret", sensitive: true }]),
    ]);
    expect(types.map((type) => type.name)).toEqual(["orders"]);
    const fields = new Map(types[0]!.fields.map((field) => [field.name, field]));
    expect([...fields.keys()]).toEqual(["id", "anzahl", "menge", "bezahlt", "gewicht"]);
    expect(fields.get("id")).toMatchObject({ type: "ID", nullable: false, primaryKey: true });
    // bigint wird String, weil die Data API ihn als Dezimalstring zurueckgibt:
    // ein Int im Schema waere eine Zusage, die die Antwort nicht haelt.
    expect(fields.get("anzahl")!.type).toBe("String");
    expect(fields.get("menge")!.type).toBe("Int");
    expect(fields.get("bezahlt")).toMatchObject({ type: "Boolean", nullable: false });
    expect(fields.get("gewicht")!.type).toBe("Float");

    const sdl = projectGraphqlSdl(types);
    expect(sdl).toContain("type Query {");
    expect(sdl).toContain("  orders(limit: Int, orderBy: String, direction: String, where: [String!], after: String): [orders!]!");
    expect(sdl).toContain("type orders {");
    expect(sdl).toContain("  id: ID!");
    expect(sdl).toContain("  menge: Int\n");
    expect(sdl).not.toContain("api_token");
    expect(sdl).not.toContain("intern");
    expect(sdl).not.toContain("__heimlich");
    // Kein Mutationstyp im Schema. Was nicht im Schema steht, wird auch nicht
    // versprochen.
    expect(sdl).not.toContain("type Mutation");
  });

  it("says that a schema without a single usable table is empty", () => {
    const sdl = projectGraphqlSdl(projectGraphqlTypes([]));
    expect(sdl).toContain("Keine Tabelle dieses Schemas erfuellt die Bedingungen.");
    expect(sdl).not.toContain("type Mutation");
  });

  it("keeps the described grammar and what the parser does in step", () => {
    // Die Console zeigt diese Listen. Ein Eintrag, den es im Parser nicht gibt,
    // waere eine Zusage auf der Seite ohne Deckung im Code.
    expect(PROJECT_GRAPHQL_GRAMMAR.refused).toContain("mutation");
    expect(PROJECT_GRAPHQL_GRAMMAR.refused).toContain("introspection");
    expect(PROJECT_GRAPHQL_GRAMMAR.accepted).toContain("aliases");
    expect(new Set(PROJECT_GRAPHQL_GRAMMAR.accepted).size).toBe(PROJECT_GRAPHQL_GRAMMAR.accepted.length);
    expect(new Set(PROJECT_GRAPHQL_GRAMMAR.refused).size).toBe(PROJECT_GRAPHQL_GRAMMAR.refused.length);
  });
});
