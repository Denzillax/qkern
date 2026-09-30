import { DATA_API_GRAPHQL_LIMITS } from "@/lib/data-api-graphql-limits";
import { DATA_API_LIMITS, type DataApiFilterOperator } from "@/lib/data-api-limits";
import { DATA_IDENTIFIER } from "@/lib/server/data-plane/identifiers";
import { recognisedByName } from "@/lib/server/errors/identity";
import type {
  GeneratedDataApiPort,
  GeneratedDataContext,
  GeneratedDataFilter,
  GeneratedMutation,
  GeneratedTable,
} from "@/lib/server/data-plane/generated-api";
import type { ProjectDataPlaneScope } from "@/lib/server/data-plane/service";

/**
 * Die GraphQL-Fläche über dem Projektschema (2.83 lesend, 2.97 schreibend).
 *
 * **Was sie ist.** Ein sehr kleiner Ausschnitt von GraphQL, der auf genau zwei
 * Dinge abbildet: `listRows` der generierten Data API, einmal je Feld einer
 * Abfrage, und `mutateRows` derselben Data API, einmal je Mutation. Es
 * entsteht kein zweiter Weg in die Datenbank, keine zweite Stelle, an der
 * Ansprüche gesetzt werden, und keine zweite Rechteprüfung. Der Aufrufer sieht
 * hier genau die Zeilen, die er über die REST-Fläche auch sähe, und schreibt
 * genau die, die er dort auch schreiben könnte, weil es dieselbe Fläche ist.
 *
 * **Warum ohne Bibliothek.** Eine GraphQL-Bibliothek bringt die ganze Sprache
 * mit: Fragmente, Variablen, Direktiven, Introspektion, Eingabetypen,
 * Schnittstellen, Unions. Jede dieser Ecken wäre dann eine Zusage, für die
 * jemand einstehen muss, und mehrere davon (Fragment-Rekursion, Introspektion,
 * Aliasse) sind genau die Stellen, an denen eine Grenze umgangen wird. Der
 * Ausschnitt hier ist so klein, dass der Parser in eine Datei passt und jede
 * Ablehnung einen Namen hat.
 *
 * **Mutationen, seit 2.97.** `insertInto<Tabelle>Collection`,
 * `update<Tabelle>Collection` und `deleteFrom<Tabelle>Collection`, benannt wie
 * bei pg_graphql, und seit 2.105 nimmt das Einfuegen `onConflict` und wird
 * damit zum Upsert. Alle Mutationen einer Anfrage laufen in **einer**
 * Transaktion der Data API: Fällt eine, auch an einer Policy, wirkt keine.
 * Ändern und Löschen verlangen eine Bedingung; eine Mutation ohne `where`
 * träfe jede Zeile, die die Policy hergibt, und das meint kein Formular. Die
 * Zeilen je Mutation und die Mutationen je Anfrage stehen in
 * `lib/data-api-limits.ts`, weil die REST-Fläche dieselbe Zahl kennt.
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
  | "subscription_not_supported"
  | "fragment_not_supported"
  | "variable_not_supported"
  | "directive_not_supported"
  | "introspection_not_supported"
  | "block_string_not_supported"
  | "enum_not_supported"
  | "object_argument_not_supported"
  | "nested_object_not_supported"
  | "object_fields_exceeded"
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
  | "unknown_field"
  /** Mutationen (2.97): der Name passt auf keine der drei Formen, oder die Tabelle hat sie nicht. */
  | "unknown_mutation"
  | "mutations_exceeded"
  | "mutation_rows_exceeded"
  | "filter_required"
  | "argument_required";

/**
 * Eine abgewiesene Abfrage.
 *
 * Die Nachricht bleibt inhaltsfrei und gleich; der Grund steht in `reason`, und
 * die Route gibt ihn weiter, weil er eine Aussage über die Abfrage ist und
 * nicht über die Daten.
 */
export class ProjectGraphqlError extends Error {
  constructor(readonly reason: ProjectGraphqlRejection, readonly at?: string) {
    super("The GraphQL document was refused.");
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
    "mutations",
    "row_objects",
    "upserts",
  ] as const,
  /** Was er abweist, jedes mit eigenem Grund. */
  refused: [
    "subscription",
    "fragments",
    "variables",
    "directives",
    "introspection",
    "enum_values",
    "filter_objects",
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

type Scalar = string | number | boolean | null;
/** Ein Eingabeobjekt: eine Zeile oder eine Zuweisung, nur mit skalaren Werten (2.97). */
type ObjectValue = Record<string, Scalar>;
type ArgumentValue = Scalar | Scalar[] | ObjectValue | ObjectValue[];

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
  /**
   * Was das Dokument ist. Eine Mutation darf Eingabeobjekte tragen und eine
   * Ebene mehr (`records { spalte }`); eine Abfrage darf beides nicht. Der
   * Modus steht fest, sobald das erste Wort gelesen ist.
   */
  private kind: "query" | "mutation" = "query";

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
  parseDocument(): {
    kind: "query" | "mutation"; operationName: string | null; fields: ParsedField[]; fieldCount: number;
  } {
    let operationName: string | null = null;
    const first = this.peek();
    if (first.kind === "eof") refuse("query_empty");
    if (first.kind === "name") {
      if (first.value === "subscription") refuse("subscription_not_supported");
      if (first.value === "fragment") refuse("fragment_not_supported");
      if (first.value !== "query" && first.value !== "mutation") refuse("syntax_error");
      this.kind = first.value;
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
    return { kind: this.kind, operationName, fields, fieldCount: this.fieldCount };
  }

  /** Die Tiefe, die dieses Dokument haben darf: bei einer Mutation eine mehr, für `records`. */
  private maxDepth(): number {
    return DATA_API_GRAPHQL_LIMITS.maxDepth + (this.kind === "mutation" ? 1 : 0);
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
      if (depth + 1 > this.maxDepth()) refuse("depth_exceeded", name);
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

  private parseValue(inList: boolean, inObject = false): ArgumentValue {
    const token = this.peek();
    if (token.kind === "eof") refuse("unexpected_end");
    if (token.kind === "punct" && token.value === "$") refuse("variable_not_supported");
    if (token.kind === "punct" && token.value === "{") {
      // Ein Eingabeobjekt. In einer Abfrage gibt es keines: Ein Filter ist
      // eine Zeichenkette. In einer Mutation ist es eine Zeile oder eine
      // Zuweisung, flach, mit skalaren Werten; ein Objekt im Objekt wäre eine
      // Beziehung, und Beziehungen gibt es an dieser Fläche nicht.
      if (this.kind !== "mutation") refuse("object_argument_not_supported");
      if (inObject) refuse("nested_object_not_supported");
      return this.parseObject();
    }
    if (token.kind === "punct" && token.value === "[") {
      if (inList) refuse("nested_list_not_supported");
      if (inObject) refuse("nested_object_not_supported");
      this.position += 1;
      const entries: Array<Scalar | ObjectValue> = [];
      while (!this.atPunct("]")) {
        if (this.peek().kind === "eof") refuse("unexpected_end");
        const entry = this.parseValue(true) as Scalar | ObjectValue;
        entries.push(entry);
        // Zwei Grenzen, je nachdem, was in der Liste steht: Zeichenketten sind
        // Filter, Objekte sind Zeilen, und Zeilen je Mutation haben ihre
        // eigene Zahl in lib/data-api-limits.ts.
        if (entry !== null && typeof entry === "object") {
          if (entries.length > DATA_API_GRAPHQL_LIMITS.maxRowsPerMutation) refuse("mutation_rows_exceeded");
        } else if (entries.length > DATA_API_GRAPHQL_LIMITS.maxListEntries) refuse("list_too_long");
      }
      this.expectPunct("]");
      return entries as Scalar[] | ObjectValue[];
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

  /** Ein flaches Eingabeobjekt, `{ spalte: wert … }`, nur in einer Mutation. */
  private parseObject(): ObjectValue {
    this.expectPunct("{");
    const value: ObjectValue = {};
    let count = 0;
    while (!this.atPunct("}")) {
      if (this.peek().kind === "eof") refuse("unexpected_end");
      const name = this.expectName();
      this.expectPunct(":");
      const entry = this.parseValue(false, true);
      if (Object.hasOwn(value, name)) refuse("duplicate_argument", name);
      // `__proto__` und Verwandte sind keine Spaltennamen und würden das
      // Objekt selbst verändern; die Grammatik der Data API lässt sie nicht
      // zu, und hier fallen sie, bevor sie ein Schlüssel werden.
      if (!DATA_IDENTIFIER.test(name) || name.startsWith("__")) refuse("unknown_field", name);
      value[name] = entry as Scalar;
      count += 1;
      if (count > DATA_API_GRAPHQL_LIMITS.maxObjectFields) refuse("object_fields_exceeded");
    }
    this.expectPunct("}");
    if (count === 0) refuse("syntax_error");
    return value;
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
  kind: "query";
  operationName: string | null;
  fields: ProjectGraphqlFieldPlan[];
  /** Alle Felder zusammen, Aliasse einzeln gezählt. */
  fieldCount: number;
  /** Die Summe der Zeilengrenzen über alle Felder der obersten Ebene. */
  rowBudget: number;
};

/** Die Spalten hinter `records`, wie bei einem Tabellenfeld: jede einmal gelesen, Aliasse einzeln. */
export type ProjectGraphqlRecordsPlan = {
  responseKey: string;
  columns: string[];
  selection: Array<{ responseKey: string; column: string }>;
};

/** Eine Mutation der obersten Ebene, fertig für `mutateRows` (2.97). */
export type ProjectGraphqlMutationFieldPlan = {
  responseKey: string;
  table: string;
  mutation: GeneratedMutation;
  /** Der Antwortschlüssel für `affectedCount`, oder null, wenn er nicht verlangt ist. */
  affectedCount: string | null;
  records: ProjectGraphqlRecordsPlan | null;
};

export type ProjectGraphqlMutationPlan = {
  kind: "mutation";
  operationName: string | null;
  mutations: ProjectGraphqlMutationFieldPlan[];
  fieldCount: number;
  /** Alle Zeilen, die die Anfrage höchstens schreibt: eingefügte plus `atMost` je Bedingung. */
  rowBudget: number;
};

export type ProjectGraphqlDocumentPlan = ProjectGraphqlPlan | ProjectGraphqlMutationPlan;

/**
 * Aus dem Text ein Plan, ohne die Datenbank zu berühren.
 *
 * Die Reihenfolge ist Absicht: Form, dann Grenzen, dann erst der Katalog. Ein
 * Dokument, das zu tief ist oder zu viele Felder holt, kostet so keine
 * Verbindung und keine Katalogabfrage. Die Route ruft das hier zuerst, weil sie
 * am Plan abliest, ob sie Schreibrechte verlangen muss.
 */
export function planProjectGraphqlDocument(query: string): ProjectGraphqlDocumentPlan {
  if (typeof query !== "string") refuse("invalid_argument", "query");
  if (Buffer.byteLength(query, "utf8") > DATA_API_GRAPHQL_LIMITS.maxQueryBytes) refuse("query_too_large");
  if (query.trim().length === 0) refuse("query_empty");
  const document = new Parser(tokenize(query)).parseDocument();
  if (document.kind === "mutation") return planMutation(document);
  if (document.fields.length > DATA_API_GRAPHQL_LIMITS.maxTables) refuse("tables_exceeded");

  // Die Feldzahl kommt aus dem Parser, der sie beim Lesen fuehrt und dort
  // schon abgewiesen hat. Aliasse sind darin einzeln enthalten.
  const fieldCount = document.fieldCount;
  let rowBudget = 0;
  const fields: ProjectGraphqlFieldPlan[] = [];
  for (const field of document.fields) {
    if (!DATA_IDENTIFIER.test(field.name)) refuse("unknown_table", field.name);
    if (!field.selection) refuse("selection_required", field.name);
    const selection = columnSelection(field.selection);
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
  return { kind: "query", operationName: document.operationName, fields, fieldCount, rowBudget };
}

/** Die Spalten einer Auswahl: Blätter ohne Argumente, jedes ein gültiger Name. */
function columnSelection(fields: ParsedField[]): Array<{ responseKey: string; column: string }> {
  const selection: Array<{ responseKey: string; column: string }> = [];
  for (const column of fields) {
    if (column.selection) refuse("depth_exceeded", column.name);
    // Ein Argument auf einer Spalte wäre eine Zusage, die es nicht gibt: Es
    // gibt keine Feldauflöser hier, nur `SELECT spalte`.
    if (column.argumentsByName.size > 0) refuse("column_arguments_not_supported", column.name);
    if (!DATA_IDENTIFIER.test(column.name)) refuse("unknown_field", column.name);
    selection.push({ responseKey: column.responseKey, column: column.name });
  }
  return selection;
}

/** Die drei Formen einer Mutation, benannt wie bei pg_graphql: der Tabellenname steht in der Mitte. */
const MUTATION_NAME = /^(insertInto|update|deleteFrom)(.+)Collection$/;

/**
 * Der Plan einer Mutation (2.97).
 *
 * Alles hier ist Form: Name, Argumente, Auswahl, Grenzen. Ob die Tabelle die
 * Mutation hat und ob eine Spalte existiert, sagt erst der Katalog in
 * `execute`; ob eine Zeile durchkommt, sagt erst die Policy in der Datenbank.
 */
function planMutation(document: {
  operationName: string | null; fields: ParsedField[]; fieldCount: number;
}): ProjectGraphqlMutationPlan {
  if (document.fields.length > DATA_API_GRAPHQL_LIMITS.maxMutationsPerRequest) refuse("mutations_exceeded");
  const mutations: ProjectGraphqlMutationFieldPlan[] = [];
  let rowBudget = 0;
  for (const field of document.fields) {
    const match = MUTATION_NAME.exec(field.name);
    if (!match || !DATA_IDENTIFIER.test(match[2]!)) refuse("unknown_mutation", field.name);
    const kind = match[1] === "insertInto" ? "insert" : match[1] === "update" ? "update" : "delete";
    const table = match[2]!;
    if (!field.selection) refuse("selection_required", field.name);

    // Die Auswahl: `affectedCount` und `records { spalte }`, beide mit Alias,
    // keines mit Argumenten, und sonst nichts.
    let affectedCount: string | null = null;
    let records: ProjectGraphqlRecordsPlan | null = null;
    for (const entry of field.selection) {
      if (entry.argumentsByName.size > 0) refuse("column_arguments_not_supported", entry.name);
      if (entry.name === "affectedCount") {
        if (entry.selection) refuse("depth_exceeded", entry.name);
        if (affectedCount !== null) refuse("duplicate_response_key", entry.responseKey);
        affectedCount = entry.responseKey;
        continue;
      }
      if (entry.name === "records") {
        if (!entry.selection) refuse("selection_required", entry.name);
        if (records !== null) refuse("duplicate_response_key", entry.responseKey);
        const selection = columnSelection(entry.selection);
        records = {
          responseKey: entry.responseKey,
          columns: [...new Set(selection.map((column) => column.column))],
          selection,
        };
        continue;
      }
      refuse("unknown_field", `${field.name}.${entry.name}`);
    }

    const mutation = mutationArguments(kind, table, field);
    rowBudget += mutation.kind === "insert" ? mutation.rows.length
      : (mutation.atMost ?? DATA_API_GRAPHQL_LIMITS.maxRowsPerMutation);
    mutations.push({ responseKey: field.responseKey, table, mutation, affectedCount, records });
  }
  return { kind: "mutation", operationName: document.operationName, mutations, fieldCount: document.fieldCount, rowBudget };
}

/** Die Argumente einer Mutation, je Form die eigenen; alles andere ist unbekannt. */
function mutationArguments(kind: "insert" | "update" | "delete", table: string, field: ParsedField): GeneratedMutation {
  const raw = field.argumentsByName;
  const allowed: readonly string[] = kind === "insert" ? ["objects", "onConflict"] : kind === "update"
    ? ["set", "where", "atMost"] : ["where", "atMost"];
  for (const name of raw.keys()) {
    if (!(DATA_API_GRAPHQL_LIMITS.mutationArguments as readonly string[]).includes(name)) refuse("unknown_argument", name);
    if (!allowed.includes(name)) refuse("unknown_argument", name);
  }
  if (kind === "insert") {
    if (!raw.has("objects")) refuse("argument_required", "objects");
    const value = raw.get("objects");
    const rows = Array.isArray(value) ? value : [value];
    if (rows.length === 0) refuse("invalid_argument", "objects");
    if (rows.length > DATA_API_GRAPHQL_LIMITS.maxRowsPerMutation) refuse("mutation_rows_exceeded");
    if (!rows.every(isObjectValue)) refuse("invalid_argument", "objects");
    // `onConflict` macht aus dem Einfuegen einen Upsert (2.105). Hier faellt
    // nur die Form: Ob es zu diesen Spalten einen eindeutigen Schluessel gibt,
    // sagt der Katalog in der Data API, und zwar bevor eine Zeile steht.
    const onConflict = conflictColumns(raw.get("onConflict"), raw.has("onConflict"));
    return { kind: "insert", table, rows: rows.map((row) => ({ ...row })),
      ...(onConflict ? { onConflict } : {}) };
  }
  // Ändern und Löschen: ohne Bedingung nicht. Das ist die eine Ablehnung, die
  // ein Aufrufer nicht umgehen können soll, und sie hat darum einen eigenen
  // Namen statt "Argument fehlt".
  if (!raw.has("where")) refuse("filter_required", field.name);
  const whereValue = raw.get("where");
  const entries = Array.isArray(whereValue) ? whereValue : [whereValue];
  if (entries.length === 0) refuse("filter_required", field.name);
  if (entries.length > DATA_API_GRAPHQL_LIMITS.maxFiltersPerField) refuse("filters_exceeded");
  const filters: GeneratedDataFilter[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") refuse("invalid_argument", "where");
    filters.push(parseFilter(entry));
  }
  let atMost: number | undefined;
  if (raw.has("atMost")) {
    const value = raw.get("atMost");
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) refuse("invalid_argument", "atMost");
    if (value > DATA_API_GRAPHQL_LIMITS.maxRowsPerMutation) refuse("mutation_rows_exceeded");
    atMost = value;
  }
  if (kind === "delete") return { kind: "delete", table, filters, ...(atMost !== undefined ? { atMost } : {}) };
  if (!raw.has("set")) refuse("argument_required", "set");
  const set = raw.get("set");
  if (!isObjectValue(set)) refuse("invalid_argument", "set");
  return { kind: "update", table, filters, values: { ...set }, ...(atMost !== undefined ? { atMost } : {}) };
}

/**
 * Die Spalten des Konfliktschluessels eines Upsert, in der Form (2.105).
 *
 * Eine Liste von Namen, oder ein einzelner Name als Kurzform, wie `where` es
 * auch annimmt. Jeder Name muss ein Bezeichner dieser Flaeche sein, und keiner
 * darf zweimal stehen: `onConflict: ["email", "email"]` benennt keinen Index,
 * es sieht nur so aus.
 */
function conflictColumns(value: ArgumentValue | undefined, present: boolean): string[] | undefined {
  if (!present) return undefined;
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0) refuse("invalid_argument", "onConflict");
  if (entries.length > DATA_API_GRAPHQL_LIMITS.maxListEntries) refuse("list_too_long", "onConflict");
  const columns: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !DATA_IDENTIFIER.test(entry)) refuse("invalid_argument", "onConflict");
    if (columns.includes(entry)) refuse("invalid_argument", "onConflict");
    columns.push(entry);
  }
  return columns;
}

function isObjectValue(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  /**
   * Die Spalten, die eine Zeile beim Einfügen tragen darf (2.97): einfügbar für
   * die Projektrolle, nicht sensibel, keine Identitäts- und keine berechnete
   * Spalte. Leer, wenn die Rolle nicht einfügen darf.
   */
  insertFields: ProjectGraphqlFieldType[];
  /** Die Spalten, die `set` nennen darf: änderbar, nicht sensibel, nicht im Primärschlüssel. */
  updateFields: ProjectGraphqlFieldType[];
  /**
   * Welche der drei Mutationen diese Tabelle hat; das entscheiden die
   * Tabellenrechte der Rolle. `upsert` ist keine vierte Form, sondern das
   * Argument `onConflict` am Einfuegen (2.105): Es steht nur dort, wo die Rolle
   * einfuegen **und** aendern darf, weil ein Upsert eine vorhandene Zeile
   * aendert.
   */
  mutations: { insert: boolean; update: boolean; delete: boolean; upsert: boolean };
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
    const fieldOf = (column: GeneratedTable["columns"][number]): ProjectGraphqlFieldType => ({
      name: column.name,
      type: graphqlScalar(column.dataType, primaryKey.has(column.name)),
      nullable: column.nullable && !primaryKey.has(column.name),
      primaryKey: primaryKey.has(column.name),
      dataType: column.dataType,
    });
    const usable = table.columns.filter((column) => !column.sensitive && exposableName(column.name));
    const fields = usable.filter((column) => column.selectable).map(fieldOf);
    if (fields.length === 0) continue;
    // Die Eingabefelder folgen denselben Regeln, nach denen die Data API ein
    // Einfügen und ein Ändern annimmt; eine Spalte, die hier steht und dort
    // fällt, wäre eine Zusage ohne Deckung. Dazu dieselbe Regel wie im
    // generierten OpenAPI-Dokument: Das Schema nennt nur Spalten, die die
    // Rolle auch lesen darf. Eine Spalte mit Schreibrecht ohne Leserecht
    // nähme die REST-Fläche an; hier bliebe sie ein unbekanntes Feld, weil
    // ein Name im Schema sonst mehr verriete als die Leseroute daneben.
    const insertFields = usable
      .filter((column) => column.selectable && column.insertable && !column.identity && !column.generated)
      .map(fieldOf);
    const updateFields = usable
      .filter((column) => column.selectable && column.updateable && !column.identity && !column.generated &&
        !primaryKey.has(column.name))
      .map(fieldOf);
    const mutations = {
      insert: table.canInsert === true && insertFields.length > 0,
      update: table.canUpdate === true && updateFields.length > 0,
      delete: table.canDelete === true,
    };
    types.push({
      name: table.name,
      fields,
      insertFields,
      updateFields,
      // Ein Upsert (2.105) ist ein Einfuegen, das aendern kann. Er steht darum
      // nur dort, wo beide Rechte da sind, und nicht als eigene Form.
      mutations: { ...mutations, upsert: mutations.insert && mutations.update },
    });
  }
  return types.sort((left, right) => left.name.localeCompare(right.name));
}

/** Das Schema als Text, aus denselben Typen, die die Ausführung benutzt. */
export function projectGraphqlSdl(types: ProjectGraphqlType[]): string {
  const argumentList = "limit: Int, orderBy: String, direction: String, where: [String!], after: String";
  const lines: string[] = [];
  lines.push("# QKERN, GraphQL-Flaeche ueber dem Projektschema.");
  lines.push("# Jedes Abfragefeld ist eine Lesung, jede Mutation ein Schreiben der Data API,");
  lines.push("# beides unter der Zeilensicherheit des Aufrufers. Alle Mutationen einer Anfrage");
  lines.push("# laufen in einer Transaktion: faellt eine, wirkt keine.");
  lines.push("");
  lines.push("type Query {");
  for (const type of types) lines.push(`  ${type.name}(${argumentList}): [${type.name}!]!`);
  if (types.length === 0) lines.push("  # Keine Tabelle dieses Schemas erfuellt die Bedingungen.");
  lines.push("}");
  const writable = types.filter((type) => type.mutations.insert || type.mutations.update || type.mutations.delete);
  if (writable.length > 0) {
    lines.push("");
    lines.push("type Mutation {");
    for (const type of writable) {
      if (type.mutations.insert) {
        // `onConflict` steht nur an einer Tabelle, an der die Rolle auch
        // aendern darf; ohne das Recht waere es eine Zusage ohne Deckung.
        const upsert = type.mutations.upsert ? ", onConflict: [String!]" : "";
        lines.push(`  insertInto${type.name}Collection(objects: [${type.name}InsertInput!]!${upsert}): ${type.name}MutationResponse!`);
      }
      if (type.mutations.update) {
        lines.push(`  update${type.name}Collection(set: ${type.name}UpdateInput!, where: [String!]!, atMost: Int): ${type.name}MutationResponse!`);
      }
      if (type.mutations.delete) {
        lines.push(`  deleteFrom${type.name}Collection(where: [String!]!, atMost: Int): ${type.name}MutationResponse!`);
      }
    }
    lines.push("}");
  }
  for (const type of types) {
    lines.push("");
    lines.push(`type ${type.name} {`);
    for (const field of type.fields) {
      lines.push(`  ${field.name}: ${field.type}${field.nullable ? "" : "!"}`);
    }
    lines.push("}");
    if (type.mutations.insert || type.mutations.update || type.mutations.delete) {
      lines.push("");
      lines.push(`type ${type.name}MutationResponse {`);
      lines.push("  affectedCount: Int!");
      lines.push(`  records: [${type.name}!]!`);
      lines.push("}");
    }
    // Kein Feld der Eingabetypen traegt ein `!`: Ob eine Spalte beim Einfuegen
    // fehlen darf, entscheidet ihr DEFAULT in der Tabelle, und den kennt diese
    // Flaeche nicht. Ein `!` waere eine Zusage, die die Tabelle nicht haelt.
    if (type.mutations.insert) {
      lines.push("");
      lines.push(`input ${type.name}InsertInput {`);
      for (const field of type.insertFields) lines.push(`  ${field.name}: ${field.type}`);
      lines.push("}");
    }
    if (type.mutations.update) {
      lines.push("");
      lines.push(`input ${type.name}UpdateInput {`);
      for (const field of type.updateFields) lines.push(`  ${field.name}: ${field.type}`);
      lines.push("}");
    }
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
  kind: "query";
  data: Record<string, Array<Record<string, unknown>>>;
  fields: ProjectGraphqlFieldResult[];
  fieldCount: number;
  rowBudget: number;
  operationName: string | null;
};

export type ProjectGraphqlMutationFieldResult = {
  responseKey: string;
  table: string;
  kind: "insert" | "update" | "delete";
  affectedCount: number;
};

/** Das Ergebnis einer Mutation (2.97): je Feld `affectedCount` und `records`, unter den Aliassen des Aufrufers. */
export type ProjectGraphqlMutationResult = {
  kind: "mutation";
  data: Record<string, Record<string, unknown>>;
  mutations: ProjectGraphqlMutationFieldResult[];
  fieldCount: number;
  rowBudget: number;
  operationName: string | null;
};

export type ProjectGraphqlDocumentResult = ProjectGraphqlResult | ProjectGraphqlMutationResult;

/**
 * Die Fläche selbst.
 *
 * Sie hält keine Verbindung und kein Wissen über die Datenbank. Alles, was sie
 * über das Schema weiss, kommt aus `listReadableTables`, alles, was sie liest,
 * geht durch `listRows`, und alles, was sie schreibt, durch `mutateRows`. So
 * gibt es keinen zweiten Weg, an dem eine Prüfung fehlen könnte.
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

  /**
   * Ein Dokument, unter der Zeilensicherheit des Aufrufers.
   *
   * Nimmt den Text oder einen fertigen Plan: Die Route plant zuerst, weil sie
   * am Plan abliest, ob sie Schreibrechte verlangen muss, und gibt den Plan
   * dann hierher, statt den Text ein zweites Mal zu lesen.
   */
  async execute(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
    document: string | ProjectGraphqlDocumentPlan,
  ): Promise<ProjectGraphqlDocumentResult> {
    const plan = typeof document === "string" ? planProjectGraphqlDocument(document) : document;
    const types = projectGraphqlTypes(await this.data.listReadableTables(context, scope, schema));
    const byName = new Map(types.map((type) => [type.name, type]));
    if (plan.kind === "mutation") return this.mutate(context, scope, schema, plan, byName);
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
      kind: "query",
      data,
      fields: results,
      fieldCount: plan.fieldCount,
      rowBudget: plan.rowBudget,
      operationName: plan.operationName,
    };
  }

  /**
   * Die Mutationen einer Anfrage, in einer Transaktion der Data API (2.97).
   *
   * Erst der ganze Plan gegen den Katalog, dann ein einziger Aufruf von
   * `mutateRows`. Die Ablehnungen hier sind Form und Katalog: unbekannte
   * Mutation, unbekannte Spalte. Was die Datenbank entscheidet, entscheidet
   * sie für alle Mutationen zusammen; eine Policy, die die dritte Zeile
   * abweist, lässt auch die erste nicht stehen.
   */
  private async mutate(
    context: GeneratedDataContext,
    scope: ProjectDataPlaneScope,
    schema: string,
    plan: ProjectGraphqlMutationPlan,
    byName: Map<string, ProjectGraphqlType>,
  ): Promise<ProjectGraphqlMutationResult> {
    for (const field of plan.mutations) {
      const type = byName.get(field.table);
      // Eine Tabelle ohne Zeilensicherheit oder ohne das Recht steht nicht im
      // Schema, und die Ablehnung heisst darum „unbekannt“: Der Unterschied
      // würde verraten, dass die Tabelle existiert, wie bei einer Abfrage.
      if (!type || !type.mutations[field.mutation.kind]) refuse("unknown_mutation", field.responseKey);
      const columns = new Set(type.fields.map((entry) => entry.name));
      if (field.records) {
        for (const column of field.records.columns) {
          if (!columns.has(column)) refuse("unknown_field", `${field.table}.${column}`);
        }
      }
      if (field.mutation.kind === "insert") {
        const insertable = new Set(type.insertFields.map((entry) => entry.name));
        for (const row of field.mutation.rows) {
          for (const column of Object.keys(row)) {
            if (!insertable.has(column)) refuse("unknown_field", `${field.table}.${column}`);
          }
        }
        // `onConflict` steht nur an einer Tabelle, an der die Rolle auch
        // aendern darf (2.105). Fehlt das Recht, steht das Argument nicht im
        // Schema, und die Ablehnung heisst darum "unbekanntes Argument" und
        // nicht "kein Recht": Genau so antwortet diese Flaeche auf alles, was
        // im Schema nicht steht.
        if (field.mutation.onConflict && !type.mutations.upsert) {
          refuse("unknown_argument", "onConflict");
        }
        // Der Konfliktschluessel eines Upsert (2.105) nennt Spalten dieser
        // Tabelle. Dass sie zusammen einen eindeutigen Schluessel bilden, sagt
        // der Katalog in der Data API; dass sie ueberhaupt Spalten sind, sagt
        // das Schema hier, mit derselben Ablehnung wie ein unbekanntes Feld.
        for (const column of field.mutation.onConflict ?? []) {
          if (!columns.has(column)) refuse("unknown_field", `${field.table}.${column}`);
        }
        continue;
      }
      for (const filter of field.mutation.filters) {
        if (!columns.has(filter.column)) refuse("unknown_field", `${field.table}.${filter.column}`);
      }
      if (field.mutation.kind === "update") {
        const updateable = new Set(type.updateFields.map((entry) => entry.name));
        for (const column of Object.keys(field.mutation.values)) {
          if (!updateable.has(column)) refuse("unknown_field", `${field.table}.${column}`);
        }
      }
    }

    const batch = await this.data.mutateRows(context, scope, {
      schema,
      mutations: plan.mutations.map((field) => field.mutation),
    });
    const data: Record<string, Record<string, unknown>> = {};
    const results: ProjectGraphqlMutationFieldResult[] = [];
    plan.mutations.forEach((field, index) => {
      const result = batch.results[index];
      if (!result) refuse("invalid_argument", field.responseKey);
      const entry: Record<string, unknown> = {};
      if (field.affectedCount !== null) entry[field.affectedCount] = result.rowCount;
      if (field.records) {
        const records = field.records;
        entry[records.responseKey] = result.rows.map((row) => Object.fromEntries(
          records.selection.map((column) => [column.responseKey, row[column.column] ?? null]),
        ));
      }
      data[field.responseKey] = entry;
      results.push({
        responseKey: field.responseKey,
        table: field.table,
        kind: field.mutation.kind,
        affectedCount: result.rowCount,
      });
    });
    return {
      kind: "mutation",
      data,
      mutations: results,
      fieldCount: plan.fieldCount,
      rowBudget: plan.rowBudget,
      operationName: plan.operationName,
    };
  }
}
