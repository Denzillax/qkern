import { describe, expect, it } from "vitest";
import {
  hottestQueryPlanNode,
  QUERY_PLAN_HOT_SHARE,
  QUERY_PLAN_MAX_NODES,
  QUERY_PLAN_NODE_MEANINGS,
  QueryPlanError,
  queryInsightsTexts,
  readQueryPlan,
} from "@/lib/console/query-insights";

/**
 * Das reine Modul hinter Berichte -> Abfrage-Einblicke (2.69).
 *
 * Geprueft wird hier, was ohne Datenbank pruefbar ist: dass aus der
 * JSON-Antwort von EXPLAIN eine flache Liste wird, dass der Eigenanteil
 * wirklich der eigene ist, und dass keine Bedingung der Abfrage mitkommt. Ob
 * PostgreSQL diese Antwort auch so schickt, belegt der Fall 2.69 im
 * PostgreSQL-Stack; ein Nachbau kann das nicht.
 */
function node(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Node Type": "Seq Scan", "Relation Name": "vorlagen",
    "Startup Cost": 0, "Total Cost": 100, "Plan Rows": 3, "Plan Width": 40,
    ...overrides,
  };
}

describe("query plan reading", () => {
  it("flattens the tree in pre-order with the depth of each node", () => {
    const reading = readQueryPlan([{
      Plan: node({
        "Node Type": "Sort", "Relation Name": null, "Total Cost": 200,
        Plans: [node({ "Node Type": "Hash Join", "Relation Name": null, "Total Cost": 150, Plans: [
          node({ "Node Type": "Seq Scan", "Relation Name": "links", "Total Cost": 60 }),
          node({ "Node Type": "Seq Scan", "Relation Name": "rechts", "Total Cost": 40 }),
        ] })],
      }),
    }]);

    expect(reading.nodes.map((entry) => [entry.operation, entry.depth])).toEqual([
      ["Sort", 0], ["Hash Join", 1], ["Seq Scan", 2], ["Seq Scan", 2],
    ]);
    expect(reading.nodes.map((entry) => entry.id)).toEqual([0, 1, 2, 3]);
    expect(reading.totalCost).toBe(200);
  });

  it("counts the own cost of a node without the cost of its children", () => {
    // Die Kosten eines Knotens enthalten in PostgreSQL die seiner Kinder.
    // Waere der Anteil aus den Gesamtkosten gerechnet, truege die Wurzel immer
    // 100 Prozent, und die Liste sagte nichts darueber, wo es teuer wird.
    const reading = readQueryPlan([{
      Plan: node({ "Node Type": "Sort", "Relation Name": null, "Total Cost": 200, Plans: [
        node({ "Node Type": "Seq Scan", "Relation Name": "gross", "Total Cost": 150 }),
      ] }),
    }]);
    const [sort, scan] = reading.nodes;
    expect(sort.totalCost).toBe(200);
    expect(sort.ownCost).toBe(50);
    expect(sort.costShare).toBeCloseTo(0.25, 10);
    expect(scan.ownCost).toBe(150);
    expect(scan.costShare).toBeCloseTo(0.75, 10);
    // Und die Eigenanteile eines Plans summieren sich auf die Gesamtkosten.
    expect(reading.nodes.reduce((sum, entry) => sum + entry.ownCost, 0)).toBe(200);
  });

  it("never reports a negative own share when an estimate rounds against it", () => {
    const reading = readQueryPlan([{
      Plan: node({ "Total Cost": 10, Plans: [node({ "Total Cost": 12 })] }),
    }]);
    expect(reading.nodes[0].ownCost).toBe(0);
    expect(reading.nodes[0].costShare).toBe(0);
  });

  it("names the indexes it uses and the relations it reads sequentially", () => {
    const reading = readQueryPlan([{
      Plan: node({ "Node Type": "Nested Loop", "Relation Name": null, "Total Cost": 300, Plans: [
        node({ "Node Type": "Index Scan", "Relation Name": "vorlagen", "Index Name": "vorlagen_pkey" }),
        node({ "Node Type": "Index Only Scan", "Relation Name": "vorlagen", "Index Name": "vorlagen_pkey" }),
        node({ "Node Type": "Seq Scan", "Relation Name": "ohne_schluessel" }),
        node({ "Node Type": "Seq Scan", "Relation Name": "ohne_schluessel" }),
      ] }),
    }]);
    // Ohne Wiederholung: derselbe Index in zwei Knoten ist ein Index.
    expect(reading.indexes).toEqual(["vorlagen_pkey"]);
    expect(reading.sequentialScans).toEqual(["ohne_schluessel"]);
  });

  it("carries no condition of the query, whatever the plan brings along", () => {
    // Der Punkt dieses Schnitts: `Filter` und `Index Cond` tragen die
    // Literale der Abfrage woertlich. Sie duerfen die Datenbank nicht
    // verlassen, auch nicht in einem Feld, das niemand anzeigt.
    const secret = "geheim-a1b2c3";
    const reading = readQueryPlan([{
      Plan: node({
        "Node Type": "Index Scan", "Index Name": "vorlagen_notiz_idx",
        Filter: `(notiz = '${secret}'::text)`,
        "Index Cond": `(notiz = '${secret}'::text)`,
        Output: [`notiz = '${secret}'`],
      }),
    }]);
    const serialized = JSON.stringify(reading);
    expect(serialized, "der Plan traegt ein Literal der Abfrage").not.toContain(secret);
    expect(serialized).not.toContain("Filter");
    expect(serialized).not.toContain("Index Cond");
    expect(reading.nodes[0].indexName).toBe("vorlagen_notiz_idx");
  });

  it("takes the measured planning time and nothing where none is given", () => {
    expect(readQueryPlan([{ Plan: node(), "Planning Time": 0.412 }]).planningTimeMs).toBe(0.412);
    expect(readQueryPlan([{ Plan: node() }]).planningTimeMs).toBeNull();
    expect(readQueryPlan([{ Plan: node(), "Planning Time": "schnell" }]).planningTimeMs).toBeNull();
  });

  it("cuts a plan that is too big and says so instead of pretending it ended", () => {
    // Ein tief verschachtelter Plan, tiefer als die Grenze.
    let deepest: Record<string, unknown> = node();
    for (let index = 0; index < QUERY_PLAN_MAX_NODES + 10; index += 1) {
      deepest = node({ "Node Type": "Nested Loop", "Total Cost": 1_000, Plans: [deepest] });
    }
    const reading = readQueryPlan([{ Plan: deepest }]);
    expect(reading.nodes.length).toBe(QUERY_PLAN_MAX_NODES);
    expect(reading.truncated).toBe(true);
    // Ein Plan innerhalb der Grenze wird nicht als gekuerzt ausgegeben.
    expect(readQueryPlan([{ Plan: node() }]).truncated).toBe(false);
  });

  it("refuses an answer that is not a plan instead of guessing one", () => {
    for (const raw of [null, [], [{}], "EXPLAIN", { Plan: null }, { Plan: [] }, 42]) {
      expect(() => readQueryPlan(raw)).toThrow(QueryPlanError);
    }
  });

  it("points at the node that carries the cost, and at none when they spread", () => {
    const spread = readQueryPlan([{
      Plan: node({ "Node Type": "Append", "Relation Name": null, "Total Cost": 1_000, Plans: [
        node({ "Total Cost": 100 }), node({ "Total Cost": 100 }), node({ "Total Cost": 100 }),
        node({ "Total Cost": 100 }), node({ "Total Cost": 100 }), node({ "Total Cost": 100 }),
      ] }),
    }]);
    // Die Wurzel traegt 400 von 1000, also mehr als ein Fuenftel.
    expect(hottestQueryPlanNode(spread)?.operation).toBe("Append");

    const flat = readQueryPlan([{
      Plan: node({ "Node Type": "Limit", "Relation Name": null, "Total Cost": 1_000, Plans: [
        node({ "Total Cost": 100 }), node({ "Total Cost": 100 }), node({ "Total Cost": 100 }),
        node({ "Total Cost": 100 }), node({ "Total Cost": 100 }), node({ "Total Cost": 100 }),
        node({ "Total Cost": 100 }), node({ "Total Cost": 100 }), node({ "Total Cost": 100 }),
        node({ "Total Cost": 100 }),
      ] }),
    }]);
    expect(flat.nodes.every((entry) => entry.costShare < QUERY_PLAN_HOT_SHARE)).toBe(true);
    expect(hottestQueryPlanNode(flat)).toBeNull();
  });

  it("keeps every text of the module in one list for the translation contract", () => {
    const texts = queryInsightsTexts();
    expect(new Set(texts).size).toBe(texts.length);
    for (const meaning of Object.values(QUERY_PLAN_NODE_MEANINGS)) {
      expect(texts, meaning).toContain(meaning);
    }
    // Eine Erklaerung, die nur aus einem Wort besteht, erklaert nichts.
    for (const meaning of Object.values(QUERY_PLAN_NODE_MEANINGS)) {
      expect(meaning.length, meaning).toBeGreaterThan(30);
    }
  });
});
