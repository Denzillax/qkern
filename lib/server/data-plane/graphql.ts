import { DATA_API_GRAPHQL_LIMITS } from "@/lib/data-api-graphql-limits";
import { DATA_API_LIMITS, type DataApiFilterOperator } from "@/lib/data-api-limits";
import { DATA_IDENTIFIER } from "@/lib/server/data-plane/identifiers";
import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  GeneratedDataApiPort,
  GeneratedDataContext,
  GeneratedDataFilter,
  GeneratedTable,
} from "@/lib/server/data-plane/generated-api";
import type { ProjectDataPlaneScope } from "@/lib/server/data-plane/service";

/**
 * Die lesende GraphQL-Fläche über dem Projektschema (2.83).
 *
 * **Was sie ist.** Ein sehr kleiner Ausschnitt von GraphQL, der auf genau eine
 * Sache abbildet: `listRows` der generierten Data API, einmal je Feld der
 * obersten Ebene. Es entsteht kein zweiter Weg in die Datenbank, keine zweite
 * Stelle, an der Ansprüche gesetzt werden, und keine zweite Rechteprüfung. Der
 * Aufrufer sieht hier genau die Zeilen, die er über die REST-Fläche auch sähe,
 * weil es dieselbe Fläche ist.
 *
 * **Warum ohne Bibliothek.** Eine GraphQL-Bibliothek bringt die ganze Sprache
 * mit: Fragmente, Variablen, Direktiven, Introspektion, Eingabetypen,
 * Schnittstellen, Unions. Jede dieser Ecken wäre dann eine Zusage, für die
 * jemand einstehen muss, und mehrere davon (Fragment-Rekursion, Introspektion,
 * Aliasse) sind genau die Stellen, an denen eine Grenze umgangen wird. Der
 * Ausschnitt hier ist so klein, dass der Parser in eine Datei passt und jede
 * Ablehnung einen Namen hat.
 *
 * **Nur Abfragen.** Es gibt keine Mutationen. Geschrieben wird über die Data
 * API; ein zweiter Schreibweg wäre eine zweite Rechteprüfung, und die zweite
 * ist immer die, die jemand vergisst.
 *
 * Was der Ausschnitt kennt und was ihm bewusst fehlt, steht bei
 * `PROJECT_GRAPHQL_GRAMMAR` unten in einem Stück.
 */

/* ------------------------------------------------------------------ *
 * Ablehnungen
 * ------------------------------------------------------------------ */

/**
 * Der Grund einer Ablehnung, als Kennung.
 *
 * Jede Ablehnung hat einen Namen, weil „syntax error“ dem Aufrufer nichts sagt
 * und der Console nichts zu übersetzen gibt. Die Kennung nennt nie Inhalt der
 * Datenbank; `at` trägt höchstens einen Namen, den der Aufrufer selbst
 * hingeschrieben hat.
 */
export type ProjectGraphqlRejection =
  | "query_too_large"
  | "query_empty"
  | "syntax_error"
  | "unexpected_end"
  | "multiple_operations"
  | "mutation_not_supported"
  | "subscription_not_supported"
  | "fragment_not_supported"
  | "variable_not_supported"
  | "directive_not_supported"
  | "introspection_not_supported"
  | "block_string_not_supported"
  | "enum_not_supported"
  | "object_argument_not_supported"
  | "nested_list_not_supported"
  | "depth_exceeded"
  | "fields_exceeded"
  | "tables_exceeded"
  | "rows_exceeded"
  | "empty_selection"
  | "selection_required"
  | "duplicate_response_key"
  | "duplicate_argument"
  | "unknown_argument"
  | "invalid_argument"
  | "arguments_exceeded"
  | "column_arguments_not_supported"
  | "list_too_long"
  | "filter_invalid"
  | "filters_exceeded"
  | "unknown_table"
  | "unknown_field";

/**
 * Eine abgewiesene Abfrage.
 *
 * Die Nachricht bleibt inhaltsfrei und gleich; der Grund steht in `reason`, und
 * die Route gibt ihn weiter, weil er eine Aussage über die Abfrage ist und
 * nicht über die Daten.
 */
export class ProjectGraphqlError extends Error {
  constructor(readonly reason: ProjectGraphqlRejection, readonly at?: string) {
    super("The GraphQL query was refused.");
    this.name = "ProjectGraphqlError";
  }
}
recognisedByName(ProjectGraphqlError, "ProjectGraphqlError");

function refuse(reason: ProjectGraphqlRejection, at?: string): never {
  throw new ProjectGraphqlError(reason, at);
}

/* ------------------------------------------------------------------ *
 * Der Ausschnitt, in Worten
 * ------------------------------------------------------------------ */

/**
 * Was der Parser kennt und was ihm fehlt, an einer Stelle und im Klartext.
 *
 * Die Console zeigt diese Listen, damit auf der Seite dasselbe steht, was der
 * Parser tut. Eine zweite, von Hand gepflegte Liste in der Ansicht würde
 * irgendwann etwas anderes behaupten.
 */
export const PROJECT_GRAPHQL_GRAMMAR = {
  /** Was der Parser annimmt. */
  accepted: [
    "query_shorthand",
    "named_query",
    "top_level_table_fields",
    "column_fields",
    "aliases",
    "scalar_arguments",
    "string_lists",
    "comments",
  ] as const,
  /** Was er abweist, jedes mit eigenem Grund. */
  refused: [
    "mutation",
    "subscription",
    "fragments",
    "variables",
    "directives",
    "introspection",
    "enum_values",
    "input_objects",
    "block_strings",
    "multiple_operations",
    "relations",
    "views",
    "aggregates",
  ] as const,
} as const;

export type ProjectGraphqlAccepted = (typeof PROJECT_GRAPHQL_GRAMMAR.accepted)[number];
export type ProjectGraphqlRefused = (typeof PROJECT_GRAPHQL_GRAMMAR.refused)[number];

/* ------------------------------------------------------------------ *
 * Zerlegung in Zeichen
 * ------------------------------------------------------------------ */

type Punctuator = "{" | "}" | "(" | ")" | ":" | "[" | "]" | "!" | "$" | "@" | "..." | "=" | "&" | "|";

type Token =
  | { kind: "name"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "punct"; value: Punctuator }
  | { kind: "eof" };

const NAME_START = /[A-Za-z_]/;
const NAME_PART = /[A-Za-z0-9_]/;

/**
 * Die Zeichenkette in Token, in einem Durchgang.
 *
 * `$`, `@` und `...` bekommen eigene Token, obwohl der Parser sie nie annimmt.
 * Das ist Absicht: Nur so kann die Ablehnung „Variablen gibt es hier nicht“
 * heissen und nicht „Syntaxfehler“. Ein Aufrufer, der einen Fehler nicht
 * versteht, probiert; ein Aufrufer, der ihn versteht, schreibt die Abfrage um.
 */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    // Zu ignorieren: Leerraum, Komma und BOM, in GraphQL alle bedeutungslos.
    if (character === " " || character === "\t" || character === "\n" || character === "\r" ||
        character === "," || character === "﻿") {
      index += 1;
      continue;
    }
    if (character === "#") {
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
      continue;
    }
    if (character === '"') {
      if (source.startsWith('"""', index)) refuse("block_string_not_supported");
      const { value, next } = readString(source, index);
      tokens.push({ kind: "string", value });
      index = next;
      continue;
    }
    if (source.startsWith("...", index)) {
      tokens.push({ kind: "punct", value: "..." });
      index += 3;
      continue;
    }
    if ("{}():[]!$@=&|".includes(character)) {
      tokens.push({ kind: "punct", value: character as Punctuator });
      index += 1;
      continue;
    }
    if (character === "-" || (character >= "0" && character <= "9")) {
      const { value, next } = readNumber(source, index);
      tokens.push({ kind: "number", value });
      index = next;
      continue;
    }
    if (NAME_START.test(character)) {
      let end = index + 1;
      while (end < source.length && NAME_PART.test(source[end]!)) end += 1;
      tokens.push({ kind: "name", value: source.slice(index, end) });
      index = end;
      continue;
    }
    refuse("syntax_error");
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

/** Eine Zeichenkette wie GraphQL sie schreibt, mit den sechs Fluchten und \\uXXXX. */
function readString(source: string, start: number): { value: string; next: number } {
  let index = start + 1;
  let value = "";
  while (index < source.length) {
    const character = source[index]!;
    if (character === '"') return { value, next: index + 1 };
    if (character === "\n" || character === "\r") refuse("syntax_error");
    if (character !== "\\") {
      value += character;
      index += 1;
      continue;
    }
    const escaped = source[index + 1];
    if (escaped === undefined) refuse("unexpected_end");
    if (escaped === "u") {
      const digits = source.slice(index + 2, index + 6);
      if (!/^[0-9A-Fa-f]{4}$/.test(digits)) refuse("syntax_error");
      value += String.fromCharCode(Number.parseInt(digits, 16));
      index += 6;
      continue;
    }
    const simple: Record<string, string> = {
      '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
    };
    const replacement = simple[escaped];
    if (replacement === undefined) refuse("syntax_error");
    value += replacement;
    index += 2;
  }
  refuse("unexpected_end");
}

/** Eine Zahl wie GraphQL sie schreibt. Ganz oder mit Bruch und Exponent. */
function readNumber(source: string, start: number): { value: number; next: number } {
  const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(start));
  if (!match) refuse("syntax_error");
  const value = Number(match[0]);
  if (!Number.isFinite(value)) refuse("syntax_error");
  return { value, next: start + match[0].length };
}

/* ------------------------------------------------------------------ *
 * Zerlegung in Felder
 * ------------------------------------------------------------------ */

type ArgumentValue = string | number | boolean | null | Array<string | number | boolean | null>;

type ParsedField = {
  /** Der Name in der Antwort: der Alias, sonst der Feldname. */
  responseKey: string;
  name: string;
  argumentsByName: Map<string, ArgumentValue>;
  selection: ParsedField[] | null;
};

/**
 * Der Parser für den Ausschnitt.
 *
 * Er zählt beim Zerlegen mit, weil die Grenzen dann vor der Datenbank greifen
 * und nicht erst, wenn schon ein Plan steht: Eine Abfrage mit zehntausend
 * Feldern soll nicht erst vollständig gelesen und dann abgewiesen werden.
 */
class Parser {
  private position = 0;
  /** Jedes Feld einzeln, Aliasse eingeschlossen. Genau das ist die Grenze. */
  private fieldCount = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.position]!;
  }

  private next(): Token {
    const token = this.tokens[this.position]!;
    if (token.kind !== "eof") this.position += 1;
    return token;
  }

  private atPunct(value: Punctuator): boolean {
    const token = this.peek();
    return token.kind === "punct" && token.value === value;
  }

  private expectPunct(value: Punctuator): void {
    if (!this.atPunct(value)) {
      if (this.peek().kind === "eof") refuse("unexpected_end");
      refuse("syntax_error");
    }
    this.position += 1;
  }

  private expectName(): string {
    const token = this.next();
    if (token.kind === "eof") refuse("unexpected_end");
    if (token.kind !== "name") refuse("syntax_error");
    return token.value;
  }

  /**
   * Das ganze Dokument: genau eine Abfrage, benannt oder in Kurzform.
   *
   * `fieldCount` kommt von hier und wird nirgends noch einmal gerechnet. Zwei
   * Zaehlungen koennten verschieden ausfallen, und dann waere eine davon die
   * Grenze und die andere die Zahl in der Antwort.
   */
  parseDocument(): { operationName: string | null; fields: ParsedField[]; fieldCount: number } {
    let operationName: string | null = null;
    const first = this.peek();
    if (first.kind === "eof") refuse("query_empty");
    if (first.kind === "name") {
      if (first.value === "mutation") refuse("mutation_not_supported");
      if (first.value === "subscription") refuse("subscription_not_supported");
      if (first.value === "fragment") refuse("fragment_not_supported");
      if (first.value !== "query") refuse("syntax_error");
      this.position += 1;
      if (this.peek().kind === "name") operationName = this.expectName();
      // Eine Variablendefinition steht genau hier. Sie bekommt ihren eigenen
      // Grund, weil ein Aufrufer sonst nicht erfährt, dass er die Werte
      // hinschreiben muss, statt sie zu binden.
      if (this.atPunct("(")) refuse("variable_not_supported");
      if (this.atPunct("@")) refuse("directive_not_supported");
    }
    const fields = this.parseSelectionSet(1);
    const trailing = this.peek();
    if (trailing.kind !== "eof") {
      // Ein zweites `{` oder ein zweites `query` wäre eine zweite Operation.
      // Ohne Operationsnamen in der Anfrage wäre nicht entscheidbar, welche
      // gemeint ist, und „die erste“ wäre geraten.
      if (trailing.kind === "name" &&
          ["query", "mutation", "subscription", "fragment"].includes(trailing.value)) {
        refuse("multiple_operations");
      }
      if (trailing.kind === "punct" && trailing.value === "{") refuse("multiple_operations");
      refuse("syntax_error");
    }
    return { operationName, fields, fieldCount: this.fieldCount };
  }

  private parseSelectionSet(depth: number): ParsedField[] {
    this.expectPunct("{");
    const fields: ParsedField[] = [];
    const keys = new Set<string>();
    while (!this.atPunct("}")) {
      if (this.peek().kind === "eof") refuse("unexpected_end");
      // `...` ist ein Fragment, benannt oder inline. Beides gibt es hier nicht,
      // und damit gibt es auch keine Fragment-Rekursion zu begrenzen.
      if (this.atPunct("...")) refuse("fragment_not_supported");
      const field = this.parseField(depth);
      // Zwei Felder mit demselben Schlüssel in der Antwort: GraphQL verlangt
      // Eindeutigkeit, und ohne sie würde eines das andere still überschreiben.
      if (keys.has(field.responseKey)) refuse("duplicate_response_key", field.responseKey);
      keys.add(field.responseKey);
      fields.push(field);
    }
    this.expectPunct("}");
    if (fields.length === 0) refuse("empty_selection");
    return fields;
  }

  private parseField(depth: number): ParsedField {
    let name = this.expectName();
    let responseKey = name;
    if (this.atPunct(":")) {
      this.position += 1;
      responseKey = name;
      name = this.expectName();
    }
    // `__schema`, `__type` und `__typename`: die Introspektion. Sie verrät die
    // Form des Schemas ohne eine einzige Zeile zu lesen, und sie ist an dieser
    // Fläche nicht nötig. Das Schema steht als SDL an der eigenen Route und
    // nennt dort nur, was die Projektrolle ohnehin lesen darf.
    if (name.startsWith("__") || responseKey.startsWith("__")) refuse("introspection_not_supported", name);
    this.fieldCount += 1;
    if (this.fieldCount > DATA_API_GRAPHQL_LIMITS.maxFields) refuse("fields_exceeded");
    const argumentsByName = this.atPunct("(") ? this.parseArguments() : new Map<string, ArgumentValue>();
    if (this.atPunct("@")) refuse("directive_not_supported", name);
    let selection: ParsedField[] | null = null;
    if (this.atPunct("{")) {
      if (depth + 1 > DATA_API_GRAPHQL_LIMITS.maxDepth) refuse("depth_exceeded", name);
      selection = this.parseSelectionSet(depth + 1);
    }
    return { responseKey, name, argumentsByName, selection };
  }

  private parseArguments(): Map<string, ArgumentValue> {
    this.expectPunct("(");
    const values = new Map<string, ArgumentValue>();
    while (!this.atPunct(")")) {
      if (this.peek().kind === "eof") refuse("unexpected_end");
      const name = this.expectName();
      this.expectPunct(":");
      const value = this.parseValue(false);
      if (values.has(name)) refuse("duplicate_argument", name);
      values.set(name, value);
      if (values.size > DATA_API_GRAPHQL_LIMITS.maxArgumentsPerField) refuse("arguments_exceeded");
    }
    this.expectPunct(")");
    if (values.size === 0) refuse("syntax_error");
    return values;
  }

  private parseValue(inList: boolean): ArgumentValue {
    const token = this.peek();
    if (token.kind === "eof") refuse("unexpected_end");
    if (token.kind === "punct" && token.value === "$") refuse("variable_not_supported");
    if (token.kind === "punct" && token.value === "{") refuse("object_argument_not_supported");
    if (token.kind === "punct" && token.value === "[") {
      if (inList) refuse("nested_list_not_supported");
      this.position += 1;
      const entries: Array<string | number | boolean | null> = [];
      while (!this.atPunct("]")) {
        if (this.peek().kind === "eof") refuse("unexpected_end");
        entries.push(this.parseValue(true) as string | number | boolean | null);
        if (entries.length > DATA_API_GRAPHQL_LIMITS.maxListEntries) refuse("list_too_long");
      }
      this.expectPunct("]");
      return entries;
    }
    this.position += 1;
    if (token.kind === "number") return token.value;
    if (token.kind === "string") return token.value;
    if (token.kind === "name") {
      if (token.value === "true") return true;
      if (token.value === "false") return false;
      if (token.value === "null") return null;
      // Ein Enum-Wert. Es gibt an dieser Fläche keinen Enum-Typ, also wäre
      // jeder Enum-Wert ein Name, den niemand definiert hat.
      refuse("enum_not_supported", token.value);
    }
    refuse("syntax_error");
  }
}

/* ------------------------------------------------------------------ *
 * Der Plan
 * ------------------------------------------------------------------ */

/** Ein Feld der obersten Ebene, fertig für genau eine Lesung. */
export type ProjectGraphqlFieldPlan = {
  /** Der Schlüssel in der Antwort. */
  responseKey: string;
  table: string;
  /** Die Spalten, die gelesen werden: jede genau einmal, auch bei mehreren Aliassen. */
  columns: string[];
  /** Antwortschlüssel auf Spalte. Mehrere Schlüssel dürfen auf dieselbe Spalte zeigen. */
  selection: Array<{ responseKey: string; column: string }>;
  limit: number;
  order?: { column: string; direction: "asc" | "desc" };
  filters: GeneratedDataFilter[];
  cursor?: string;
};

export type ProjectGraphqlPlan = {
  operationName: string | null;
  fields: ProjectGraphqlFieldPlan[];
  /** Alle Felder zusammen, Aliasse einzeln gezählt. */
  fieldCount: number;
  /** Die Summe der Zeilengrenzen über alle Felder der obersten Ebene. */
  rowBudget: number;
};

/**
 * Aus dem Text ein Plan, ohne die Datenbank zu berühren.
 *
 * Die Reihenfolge ist Absicht: Form, dann Grenzen, dann erst der Katalog. Eine
 * Abfrage, die zu tief ist oder zu viele Felder holt, kostet so keine
 * Verbindung und keine Katalogabfrage.
 */
export function planProjectGraphqlQuery(query: string): ProjectGraphqlPlan {
  if (typeof query !== "string") refuse("invalid_argument", "query");
  if (Buffer.byteLength(query, "utf8") > DATA_API_GRAPHQL_LIMITS.maxQueryBytes) refuse("query_too_large");
  if (query.trim().length === 0) refuse("query_empty");
  const document = new Parser(tokenize(query)).parseDocument();
  if (document.fields.length > DATA_API_GRAPHQL_LIMITS.maxTables) refuse("tables_exceeded");

  // Die Feldzahl kommt aus dem Parser, der sie beim Lesen fuehrt und dort
  // schon abgewiesen hat. Aliasse sind darin einzeln enthalten.
  const fieldCount = document.fieldCount;
  let rowBudget = 0;
  const fields: ProjectGraphqlFieldPlan[] = [];
  for (const field of document.fields) {
    if (!DATA_IDENTIFIER.test(field.name)) refuse("unknown_table", field.name);
    if (!field.selection) refuse("selection_required", field.name);
    const selection: Array<{ responseKey: string; column: string }> = [];
    for (const column of field.selection) {
      if (column.selection) refuse("depth_exceeded", column.name);
      // Ein Argument auf einer Spalte wäre eine Zusage, die es nicht gibt: Es
      // gibt keine Feldauflöser hier, nur `SELECT spalte`.
      if (column.argumentsByName.size > 0) refuse("column_arguments_not_supported", column.name);
      if (!DATA_IDENTIFIER.test(column.name)) refuse("unknown_field", column.name);
      selection.push({ responseKey: column.responseKey, column: column.name });
    }
    const plan = fieldArguments(field);
    rowBudget += plan.limit;
    fields.push({
      responseKey: field.responseKey,
      table: field.name,
      // Gelesen wird jede Spalte einmal. Zehn Aliasse auf `id` sind zehn
      // Schlüssel in der Antwort und eine Spalte in der Abfrage.
      columns: [...new Set(selection.map((entry) => entry.column))],
      selection,
      ...plan,
    });
  }
  if (rowBudget > DATA_API_GRAPHQL_LIMITS.maxRowsPerQuery) refuse("rows_exceeded");
  return { operationName: document.operationName, fields, fieldCount, rowBudget };
}

/** Die fünf Argumente eines Feldes der obersten Ebene, geprüft. */
function fieldArguments(field: ParsedField): {
  limit: number;
  order?: { column: string; direction: "asc" | "desc" };
  filters: GeneratedDataFilter[];
  cursor?: string;
} {
  for (const name of field.argumentsByName.keys()) {
    if (!(DATA_API_GRAPHQL_LIMITS.arguments as readonly string[]).includes(name)) {
      refuse("unknown_argument", name);
    }
  }
  const raw = field.argumentsByName;
  let limit: number = DATA_API_GRAPHQL_LIMITS.defaultRowsPerField;
  if (raw.has("limit")) {
    const value = raw.get("limit");
    if (typeof value !== "number" || !Number.isSafeInteger(value) ||
        value < DATA_API_LIMITS.rowsMin || value > DATA_API_GRAPHQL_LIMITS.maxRowsPerField) {
      refuse("invalid_argument", "limit");
    }
    limit = value;
  }
  let order: { column: string; direction: "asc" | "desc" } | undefined;
  const orderBy = raw.get("orderBy");
  const direction = raw.get("direction");
  if (direction !== undefined && direction !== "asc" && direction !== "desc") {
    refuse("invalid_argument", "direction");
  }
  if (orderBy !== undefined) {
    if (typeof orderBy !== "string" || !DATA_IDENTIFIER.test(orderBy)) refuse("invalid_argument", "orderBy");
    order = { column: orderBy, direction: direction === "desc" ? "desc" : "asc" };
  } else if (direction !== undefined) {
    // `direction` ohne `orderBy` sortierte nach dem Primärschlüssel und sähe
    // aus wie eine Zusage über die Reihenfolge der Spalte, die der Aufrufer
    // gemeint hat. Er soll die Spalte nennen.
    refuse("invalid_argument", "direction");
  }
  let cursor: string | undefined;
  if (raw.has("after")) {
    const value = raw.get("after");
    if (typeof value !== "string" || value.length < 1 || value.length > 4_000) {
      refuse("invalid_argument", "after");
    }
    cursor = value;
  }
  const filters: GeneratedDataFilter[] = [];
  if (raw.has("where")) {
    const value = raw.get("where");
    const entries = Array.isArray(value) ? value : [value];
    if (entries.length > DATA_API_GRAPHQL_LIMITS.maxFiltersPerField) refuse("filters_exceeded");
    for (const entry of entries) {
      if (typeof entry !== "string") refuse("invalid_argument", "where");
      filters.push(parseFilter(entry));
    }
  }
  return { limit, ...(order ? { order } : {}), filters, ...(cursor ? { cursor } : {}) };
}

/**
 * Ein Filter als Zeichenkette, `spalte:operator:wert`.
 *
 * Dieselbe Form wie der Parameter `filter` der REST-Fläche, und mit Absicht
 * dieselbe: Ein `where`-Objekt bräuchte Eingabetypen, und Eingabetypen sind
 * genau die Ecke der Sprache, die dieser Ausschnitt nicht verantworten will.
 * Der Wert wird als JSON gelesen, wenn er sich so lesen lässt, sonst als Text,
 * wie an der REST-Fläche. In SQL landet er ausschliesslich als Parameter.
 */
function parseFilter(entry: string): GeneratedDataFilter {
  const first = entry.indexOf(":");
  const second = entry.indexOf(":", first + 1);
  if (first < 1 || second < first + 2) refuse("filter_invalid", entry.slice(0, 63));
  const column = entry.slice(0, first);
  const operator = entry.slice(first + 1, second);
  const rawValue = entry.slice(second + 1);
  if (!DATA_IDENTIFIER.test(column)) refuse("filter_invalid", column.slice(0, 63));
  if (!(DATA_API_LIMITS.operators as readonly string[]).includes(operator)) {
    refuse("filter_invalid", operator.slice(0, 63));
  }
  if (rawValue.length === 0) refuse("filter_invalid", column);
  let value: unknown;
  try { value = JSON.parse(rawValue); } catch { value = rawValue; }
  return { column, operator: operator as DataApiFilterOperator, value };
}

/* ------------------------------------------------------------------ *
 * Das Schema
 * ------------------------------------------------------------------ */

export type ProjectGraphqlFieldType = {
  name: string;
  /** Der GraphQL-Skalar, den diese Spalte bekommt. */
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  /** Der Typ in PostgreSQL, damit die Annäherung nachvollziehbar bleibt. */
  dataType: string;
};

export type ProjectGraphqlType = {
  /** Der Name der Tabelle, und damit der Name des Typs und des Feldes. */
  name: string;
  fields: ProjectGraphqlFieldType[];
};

export type ProjectGraphqlSchema = {
  schema: string;
  types: ProjectGraphqlType[];
  /** Das Schema in Textform, genau aus `types` gebaut. */
  sdl: string;
  limits: typeof DATA_API_GRAPHQL_LIMITS;
  grammar: typeof PROJECT_GRAPHQL_GRAMMAR;
};

/**
 * Der Skalar zu einem PostgreSQL-Typ.
 *
 * Eine Annäherung, und die Seite sagt das auch. `bigint` und `numeric` werden
 * `String`, weil die Data API sie als Dezimalstring zurückgibt: Eine Zahl in
 * JSON verliert bei 2^53 die Genauigkeit, und ein `Int` im Schema wäre dann
 * eine Zusage, die die Antwort nicht hält.
 */
function graphqlScalar(dataType: string, primaryKey: boolean): string {
  if (primaryKey) return "ID";
  if (/^(?:smallint|integer)/.test(dataType)) return "Int";
  if (/^(?:real|double precision)/.test(dataType)) return "Float";
  if (dataType === "boolean") return "Boolean";
  return "String";
}

/** Nur Namen, die GraphQL als Typnamen annimmt: `__` bleibt der Introspektion. */
function exposableName(name: string): boolean {
  return DATA_IDENTIFIER.test(name) && !name.startsWith("__");
}

/** Aus den Tabellen des Katalogs die Typen dieser Fläche. */
export function projectGraphqlTypes(tables: GeneratedTable[]): ProjectGraphqlType[] {
  const types: ProjectGraphqlType[] = [];
  for (const table of tables) {
    if (!exposableName(table.name)) continue;
    const primaryKey = new Set(table.primaryKey);
    const fields = table.columns
      .filter((column) => column.selectable && !column.sensitive && exposableName(column.name))
      .map((column) => ({
        name: column.name,
        type: graphqlScalar(column.dataType, primaryKey.has(column.name)),
        nullable: column.nullable && !primaryKey.has(column.name),
        primaryKey: primaryKey.has(column.name),
        dataType: column.dataType,
      }));
    if (fields.length === 0) continue;
    types.push({ name: table.name, fields });
  }
  return types.sort((left, right) => left.name.localeCompare(right.name));
}

/** Das Schema als Text, aus denselben Typen, die die Ausführung benutzt. */
export function projectGraphqlSdl(types: ProjectGraphqlType[]): string {
  const argumentList = "limit: Int, orderBy: String, direction: String, where: [String!], after: String";
  const lines: string[] = [];
  lines.push("# QKERN, lesende GraphQL-Flaeche ueber dem Projektschema.");
  lines.push("# Nur Abfragen. Geschrieben wird ueber die Data API.");
  lines.push("# Jedes Feld ist eine Lesung unter der Zeilensicherheit des Aufrufers.");
  lines.push("");
  lines.push("type Query {");
  for (const type of types) lines.push(`  ${type.name}(${argumentList}): [${type.name}!]!`);
  if (types.length === 0) lines.push("  # Keine Tabelle dieses Schemas erfuellt die Bedingungen.");
  lines.push("}");
  for (const type of types) {
    lines.push("");
    lines.push(`type ${type.name} {`);
    for (const field of type.fields) {
      lines.push(`  ${field.name}: ${field.type}${field.nullable ? "" : "!"}`);
    }
    lines.push("}");
  }
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 * Die Ausführung
 * ------------------------------------------------------------------ */

export type ProjectGraphqlFieldResult = {
  responseKey: string;
  table: string;
  rowCount: number;
  hasMore: boolean;
  /** Der Cursor für `after`, oder null. Ein View bekommt keinen; Views gibt es hier nicht. */
  nextCursor: string | null;
};

export type ProjectGraphqlResult = {
  data: Record<string, Array<Record<string, unknown>>>;
  fields: ProjectGraphqlFieldResult[];
  fieldCount: number;
  rowBudget: number;
  operationName: string | null;
};

/**
 * Die Fläche selbst.
 *
 * Sie hält keine Verbindung und kein Wissen über die Datenbank. Alles, was sie
 * über das Schema weiss, kommt aus `listReadableTables`, und alles, was sie
 * liest, geht durch `listRows`. So gibt es keinen zweiten Weg, an dem eine
 * Prüfung fehlen könnte.
 */
export class ProjectGraphqlService {
  constructor(private readonly data: GeneratedDataApiPort) {}

  /** Das Schema, wie der Katalog es hergibt. */
  async describe(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
  ): Promise<ProjectGraphqlSchema> {
    const tables = await this.data.listReadableTables(context, scope, schema);
    const types = projectGraphqlTypes(tables);
    return {
      schema,
      types,
      sdl: projectGraphqlSdl(types),
      limits: DATA_API_GRAPHQL_LIMITS,
      grammar: PROJECT_GRAPHQL_GRAMMAR,
    };
  }

  /** Eine Abfrage, unter der Zeilensicherheit des Aufrufers. */
  async execute(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
    query: string,
  ): Promise<ProjectGraphqlResult> {
    const plan = planProjectGraphqlQuery(query);
    const types = projectGraphqlTypes(await this.data.listReadableTables(context, scope, schema));
    const byName = new Map(types.map((type) => [type.name, type]));
    // Erst den ganzen Plan gegen den Katalog prüfen, dann lesen. Sonst hätte
    // eine Abfrage mit einem falschen Feld im letzten Block schon vier
    // Lesungen bezahlt, deren Ergebnis niemand bekommt.
    for (const field of plan.fields) {
      const type = byName.get(field.table);
      // Eine Tabelle ohne Zeilensicherheit steht nicht im Schema, und die
      // Ablehnung heisst darum „unbekannt“ und nicht „ohne Zeilensicherheit“.
      // Der Unterschied würde die Existenz einer Tabelle verraten, die dieser
      // Aufrufer nicht lesen darf; er steht in der Console und nicht hier.
      if (!type) refuse("unknown_table", field.table);
      const columns = new Set(type.fields.map((entry) => entry.name));
      for (const column of field.columns) {
        if (!columns.has(column)) refuse("unknown_field", `${field.table}.${column}`);
      }
      if (field.order && !columns.has(field.order.column)) {
        refuse("unknown_field", `${field.table}.${field.order.column}`);
      }
      for (const filter of field.filters) {
        if (!columns.has(filter.column)) refuse("unknown_field", `${field.table}.${filter.column}`);
      }
    }

    const data: Record<string, Array<Record<string, unknown>>> = {};
    const results: ProjectGraphqlFieldResult[] = [];
    // Der Reihe nach und nicht parallel. Fünf gleichzeitige Lesungen aus einer
    // Anfrage wären fünf Verbindungen aus dem Pool des Projekts, und eine
    // einzelne Anfrage soll den Pool nicht für alle anderen leeren.
    for (const field of plan.fields) {
      const result = await this.data.listRows(context, scope, {
        schema,
        table: field.table,
        select: field.columns,
        filters: field.filters,
        ...(field.order ? { order: field.order } : {}),
        ...(field.cursor ? { cursor: field.cursor } : {}),
        limit: field.limit,
      });
      data[field.responseKey] = result.rows.map((row) => Object.fromEntries(
        field.selection.map((entry) => [entry.responseKey, row[entry.column] ?? null]),
      ));
      results.push({
        responseKey: field.responseKey,
        table: field.table,
        rowCount: result.rowCount,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    }
    return {
      data,
      fields: results,
      fieldCount: plan.fieldCount,
      rowBudget: plan.rowBudget,
      operationName: plan.operationName,
    };
  }
}
