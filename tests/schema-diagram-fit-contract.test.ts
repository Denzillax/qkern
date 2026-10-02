import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildSchemaDiagram, fitRowText } from "@/lib/console/schema-diagram";

/**
 * Im Schemabild ueberlappen Spaltenname und Typ nicht (2.133).
 *
 * **Der Befund.** Der Name steht links im Kasten, der Typ rechts, und zwischen
 * beiden stand nichts. `angelegt_am timestamp with time zone` brauchte mehr
 * Platz als der Kasten hat, und im Bild stand `angelegtjamstamp with time
 * zone`. Gefunden hat das kein Vertrag, sondern der erste Blick eines Menschen
 * in die Konsole nach `2.74.0`.
 *
 * **Warum der Render-Vertrag es nicht fand.** Er rendert jede Ansicht und
 * prueft, dass sie ohne Fehler durchlaeuft. Ein Text, der einen anderen
 * ueberschreibt, ist kein Fehler; im Markup stehen beide ordentlich
 * nebeneinander. Sichtbar wird es erst aus den Koordinaten, und genau die
 * rechnet dieser Vertrag nach.
 *
 * **Was er nicht kann.** Er rechnet mit dem Vorschub einer Festbreitenschrift
 * und nicht mit dem, was ein Browser wirklich setzt. Faellt die Schrift auf
 * eine aus, die breiter laeuft als 0,62 der Schriftgroesse, stimmt die Rechnung
 * nicht mehr. Darum rechnet `fitRowText` mit Reserve, und darum prueft dieser
 * Vertrag zusaetzlich, dass die Reserve im Quelltext steht.
 */
const COLUMN_FONT_PX = 11;
const TYPE_FONT_PX = 10.5;
/** Grosszuegiger als der Quelltext: Eine Schrift darf breiter laufen. */
const CHECK_ADVANCE = 0.65;
const BOX_WIDTH = 236;
const PADDING = 12;

function drawnWidths(row: { column: string; dataType: string; foreignKey: boolean; notNull: boolean }) {
  const name = (row.foreignKey ? "→ " : "") + row.column;
  const type = row.dataType + (row.notNull ? " *" : "");
  return {
    left: PADDING + name.length * COLUMN_FONT_PX * CHECK_ADVANCE,
    right: BOX_WIDTH - PADDING - type.length * TYPE_FONT_PX * CHECK_ADVANCE,
  };
}

const LONG_TABLE = {
  schema: "public",
  name: "beitraege",
  columns: [
    { name: "id", dataType: "integer", notNull: true, primaryKey: true },
    { name: "angelegt_am", dataType: "timestamp with time zone", notNull: true },
    { name: "zuletzt_geaendert_am_von_einem_sehr_langen_namen", dataType: "timestamp with time zone", notNull: true },
    { name: "kurz", dataType: "text", notNull: false },
  ],
};

describe("schema diagram fit contract", () => {
  it("keeps the column name clear of the data type in every row", () => {
    const diagram = buildSchemaDiagram({ schema: "public", tables: [LONG_TABLE], relations: [] } as never);
    const rows = diagram.boxes.flatMap((box) => box.rows);
    expect(rows.length).toBe(LONG_TABLE.columns.length);

    for (const row of rows) {
      const { left, right } = drawnWidths(row);
      expect(left, `${row.columnFull}: Name laeuft in den Typ`).toBeLessThanOrEqual(right);
    }
  });

  it("shortens the type before the name, and says so", () => {
    const fitted = fitRowText("angelegt_am", "timestamp with time zone", {
      foreignKey: false, notNull: true,
    });
    // Der Name benennt die Spalte und bleibt ganz, der Typ ist die Beigabe.
    expect(fitted.column).toBe("angelegt_am");
    expect(fitted.dataType).not.toBe("timestamp with time zone");
    expect(fitted.dataType.endsWith("…")).toBe(true);
    expect(fitted.shortened).toBe(true);
  });

  it("leaves a row that fits untouched", () => {
    const fitted = fitRowText("id", "integer", { foreignKey: false, notNull: true });
    expect(fitted).toEqual({ column: "id", dataType: "integer", shortened: false });
  });

  it("gives up name characters only when the type is already at its floor", () => {
    const fitted = fitRowText("zuletzt_geaendert_am_von_einem_sehr_langen_namen", "timestamp with time zone", {
      foreignKey: true, notNull: true,
    });
    expect(fitted.column).not.toBe("zuletzt_geaendert_am_von_einem_sehr_langen_namen");
    expect(fitted.column.endsWith("…")).toBe(true);
    expect(fitted.dataType.length).toBeGreaterThanOrEqual(8);
  });

  it("hangs the full text on a shortened row and keeps the edge badge short", async () => {
    const view = await readFile(
      path.resolve(process.cwd(), "components/console/schema-visualizer-view.tsx"), "utf8");
    // Ohne Titel waere der gekuerzte Text verloren: Das Bild zeigt ihn nicht,
    // und die Prosa darunter nennt nur Beziehungen, nicht jede Spalte.
    expect(view).toMatch(/row\.shortened && <title>/);
    // Der ganze Satz passt nicht zwischen zwei Kaesten; an der Kante steht das
    // Wort, das auch in der Anweisung stand.
    expect(view).toContain('case "cascade": return "CASCADE";');
    expect(view).toMatch(/onDeleteBadge\(edge\.onDelete\)/);
    // Der Satz bleibt, aber in der Prosa darunter.
    expect(view).toMatch(/onDeleteLabel\(key\.onDelete\)/);
  });
});
