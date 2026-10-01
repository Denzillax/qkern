import { describe, expect, it } from "vitest";
import { FREE_QUERY_FUNCTIONS, readFreeQuery } from "@/lib/server/data-plane/free-query";

/**
 * Die Lesung einer freien Abfrage (2.117).
 *
 * Diese Faelle brauchen keine Datenbank: Was hier faellt, faellt bevor eine
 * Verbindung aufgeht. Die Zusagen gegen die echte Datenbank stehen in
 * `tests/postgres.integration.test.ts` unter derselben Nummer.
 */
describe("free query reading", () => {
  const read = (statement: string) => readFreeQuery(statement, "shop");
  const reason = (statement: string) => {
    const reading = read(statement);
    return reading.ok ? "accepted" : reading.reason;
  };

  it("(2.117) nimmt eine qualifizierte Abfrage an und nennt jede Relation", () => {
    const reading = read(
      `SELECT count(*) FROM shop.bestellungen b
         JOIN shop.kunden k ON k.id = b.kunde
        WHERE b.betrag > (SELECT avg(betrag) FROM shop.bestellungen)`);
    expect(reading.ok).toBe(true);
    if (!reading.ok) throw new Error("unerreichbar");
    // Jede Relation genau einmal, und die Unterabfrage ist dabei.
    expect(reading.relations).toEqual([
      { schema: "shop", name: "bestellungen" },
      { schema: "shop", name: "kunden" },
    ]);
    expect(reading.functions).toEqual(["avg", "count"]);
  });

  it("(2.117) verlangt das Schema an jeder Tabelle", () => {
    // Ohne diese Regel waere die Lesung hier eine Annahme: Die Abfrage laeuft
    // mit `search_path = pg_catalog`, und ein unqualifizierter Name loest dort
    // auf und nicht im Schema der Anfrage.
    expect(reason("SELECT * FROM bestellungen")).toBe("relation_without_schema");
    expect(reason("SELECT * FROM lager.bestellungen")).toBe("relation_foreign_schema");
    expect(reason("SELECT * FROM pg_catalog.pg_class")).toBe("relation_foreign_schema");
    expect(reason("SELECT * FROM information_schema.tables")).toBe("relation_foreign_schema");
    expect(reason("SELECT * FROM qkern_internal.migrations")).toBe("relation_foreign_schema");
  });

  it("(2.117) laesst einen CTE-Namen nur dort gelten, wo PostgreSQL ihn gelten laesst", () => {
    expect(reason(`WITH gross AS (SELECT * FROM shop.bestellungen) SELECT * FROM gross`))
      .toBe("accepted");
    // Der Name der eigenen Bindung gilt in ihr noch nicht. Das innere
    // `bestellungen` ist die echte Tabelle, und ohne diese Reihenfolge waere es
    // ein Weg um die Pruefung je Tabelle herum.
    expect(reason(`WITH bestellungen AS (SELECT * FROM bestellungen) SELECT * FROM bestellungen`))
      .toBe("relation_without_schema");
    // Eine spaetere Bindung sieht die frueheren.
    expect(reason(
      `WITH a AS (SELECT * FROM shop.bestellungen), b AS (SELECT * FROM a) SELECT * FROM b`))
      .toBe("accepted");
    // Und die Relation hinter dem CTE wird wirklich genannt.
    const reading = read(`WITH gross AS (SELECT * FROM shop.bestellungen) SELECT * FROM gross`);
    expect(reading.ok && reading.relations).toEqual([{ schema: "shop", name: "bestellungen" }]);
  });

  it("(2.117) nimmt nur unqualifizierte Funktionen von der Liste", () => {
    for (const name of FREE_QUERY_FUNCTIONS) {
      expect(reason(`SELECT ${name}(betrag) FROM shop.bestellungen`)).toBe("accepted");
    }
    // Eine Funktion mit Schema koennte SECURITY DEFINER sein, und ihr Rumpf
    // steht nicht im Abfragetext.
    expect(reason("SELECT shop.geheim() FROM shop.bestellungen")).toBe("qualified_reference");
    expect(reason("SELECT public.geheim(1)")).toBe("qualified_reference");
    // Und auch im Systemkatalog ist nicht alles harmlos: `query_to_xml` fuehrt
    // eine Abfrage aus einem Textargument aus.
    expect(reason("SELECT query_to_xml('SELECT 1', false, false, '')"))
      .toBe("function_not_allowed");
    expect(reason("SELECT current_setting('request.jwt.claims')")).toBe("function_not_allowed");
    // Auch in der FROM-Klausel: eine Funktion mit Schema faellt als
    // qualifizierter Verweis, eine ohne Schema an der Liste.
    expect(reason("SELECT * FROM shop.eine_funktion(1)")).toBe("qualified_reference");
    expect(reason("SELECT * FROM eine_funktion(1)")).toBe("function_not_allowed");
  });

  it("(2.117) nimmt keinen qualifizierten Operator und keinen qualifizierten Cast", () => {
    expect(reason("SELECT betrag OPERATOR(shop.+) 1 FROM shop.bestellungen"))
      .toBe("qualified_reference");
    expect(reason("SELECT betrag::shop.waehrung FROM shop.bestellungen"))
      .toBe("qualified_reference");
    // Unqualifiziert bleibt beides erlaubt; es loest dann in `pg_catalog` auf.
    expect(reason("SELECT betrag::text FROM shop.bestellungen")).toBe("accepted");
  });

  it("(2.117) laesst nur ein einzelnes SELECT durch", () => {
    for (const statement of [
      "DELETE FROM shop.bestellungen",
      "SELECT 1; SELECT 2",
      "UPDATE shop.bestellungen SET betrag = 1",
      "WITH RECURSIVE r AS (SELECT 1 AS n) SELECT * FROM r",
      "SELECT pg_read_file('/etc/passwd')",
      "SELECT * FROM shop.bestellungen INTO neu",
    ]) {
      expect(reason(statement)).toBe("statement_not_read_only");
    }
    // Ein Union aus zwei geprueften Haelften ist eines.
    expect(reason("SELECT id FROM shop.kunden UNION SELECT id FROM shop.bestellungen"))
      .toBe("accepted");
  });

  it("(2.117) nimmt kein Systemschema als Schema der Anfrage", () => {
    expect(readFreeQuery("SELECT 1", "pg_catalog")).toEqual({ ok: false, reason: "identifier_rejected" });
    expect(readFreeQuery("SELECT 1", "qkern_internal")).toEqual({ ok: false, reason: "identifier_rejected" });
    expect(readFreeQuery("SELECT 1", "information_schema"))
      .toEqual({ ok: false, reason: "identifier_rejected" });
  });
});
