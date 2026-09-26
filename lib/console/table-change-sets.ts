import { isDataIdentifier } from "@/lib/server/data-plane/identifiers";

/**
 * Die Anweisungen des Tabellen-Designers (2.49), rein und ohne Datenbank.
 *
 * Die Console schreibt nichts. Sie erzeugt hier genau eine SQL-Anweisung,
 * zeigt sie dem Menschen vollstaendig und uebergibt sie danach der bestehenden
 * Change-Set-Route. Angewendet wird erst, wenn die Freigabezentrale das Change
 * Set freigegeben hat und der Migrationsprozess es anwendet.
 *
 * Warum das ein eigenes Modul ist: Der Weg von einem Namen aus einem
 * Eingabefeld bis in eine DDL-Anweisung ist die gefaehrlichste Stelle dieses
 * Slices. Er liegt darum an genau einer Stelle, ohne React, ohne fetch, ohne
 * Uebersetzung, und ist einzeln pruefbar.
 *
 * Die drei Regeln, auf denen alles steht:
 *
 * 1. Jeder Name muss die Grammatik der Data API erfuellen
 *    (`lib/server/data-plane/identifiers`): `[A-Za-z_][A-Za-z0-9_]{0,62}`.
 *    Kein Anfuehrungszeichen, kein Semikolon, kein Bindestrich, kein
 *    Kommentarzeichen, nichts ausserhalb von ASCII. Ein kyrillisches `а` oder
 *    ein Fullwidth-`ａ` faellt damit ebenso durch wie `x"; DROP TABLE y; --`.
 * 2. Typ und Vorgabewert kommen nicht aus der Eingabe, sondern aus zwei festen
 *    Tabellen. Der Aufrufer waehlt einen Schluessel; der SQL-Text steht hier.
 *    Ein Aufrufer kann also keinen eigenen Ausdruck einschleusen.
 * 3. Erst nach der Pruefung wird zitiert, und zitiert wird immer: `"name"`.
 *    Weil die Grammatik das Anfuehrungszeichen verbietet, kann kein Name die
 *    Anfuehrungszeichen verlassen. `quoted()` prueft das ein zweites Mal.
 *
 * Was dieser Slice bewusst **nicht** kann: kein `DROP`, kein `DROP COLUMN`,
 * kein `ALTER COLUMN TYPE`, kein `TRUNCATE`, keine Umbenennung von Spalten.
 * Es gibt in diesem Modul keinen Weg, eine solche Anweisung zu erzeugen; die
 * Ansicht sagt das auch.
 */

/** Fester Schemaname. Wie die uebrigen Katalogansichten arbeitet der Designer auf `public`. */
export const TABLE_SCHEMA = "public";

/** Hoechstens so viele Spalten in einer neuen Tabelle. Eine Grenze, keine Meinung. */
export const MAX_NEW_TABLE_COLUMNS = 32;

export type TableColumnTypeId =
  | "text" | "integer" | "bigint" | "numeric" | "boolean"
  | "uuid" | "date" | "timestamptz" | "jsonb";

export type TableColumnDefaultId = "none" | "now" | "uuid";

type ColumnTypeEntry = {
  /** Der SQL-Text. Er kommt aus dieser Tabelle, nie aus der Eingabe. */
  sql: string;
  /** Beschriftung in der Ansicht; deutsch, wird uebersetzt. */
  label: string;
  /** Welche Vorgabewerte zu diesem Typ passen. */
  defaults: readonly TableColumnDefaultId[];
};

export const TABLE_COLUMN_TYPES: Record<TableColumnTypeId, ColumnTypeEntry> = {
  text: { sql: "text", label: "Text", defaults: ["none"] },
  integer: { sql: "integer", label: "Ganzzahl", defaults: ["none"] },
  bigint: { sql: "bigint", label: "Große Ganzzahl", defaults: ["none"] },
  numeric: { sql: "numeric", label: "Dezimalzahl", defaults: ["none"] },
  boolean: { sql: "boolean", label: "Wahrheitswert", defaults: ["none"] },
  uuid: { sql: "uuid", label: "UUID", defaults: ["none", "uuid"] },
  date: { sql: "date", label: "Datum", defaults: ["none", "now"] },
  timestamptz: { sql: "timestamptz", label: "Zeitpunkt mit Zeitzone", defaults: ["none", "now"] },
  jsonb: { sql: "jsonb", label: "JSON (jsonb)", defaults: ["none"] },
};

type ColumnDefaultEntry = {
  /** `null` heisst: kein DEFAULT im erzeugten SQL. */
  sql: string | null;
  label: string;
};

export const TABLE_COLUMN_DEFAULTS: Record<TableColumnDefaultId, ColumnDefaultEntry> = {
  none: { sql: null, label: "keine Vorgabe" },
  now: { sql: "now()", label: "jetzt (now())" },
  uuid: { sql: "gen_random_uuid()", label: "zufällige UUID (gen_random_uuid())" },
};

/**
 * Die Gruende einer Ablehnung, deutsch und an einer Stelle.
 *
 * Die Ansicht zeigt `t(error.reason)`; der Uebersetzungsvertrag liest diese
 * Tabelle ueber `tableChangeSetTexts()` mit. In keinen dieser Texte laeuft
 * eine Variable. Ein abgelehnter Name kann darum nicht ueber die Meldung
 * zurueck in die Oberflaeche gelangen.
 */
export const TABLE_CHANGE_SET_REASONS = {
  INVALID_TABLE_NAME: "Der Tabellenname passt nicht: erlaubt sind Buchstabe oder Unterstrich am Anfang, danach Buchstaben, Ziffern und Unterstriche, höchstens 63 Zeichen.",
  INVALID_COLUMN_NAME: "Ein Spaltenname passt nicht: erlaubt sind Buchstabe oder Unterstrich am Anfang, danach Buchstaben, Ziffern und Unterstriche, höchstens 63 Zeichen.",
  RESERVED_NAME: "Dieser Name ist ein reserviertes Wort von PostgreSQL. QKERN lehnt ihn ab, damit später niemand jede Abfrage auf diese Tabelle in Anführungszeichen setzen muss.",
  UNKNOWN_TYPE: "Dieser Spaltentyp steht nicht auf der Liste. Der Designer kennt nur die angebotenen Typen.",
  UNKNOWN_DEFAULT: "Dieser Vorgabewert steht nicht auf der Liste. Der Designer kennt nur die angebotenen Vorgaben.",
  DEFAULT_TYPE_MISMATCH: "Dieser Vorgabewert passt nicht zu diesem Spaltentyp.",
  NO_COLUMNS: "Eine Tabelle braucht mindestens eine Spalte.",
  TOO_MANY_COLUMNS: "Das sind zu viele Spalten für einen Entwurf in der Console.",
  DUPLICATE_COLUMN: "Zwei Spalten haben denselben Namen.",
  SAME_NAME: "Der neue Name ist der alte Name.",
  NOT_NULL_NEEDS_DEFAULT: "Eine neue Spalte mit NOT NULL braucht einen Vorgabewert, sonst scheitert sie an den Zeilen, die es schon gibt.",
} as const;

export type TableChangeSetReasonCode = keyof typeof TABLE_CHANGE_SET_REASONS;

/** Eine abgelehnte Eingabe. Sie traegt den Code und den deutschen Grund, nie den Wert. */
export class TableChangeSetError extends Error {
  readonly code: TableChangeSetReasonCode;
  readonly reason: string;

  constructor(code: TableChangeSetReasonCode) {
    super(`TABLE_CHANGE_SET_REJECTED:${code}`);
    this.name = "TableChangeSetError";
    this.code = code;
    this.reason = TABLE_CHANGE_SET_REASONS[code];
  }
}

/**
 * Reservierte Woerter von PostgreSQL 17 (Anhang C, Spalte „reserved" und
 * „reserved (can be function or type name)").
 *
 * Zitiert wuerden sie funktionieren. Abgelehnt werden sie trotzdem: Eine
 * Tabelle `"order"` zwingt jede spaetere Abfrage, jedes Werkzeug und jeden
 * Menschen zu Anfuehrungszeichen. Das ist eine Falle, die man einmal stellt
 * und jahrelang bezahlt.
 */
const RESERVED_WORDS = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric",
  "authorization", "binary", "both", "case", "cast", "check", "collate", "collation",
  "column", "concurrently", "constraint", "create", "cross", "current_catalog",
  "current_date", "current_role", "current_schema", "current_time", "current_timestamp",
  "current_user", "default", "deferrable", "desc", "distinct", "do", "else", "end",
  "except", "false", "fetch", "for", "foreign", "freeze", "from", "full", "grant",
  "group", "having", "ilike", "in", "initially", "inner", "intersect", "into", "is",
  "isnull", "join", "lateral", "leading", "left", "like", "limit", "localtime",
  "localtimestamp", "natural", "not", "notnull", "null", "offset", "on", "only", "or",
  "order", "outer", "overlaps", "placing", "primary", "references", "returning", "right",
  "select", "session_user", "similar", "some", "symmetric", "system_user", "table",
  "tablesample", "then", "to", "trailing", "true", "union", "unique", "user", "using",
  "variadic", "verbose", "when", "where", "window", "with",
]);

/** Ein Name, der geprueft und danach zitiert ist. Zwei Pruefungen, weil eine zu wenig waere. */
function quoted(name: string): string {
  if (!isDataIdentifier(name) || name.includes("\"")) {
    throw new TableChangeSetError("INVALID_TABLE_NAME");
  }
  return `"${name}"`;
}

function assertName(value: unknown, invalid: TableChangeSetReasonCode): string {
  if (!isDataIdentifier(value)) throw new TableChangeSetError(invalid);
  if (RESERVED_WORDS.has(value.toLowerCase())) throw new TableChangeSetError("RESERVED_NAME");
  return value;
}

export type NewColumn = {
  name: string;
  type: TableColumnTypeId;
  notNull: boolean;
  default: TableColumnDefaultId;
};

/** `"name" typ [NOT NULL] [DEFAULT ausdruck]`, immer in dieser Reihenfolge. */
function columnDefinition(column: NewColumn): string {
  const name = assertName(column.name, "INVALID_COLUMN_NAME");
  const type = TABLE_COLUMN_TYPES[column.type];
  if (!type || !Object.prototype.hasOwnProperty.call(TABLE_COLUMN_TYPES, column.type)) {
    throw new TableChangeSetError("UNKNOWN_TYPE");
  }
  const fallback = TABLE_COLUMN_DEFAULTS[column.default];
  if (!fallback || !Object.prototype.hasOwnProperty.call(TABLE_COLUMN_DEFAULTS, column.default)) {
    throw new TableChangeSetError("UNKNOWN_DEFAULT");
  }
  if (!type.defaults.includes(column.default)) throw new TableChangeSetError("DEFAULT_TYPE_MISMATCH");
  const parts = [`${quoted(name)} ${type.sql}`];
  if (column.notNull === true) parts.push("NOT NULL");
  if (fallback.sql) parts.push(`DEFAULT ${fallback.sql}`);
  return parts.join(" ");
}

function qualified(table: string): string {
  return `${quoted(TABLE_SCHEMA)}.${quoted(table)}`;
}

/**
 * `CREATE TABLE "public"."t" ("a" text NOT NULL, "b" uuid DEFAULT gen_random_uuid())`
 *
 * Eine Anweisung, eine Zeile, keine Optionen: kein `IF NOT EXISTS`, kein
 * `UNLOGGED`, keine Tablespace-Angabe, kein Primaerschluessel. Ein
 * Primaerschluessel waere ein eigener Entwurf; er fehlt hier lieber, als dass
 * er geraten wird.
 */
export function createTableStatement(input: { table: string; columns: readonly NewColumn[] }): string {
  const table = assertName(input.table, "INVALID_TABLE_NAME");
  const columns = input.columns ?? [];
  if (columns.length === 0) throw new TableChangeSetError("NO_COLUMNS");
  if (columns.length > MAX_NEW_TABLE_COLUMNS) throw new TableChangeSetError("TOO_MANY_COLUMNS");
  const definitions = columns.map(columnDefinition);
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.name)) throw new TableChangeSetError("DUPLICATE_COLUMN");
    seen.add(column.name);
  }
  return `CREATE TABLE ${qualified(table)} (${definitions.join(", ")})`;
}

/** `ALTER TABLE "public"."alt" RENAME TO "neu"` */
export function renameTableStatement(input: { table: string; newName: string }): string {
  const table = assertName(input.table, "INVALID_TABLE_NAME");
  const newName = assertName(input.newName, "INVALID_TABLE_NAME");
  if (table === newName) throw new TableChangeSetError("SAME_NAME");
  return `ALTER TABLE ${qualified(table)} RENAME TO ${quoted(newName)}`;
}

/**
 * `ALTER TABLE "public"."t" ADD COLUMN "c" text NOT NULL DEFAULT ...`
 *
 * `NOT NULL` ohne Vorgabewert wird abgelehnt: In einer Tabelle mit Zeilen
 * scheitert die Anweisung dann in der Zieldatenbank, und zwar erst nach der
 * Freigabe. Diesen Umweg spart sich der Designer.
 */
export function addColumnStatement(input: { table: string; column: NewColumn }): string {
  const table = assertName(input.table, "INVALID_TABLE_NAME");
  const definition = columnDefinition(input.column);
  if (input.column.notNull === true && TABLE_COLUMN_DEFAULTS[input.column.default].sql === null) {
    throw new TableChangeSetError("NOT_NULL_NEEDS_DEFAULT");
  }
  return `ALTER TABLE ${qualified(table)} ADD COLUMN ${definition}`;
}

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function tableChangeSetTexts(): string[] {
  return [
    ...Object.values(TABLE_COLUMN_TYPES).map((entry) => entry.label),
    ...Object.values(TABLE_COLUMN_DEFAULTS).map((entry) => entry.label),
    ...Object.values(TABLE_CHANGE_SET_REASONS),
  ];
}
