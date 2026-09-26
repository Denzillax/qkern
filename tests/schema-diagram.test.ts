import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSchemaDiagram, columnsPerRow, type DiagramRelation, type DiagramTable } from "@/lib/console/schema-diagram";

/**
 * Das Diagramm des Schema-Visualizers (2.41) ist eine reine Funktion: gleiche
 * Eingabe, gleiche Ausgabe, keine Farbe, keine Sprache. Genau das steht hier.
 */
function table(name: string, columns: Array<[string, string, boolean?]>): DiagramTable {
  return { name, columns: columns.map(([column, dataType, notNull]) => ({ name: column, dataType, notNull: notNull === true })) };
}

function relation(overrides: Partial<DiagramRelation> & Pick<DiagramRelation, "name" | "table" | "referencedTable">): DiagramRelation {
  return {
    columns: ["id"], referencedColumns: ["id"], referencedSchema: "public", onDelete: "no_action",
    ...overrides,
  };
}

const TABLES: DiagramTable[] = [
  table("orders", [["id", "integer", true], ["customer_id", "integer", true], ["note", "text"]]),
  table("customers", [["id", "integer", true], ["email", "text", true]]),
  table("nodes", [["id", "integer", true], ["parent_id", "integer"]]),
];

const RELATIONS: DiagramRelation[] = [
  relation({ name: "orders_customer_fkey", table: "orders", columns: ["customer_id"], referencedTable: "customers", onDelete: "cascade" }),
  relation({ name: "nodes_parent_fkey", table: "nodes", columns: ["parent_id"], referencedTable: "nodes" }),
  relation({ name: "orders_region_fkey", table: "orders", columns: ["note"], referencedSchema: "Shop", referencedTable: "regions", referencedColumns: ["code"] }),
];

function overlaps(left: { x: number; y: number; width: number; height: number }, right: typeof left): boolean {
  return left.x < right.x + right.width && right.x < left.x + left.width &&
    left.y < right.y + right.height && right.y < left.y + left.height;
}

describe("schema diagram", () => {
  it("draws the same picture for the same input, whatever order it arrives in", () => {
    const first = buildSchemaDiagram({ schema: "public", tables: TABLES, relations: RELATIONS });
    const second = buildSchemaDiagram({ schema: "public", tables: [...TABLES].reverse(), relations: [...RELATIONS].reverse() });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // Nach Namen sortiert, nicht in Eingabereihenfolge; die fremde Tabelle kommt hinten.
    expect(first.boxes.map((box) => box.id)).toEqual(["customers", "nodes", "orders", "Shop.regions"]);
  });

  it("never lets two boxes overlap, in any table count", () => {
    for (const count of [1, 2, 3, 4, 5, 9, 10, 17, 40]) {
      const many = Array.from({ length: count }, (_, index) =>
        // Unterschiedlich hohe Kaesten: nur so faellt eine Gitterzeile auf, die ihre Hoehe vom ersten Kasten nimmt.
        table(`t${String(index).padStart(2, "0")}`, Array.from({ length: (index % 7) + 1 }, (_, row) => [`c${row}`, "text"] as [string, string])));
      const diagram = buildSchemaDiagram({ schema: "public", tables: many, relations: [] });
      expect(diagram.boxes).toHaveLength(count);
      expect(diagram.columnsPerRow).toBe(columnsPerRow(count));
      for (const [index, box] of diagram.boxes.entries()) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `t${index} ragt rechts heraus`).toBeLessThanOrEqual(diagram.width);
        expect(box.y + box.height, `t${index} ragt unten heraus`).toBeLessThanOrEqual(diagram.height);
        for (const other of diagram.boxes.slice(index + 1)) {
          expect(overlaps(box, other), `${box.id} und ${other.id} ueberschneiden sich`).toBe(false);
        }
      }
    }
  });

  it("draws a self-referencing key as a loop on its own box", () => {
    const diagram = buildSchemaDiagram({ schema: "public", tables: TABLES, relations: RELATIONS });
    const loop = diagram.edges.find((edge) => edge.name === "nodes_parent_fkey");
    expect(loop).toBeDefined();
    expect(loop!.selfReference).toBe(true);
    expect(loop!.from).toBe("nodes");
    expect(loop!.to).toBe("nodes");
    const box = diagram.boxes.find((entry) => entry.id === "nodes")!;
    // Die Schlaufe verlaesst die rechte Kante und kommt dort wieder an.
    expect(loop!.path.startsWith(`M ${box.x + box.width} `)).toBe(true);
    expect(loop!.path.endsWith(`H ${box.x + box.width}`)).toBe(true);
    expect(loop!.path).toMatch(/^M [\d.]+ [\d.]+ H [\d.]+ V [\d.]+ H [\d.]+$/);
    expect(loop!.arrow).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
  });

  it("names the other schema instead of dropping the key", () => {
    const diagram = buildSchemaDiagram({ schema: "public", tables: TABLES, relations: RELATIONS });
    const external = diagram.boxes.find((box) => box.external);
    expect(external).toBeDefined();
    expect(external!.id).toBe("Shop.regions");
    expect(external!.title).toContain("Shop");
    // Die Zielspalte steht im Kasten, damit das Bild sagt, worauf verwiesen wird.
    expect(external!.rows.map((row) => row.column)).toEqual(["code"]);
    const edge = diagram.edges.find((entry) => entry.name === "orders_region_fkey")!;
    expect(edge.external).toBe(true);
    expect(edge.to).toBe("Shop.regions");
    expect(edge.selfReference).toBe(false);
    // Jede Kante findet ihr Ziel; keine wird still verworfen.
    expect(diagram.edges).toHaveLength(RELATIONS.length);
  });

  it("marks the referencing columns, the types and NOT NULL, and hides nothing it can show", () => {
    const diagram = buildSchemaDiagram({ schema: "public", tables: TABLES, relations: RELATIONS });
    const orders = diagram.boxes.find((box) => box.id === "orders")!;
    expect(orders.hiddenColumns).toBe(0);
    expect(orders.rows.map((row) => [row.column, row.dataType, row.notNull, row.foreignKey])).toEqual([
      ["id", "integer", true, false],
      ["customer_id", "integer", true, true],
      ["note", "text", false, true],
    ]);
    // Die Zeilen liegen der Reihe nach tiefer und bleiben im Kasten.
    for (const row of orders.rows) {
      expect(row.y).toBeGreaterThan(orders.dividerY);
      expect(row.y).toBeLessThan(orders.y + orders.height);
    }
    expect(orders.rows.map((row) => row.y)).toEqual([...orders.rows.map((row) => row.y)].sort((left, right) => left - right));
  });

  it("caps a wide table and says how many columns it left out", () => {
    const wide = table("wide", Array.from({ length: 30 }, (_, index) => [`c${index}`, "text"] as [string, string]));
    const diagram = buildSchemaDiagram({ schema: "public", tables: [wide], relations: [] });
    const box = diagram.boxes[0];
    expect(box.rows).toHaveLength(12);
    expect(box.hiddenColumns).toBe(18);
    expect(box.hiddenY).toBeGreaterThan(box.rows[11].y);
    expect(box.hiddenY).toBeLessThan(box.y + box.height);
  });

  it("stays empty and finite without tables", () => {
    const diagram = buildSchemaDiagram({ schema: "public", tables: [], relations: [] });
    expect(diagram.boxes).toEqual([]);
    expect(diagram.edges).toEqual([]);
    expect(diagram.width).toBeGreaterThan(0);
    expect(diagram.height).toBeGreaterThan(0);
  });

  it("puts no colour into the picture and leaves the theme to the view", async () => {
    const diagram = buildSchemaDiagram({ schema: "public", tables: TABLES, relations: RELATIONS });
    const rendered = JSON.stringify(diagram);
    for (const forbidden of ["#", "rgb", "hsl", "black", "white", "currentColor", "fill", "stroke"]) {
      expect(rendered.toLowerCase(), `Farbe oder Stil im Diagramm: ${forbidden}`).not.toContain(forbidden.toLowerCase());
    }
    const source = await readFile(path.resolve(process.cwd(), "lib/console/schema-diagram.ts"), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(/);
    // Die Ansicht faerbt nur mit currentColor und den Variablen der Console.
    const view = await readFile(path.resolve(process.cwd(), "components/console/schema-visualizer-view.tsx"), "utf8");
    expect(view).toContain("currentColor");
    expect(view).not.toMatch(/#[0-9a-fA-F]{3,8}"/);
    expect(view).not.toMatch(/"(?:black|white)"/);
  });
});
