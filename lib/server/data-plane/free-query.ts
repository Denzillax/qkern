import { parse } from "pgsql-ast-parser";
import { isReadOnlySql } from "@/lib/security";
import { isDataIdentifier, isDataSchemaName } from "@/lib/server/data-plane/identifiers";

/**
 * Die Lesung einer freien Abfrage, bevor die Datenbank sie sieht (2.117).
 *
 * ## Wozu es diese Datei gibt
 *
 * Die generierte Data API liest unter der Zeilensicherheit, und sie kann das
 * zusagen, weil sie je Anfrage **eine** Tabelle kennt: `assertTableBoundary`
 * verlangt an ihr Zeilensicherheit, verlangt, dass die Projektrolle nicht ihr
 * Eigentuemer ist, und verlangt das Leserecht. Eine freie Abfrage nennt keine
 * Tabelle in einem Feld. Sie nennt sie im Text, und ohne eine Lesung dieses
 * Textes gibt es nichts, worauf dieselbe Pruefung zeigen koennte.
 *
 * Genau das ist der Grund, warum `qkern_query_readonly` bis 2.116 keinen
 * Bereich hatte. Der Weg der Data Plane liest mit derselben Rolle und mit
 * `SET LOCAL row_security = on`, aber ohne Ansprueche: Eine Policy, die
 * `request.jwt.claims` liest, findet dort nichts, und eine Tabelle ohne Policy
 * gibt alles her. Diese Datei liefert das fehlende Stueck.
 *
 * ## Die eine tragende Regel
 *
 * **Tabellen mit Schema, alles andere ohne.** Eine Relation muss im Text ihr
 * Schema tragen, und dieses Schema muss das Schema der Anfrage sein. Eine
 * Funktion, ein Operator und ein Cast duerfen ihr Schema **nicht** tragen.
 *
 * Diese Regel ist keine Formsache. Die Abfrage laeuft mit
 * `SET LOCAL search_path = pg_catalog`, also loest PostgreSQL jeden
 * unqualifizierten Namen nur im Systemkatalog auf. Damit kann die Lesung hier
 * nicht anders ausfallen als die Auflösung dort: Eine Tabelle steht qualifiziert
 * im Text und wird genau so gefunden, eine Funktion ohne Schema kann keine
 * Funktion eines Nutzerschemas sein, und dasselbe gilt fuer einen Operator aus
 * `OPERATOR(public.+)` und fuer einen Cast nach `public.mytype`. Ohne diese
 * Regel bliebe eine Luecke, die niemand sieht: Eine Funktion mit
 * `SECURITY DEFINER` laeuft mit den Rechten ihres Eigentuemers, ihr Rumpf liest
 * was er will, und im Abfragetext steht nur ihr Name.
 *
 * Die Funktionsliste kommt dazu, weil `pg_catalog` selbst nicht harmlos ist.
 * `query_to_xml` fuehrt eine Abfrage aus einem Textargument aus, `pg_ls_dir`
 * liest ein Verzeichnis. Darum ist nicht gesperrt, was gefaehrlich ist, sondern
 * nur erlaubt, was auf der Liste steht.
 *
 * ## Was ein CTE hier bedeutet
 *
 * Ein Name aus `WITH` ist die einzige Relation ohne Schema, die durchkommt, und
 * sie gilt genau dort, wo PostgreSQL sie auch gelten laesst: in den spaeteren
 * Bindungen und im Hauptteil. In der eigenen Bindung gilt sie nicht. Darum
 * faellt `WITH notizen AS (SELECT * FROM notizen) ...` mit der Begruendung, dass
 * das innere `notizen` kein Schema traegt. Es ist die echte Tabelle, und ohne
 * diese Reihenfolge waere es ein Weg, die Pruefung je Tabelle zu umgehen.
 *
 * `WITH RECURSIVE` gibt es auf diesem Weg nicht. Der Parser kennt es nicht,
 * also faellt es schon an `isReadOnlySql`.
 *
 * ## Was diese Lesung nicht ist
 *
 * Sie ist keine zweite Zeilensicherheit. Was sie findet, geht danach durch
 * dieselbe Pruefung je Tabelle wie eine Anfrage der Data API, und ausgefuehrt
 * wird die Abfrage in derselben Transaktion mit denselben Anspruechen. Faende
 * diese Lesung eine Relation nicht, die PostgreSQL doch liest, dann bliebe die
 * Zeilensicherheit darunter trotzdem an: Die Rolle traegt kein `BYPASSRLS`, und
 * `row_security` steht auf `on`. Verloren waere in diesem Fall die Zusage ueber
 * Tabellen **ohne** Policy, und nicht die Zusage ueber fremde Zeilen.
 */

/** Die Funktionen, die eine freie Abfrage aufrufen darf. Unqualifiziert, also aus `pg_catalog`. */
export const FREE_QUERY_FUNCTIONS: readonly string[] = [
  "abs", "avg", "ceil", "ceiling", "char_length", "coalesce", "concat", "count",
  "date_part", "date_trunc", "floor", "greatest", "least", "length", "lower",
  "ltrim", "max", "min", "nullif", "now", "round", "rtrim", "sum", "to_char",
  "trim", "upper",
];

const ALLOWED = new Set(FREE_QUERY_FUNCTIONS);

export type FreeQueryRelation = { schema: string; name: string };

export type FreeQueryRejection =
  /** Kein einzelnes SELECT, oder eine Funktion, die `isReadOnlySql` ohnehin nie durchlaesst. */
  | "statement_not_read_only"
  /** Eine Relation ohne Schema, die auch kein Name aus `WITH` ist. */
  | "relation_without_schema"
  /** Eine Relation aus einem anderen Schema als dem der Anfrage. */
  | "relation_foreign_schema"
  /** Ein Name, der die Grammatik der Data API nicht erfuellt. */
  | "identifier_rejected"
  /** Eine Funktion mit Schema, ein Operator mit Schema oder ein Cast mit Schema. */
  | "qualified_reference"
  /** Eine Funktion, die nicht auf der Liste steht. */
  | "function_not_allowed";

export type FreeQueryReading =
  | { ok: true; relations: FreeQueryRelation[]; functions: string[] }
  | { ok: false; reason: FreeQueryRejection };

type Found = {
  relations: FreeQueryRelation[];
  functions: string[];
  rejection: FreeQueryRejection | null;
};

/**
 * Liest eine freie Abfrage und gibt die Relationen zurueck, die sie anfasst.
 *
 * Der Parser ist derselbe, den `isReadOnlySql` schon benutzt
 * (`pgsql-ast-parser`), also gibt es hier keinen zweiten Begriff davon, was ein
 * SELECT ist.
 */
export function readFreeQuery(statement: string, schema: string): FreeQueryReading {
  if (!isDataSchemaName(schema)) return { ok: false, reason: "identifier_rejected" };
  if (!isReadOnlySql(statement)) return { ok: false, reason: "statement_not_read_only" };
  let parsed: unknown;
  try {
    // Derselbe Parser wie in `isReadOnlySql`, und er laeuft hier ein zweites
    // Mal: Der Waechter dort gibt seinen Baum nicht heraus, und ein Baum, der
    // zwischen zwei Pruefungen durch eine Variable reist, waere die Stelle, an
    // der jemand spaeter die falsche Fassung liest.
    parsed = parse(statement.trim().replace(/;\s*$/, ""));
  } catch {
    return { ok: false, reason: "statement_not_read_only" };
  }
  const found: Found = { relations: [], functions: [], rejection: null };
  walk(parsed, new Set<string>(), schema, found);
  if (found.rejection) return { ok: false, reason: found.rejection };
  const seen = new Set<string>();
  const relations: FreeQueryRelation[] = [];
  for (const relation of found.relations) {
    const key = `${relation.schema}.${relation.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    relations.push(relation);
  }
  return { ok: true, relations, functions: [...new Set(found.functions)].sort() };
}

function walk(node: unknown, scope: ReadonlySet<string>, schema: string, found: Found): void {
  if (found.rejection) return;
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, scope, schema, found);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;

  // Ein Operator oder ein Cast mit Schema zeigt auf ein Nutzerschema, und
  // hinter beiden steht eine Funktion, die dieser Weg nicht lesen kann.
  if (typeof record.opSchema === "string") {
    found.rejection = "qualified_reference";
    return;
  }
  if (record.type === "cast") {
    const target = record.to as Record<string, unknown> | undefined;
    if (target && typeof target.schema === "string") {
      found.rejection = "qualified_reference";
      return;
    }
  }

  if (record.type === "with") {
    // Die Sichtbarkeit wie in PostgreSQL: Eine Bindung sieht die vorherigen und
    // sich selbst nicht.
    const visible = new Set(scope);
    for (const binding of Array.isArray(record.bind) ? record.bind : []) {
      const entry = binding as Record<string, unknown>;
      walk(entry.statement, visible, schema, found);
      if (found.rejection) return;
      const alias = (entry.alias as Record<string, unknown> | undefined)?.name;
      if (typeof alias === "string") visible.add(alias);
    }
    walk(record.in, visible, schema, found);
    return;
  }

  if (record.type === "table") {
    const named = record.name as Record<string, unknown> | undefined;
    const name = named?.name;
    const relationSchema = named?.schema;
    if (typeof name !== "string" || !isDataIdentifier(name)) {
      found.rejection = "identifier_rejected";
      return;
    }
    if (relationSchema === undefined) {
      // Ohne Schema ist nur ein Name aus `WITH` erlaubt. Jeder andere waere eine
      // Relation, deren Auflösung diese Lesung nicht nachvollziehen kann.
      if (!scope.has(name)) found.rejection = "relation_without_schema";
    } else if (typeof relationSchema !== "string" || !isDataIdentifier(relationSchema)) {
      found.rejection = "identifier_rejected";
    } else if (relationSchema !== schema) {
      found.rejection = "relation_foreign_schema";
    } else {
      found.relations.push({ schema: relationSchema, name });
    }
    // Eine Join-Bedingung haengt am rechten Zweig und kann eine Unterabfrage
    // tragen; ohne diesen Schritt bliebe sie ungelesen.
    walk(record.join, scope, schema, found);
    return;
  }

  if (record.type === "call") {
    const callee = record.function as Record<string, unknown> | undefined;
    const name = callee?.name;
    if (typeof name !== "string") {
      found.rejection = "identifier_rejected";
      return;
    }
    if (callee?.schema !== undefined) {
      found.rejection = "qualified_reference";
      return;
    }
    if (!ALLOWED.has(name.toLowerCase())) {
      found.rejection = "function_not_allowed";
      return;
    }
    found.functions.push(name.toLowerCase());
    walk(record.args, scope, schema, found);
    walk(record.orderBy, scope, schema, found);
    walk(record.filter, scope, schema, found);
    walk(record.over, scope, schema, found);
    return;
  }

  for (const value of Object.values(record)) walk(value, scope, schema, found);
}
