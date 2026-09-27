/**
 * Die Texte von Integrationen -> GraphQL (2.83), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `auth-third-party-texts` (2.80) und `wrappers-texts`
 * (2.72): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn ueber
 * ihren Katalog, und der Vertrag `console-i18n-contract` liest diese Tabellen
 * mit und verlangt fuer jeden Text en, fr und it. Ein eigenes Modul braucht es,
 * weil die Ansicht `t(variable)` aufruft und ein Text hinter einer Variablen
 * durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der Platzhalter, den diese Seite ersetzt, sagte: "GraphQL-Schnittstelle ueber
 * dem Schema. Die Data API ist REST." Gebaut ist jetzt ein Ausschnitt davon,
 * und die Texte hier sagen, welcher und was bewusst fehlt.
 */

import type { ProjectGraphqlAccepted, ProjectGraphqlRefused } from "@/lib/server/data-plane/graphql";

/* ------------------------------------------------------------------ *
 * Was diese Fläche ist
 * ------------------------------------------------------------------ */

/** Was hier steht, in einem Satz. */
export const GRAPHQL_WHAT =
  "Diese Fläche beantwortet GraphQL-Abfragen über den Tabellen Ihres Projektschemas. Sie liest, und sie liest nur: Jede Abfrage wird auf dieselben Lesungen abgebildet, die die Data API auch macht.";

/** Warum es keine Mutationen gibt. */
export const GRAPHQL_NO_MUTATIONS =
  "Es gibt keine Mutationen. Geschrieben wird über die Data API, und zwar dort allein. Ein zweiter Schreibweg wäre eine zweite Rechteprüfung, und die zweite ist immer die, die jemand vergisst.";

/** Der Weg in die Datenbank. */
export const GRAPHQL_SAME_PATH =
  "Jede Abfrage läuft unter der Zeilensicherheit des Aufrufers, über genau denselben Weg wie die Data API: dieselbe Projektrolle ohne BYPASSRLS, dieselbe Lese-Transaktion, dieselben Ansprüche in request.jwt.claims. Es gibt hier keine zweite Stelle, an der Ansprüche gesetzt werden.";

/** Woher das Schema kommt. */
export const GRAPHQL_SCHEMA_FROM_CATALOG =
  "Das Schema unten ist nicht von Hand gepflegt. Es entsteht bei jeder Anfrage aus dem Katalog Ihrer Projektdatenbank: Tabellen mit Zeilensicherheit und Primärschlüssel, die die Leserolle lesen darf, mit ihren Spalten und Typen. Ändern Sie eine Tabelle, ändert sich das Schema mit der nächsten Anfrage.";

/** Was nicht im Schema steht. */
export const GRAPHQL_SCHEMA_OMISSIONS =
  "Nicht im Schema: Tabellen ohne Zeilensicherheit, Tabellen ohne Primärschlüssel, Views, Spalten ohne Leserecht der Projektrolle und Spalten, deren Name auf Passwort, Secret, Token, Cookie, Key oder Authorization deutet. Eine Abfrage auf einen dieser Namen wird als unbekannt abgewiesen.";

/** Und dass das Schema nicht je Aufrufer gefiltert ist. */
export const GRAPHQL_SCHEMA_NOT_PER_CALLER =
  "Das Schema nennt, was die Projektrolle lesen darf. Welche Zeilen Sie sehen, entscheidet erst die Policy beim Lesen. Das Schema ist also keine Aussage darüber, dass diese Tabelle für Sie Zeilen hat, genauso wenig wie das generierte OpenAPI-Dokument daneben.";

/* ------------------------------------------------------------------ *
 * Die Grenzen
 * ------------------------------------------------------------------ */

/** Warum es überhaupt harte Grenzen gibt. */
export const GRAPHQL_WHY_LIMITS =
  "GraphQL lässt den Aufrufer die Form der Antwort bestimmen. Ohne Tiefenbegrenzung und ohne Feldzahl ist eine einzige Anfrage genug, um die Datenbank beliebig lange zu beschäftigen. Die Grenzen stehen deshalb vor der Datenbank und nicht in einem Zeitlimit dahinter.";

/** Die Tiefe. */
export const GRAPHQL_LIMIT_DEPTH =
  "Zwei Ebenen, und mehr gibt es nicht zu holen: die Tabelle und ihre Spalten. Es gibt an dieser Fläche keine Beziehungen zwischen Tabellen, also wäre eine dritte Ebene entweder leer oder ein Feld auf einem Wert.";

/** Die Felder, und warum Aliasse mitzählen. */
export const GRAPHQL_LIMIT_FIELDS =
  "Gezählt wird jedes Feld einzeln, Aliasse eingeschlossen. Sonst wäre a: id b: id c: id ein Weg, die Grenze zu umgehen, ohne sie zu verletzen. Aliasse sind erlaubt, weil dieselbe Tabelle sonst nicht zweimal abfragbar wäre; sie kosten nur, was sie kosten.";

/** Die Zeilen. */
export const GRAPHQL_LIMIT_ROWS =
  "Je Feld gilt dieselbe Zeilengrenze wie bei der Data API, und über die ganze Abfrage gilt zusätzlich eine Summe. Ohne die Summe wären fünf Felder an der Einzelgrenze eine Abfrage, die fünfmal so viel holt wie jede einzelne darf.";

/** Warum die Lesungen nacheinander laufen. */
export const GRAPHQL_SEQUENTIAL =
  "Die Felder der obersten Ebene werden nacheinander gelesen und nicht gleichzeitig. Fünf gleichzeitige Lesungen aus einer Anfrage wären fünf Verbindungen aus dem Pool des Projekts, und eine einzelne Anfrage soll den Pool nicht für alle anderen leeren.";

/** Die Introspektion. */
export const GRAPHQL_NO_INTROSPECTION =
  "__schema, __type und __typename werden abgewiesen. Das Schema steht stattdessen an der eigenen Leseroute, und dort verlangt es dieselbe Berechtigung wie eine Lesung. So gibt es keinen Weg, der mehr verrät als die Tabellen, die der Aufrufer ohnehin lesen darf.";

/* ------------------------------------------------------------------ *
 * Der Ausschnitt der Sprache
 * ------------------------------------------------------------------ */

/** Warum der Parser selbst geschrieben ist. */
export const GRAPHQL_OWN_PARSER =
  "Der Parser ist eigens für diesen Ausschnitt geschrieben und bringt keine GraphQL-Bibliothek mit. Eine Bibliothek brächte die ganze Sprache mit, und jede ihrer Ecken wäre dann eine Zusage, für die jemand einstehen muss. Mehrere dieser Ecken sind genau die Stellen, an denen eine Grenze umgangen wird.";

/** Was der Parser annimmt, je Eintrag ein Satz. */
export const GRAPHQL_ACCEPTED_TEXTS: Record<ProjectGraphqlAccepted, string> = {
  query_shorthand: "Die Kurzform ohne das Wort query, also { tabelle { spalte } }.",
  named_query: "Eine benannte Abfrage, query Name { … }. Der Name steht in der Antwort und wirkt sonst nicht.",
  top_level_table_fields: "Felder der obersten Ebene: je eines eine Tabelle und damit genau eine Lesung.",
  column_fields: "Felder der zweiten Ebene: die Spalten dieser Tabelle.",
  aliases: "Aliasse, alias: feld, auf beiden Ebenen. Sie zählen einzeln gegen die Grenzen.",
  scalar_arguments: "Argumente mit Zahl, Zeichenkette, true, false und null.",
  string_lists: "Listen von Zeichenketten als Argumentwert, für where.",
  comments: "Kommentare mit # bis zum Zeilenende.",
};

/** Was er abweist, je Eintrag mit Grund. */
export const GRAPHQL_REFUSED_TEXTS: Record<ProjectGraphqlRefused, string> = {
  mutation: "Mutationen. Geschrieben wird über die Data API; ein zweiter Schreibweg wäre eine zweite Rechteprüfung.",
  subscription: "Subscriptions. Laufende Änderungen laufen über Realtime, und das ist ein eigener Transport mit eigenen Rechten.",
  fragments: "Fragmente, benannt wie inline. Ohne sie gibt es auch keine Fragment-Rekursion zu begrenzen, und eine Begrenzung, die es nicht braucht, kann auch nicht danebenliegen.",
  variables: "Variablen und Variablendefinitionen. Werte stehen in der Abfrage; in SQL landen sie ohnehin als Parameter.",
  directives: "Direktiven wie @include und @skip. Sie ändern, welche Felder wirklich geholt werden, und eine Grenze, die vor der Auswertung zählt, zählte dann das Falsche.",
  introspection: "__schema, __type und __typename. Das Schema steht an der eigenen Route.",
  enum_values: "Enum-Werte. Es gibt an dieser Fläche keinen Enum-Typ, also gäbe es auch keinen, gegen den geprüft würde.",
  input_objects: "Eingabeobjekte als Argument, also where: { … }. Ein Filter ist stattdessen eine Zeichenkette in derselben Form wie der Parameter filter der Data API.",
  block_strings: "Block-Zeichenketten mit drei Anführungszeichen.",
  multiple_operations: "Mehrere Operationen in einem Dokument. Ohne Operationsnamen in der Anfrage wäre nicht entscheidbar, welche gemeint ist.",
  relations: "Beziehungen zwischen Tabellen. Ein Feld, das die zugehörigen Zeilen einer anderen Tabelle nachlädt, ist genau die Abfrage, die je Zeile eine weitere Lesung auslöst.",
  views: "Views. Sie haben keinen Primärschlüssel und damit keine Ordnung, auf der ein Cursor stehen könnte. Über die Data API sind sie lesbar, hier nicht.",
  aggregates: "Aggregate wie count oder sum. Sie stehen an der eigenen Route der Data API, mit ihren eigenen Regeln für numerische und sortierbare Spalten.",
};

/* ------------------------------------------------------------------ *
 * Die Argumente
 * ------------------------------------------------------------------ */

/** Was ein Argument eines Tabellenfeldes tut. */
export const GRAPHQL_ARGUMENT_TEXTS: Record<string, string> = {
  limit: "Wie viele Zeilen dieses Feld höchstens liefert. Ohne Angabe gilt die Vorgabe.",
  orderBy: "Nach welcher Spalte sortiert wird. Ohne Angabe sortiert der Primärschlüssel.",
  direction: "asc oder desc, nur zusammen mit orderBy. Allein wäre es eine Zusage über eine Spalte, die niemand genannt hat.",
  where: "Eine Liste von Filtern, je einer als spalte:operator:wert. Dieselbe Form wie der Parameter filter der Data API; erlaubt sind eq, neq, gt, gte, lt, lte und in.",
  after: "Der Cursor aus einer vorigen Antwort. Es gibt kein offset: Eine Seite über offset überspringt Zeilen, sobald sich darunter etwas ändert.",
};

/* ------------------------------------------------------------------ *
 * Die Gründe einer Ablehnung
 * ------------------------------------------------------------------ */

/** Jede Ablehnung im Klartext. Die Kennungen kommen vom Dienst. */
export const GRAPHQL_REJECTIONS: Record<string, string> = {
  query_too_large: "Die Abfrage ist grösser als erlaubt.",
  query_empty: "Es steht keine Abfrage da.",
  syntax_error: "Die Abfrage lässt sich nicht lesen.",
  unexpected_end: "Die Abfrage hört mitten in einem Ausdruck auf; eine Klammer fehlt.",
  multiple_operations: "Das Dokument enthält mehr als eine Operation. Hier läuft genau eine.",
  mutation_not_supported: "Mutationen gibt es hier nicht. Geschrieben wird über die Data API.",
  subscription_not_supported: "Subscriptions gibt es hier nicht. Laufende Änderungen laufen über Realtime.",
  fragment_not_supported: "Fragmente gibt es hier nicht, weder benannt noch inline.",
  variable_not_supported: "Variablen gibt es hier nicht. Schreiben Sie die Werte in die Abfrage.",
  directive_not_supported: "Direktiven gibt es hier nicht.",
  introspection_not_supported: "Die Introspektion gibt es hier nicht. Das Schema steht an der Leseroute daneben.",
  block_string_not_supported: "Block-Zeichenketten mit drei Anführungszeichen gibt es hier nicht.",
  enum_not_supported: "Enum-Werte gibt es hier nicht. Nennen Sie den Wert als Zeichenkette.",
  object_argument_not_supported: "Ein Objekt als Argumentwert gibt es hier nicht. Ein Filter ist eine Zeichenkette.",
  nested_list_not_supported: "Eine Liste in einer Liste gibt es hier nicht.",
  depth_exceeded: "Die Abfrage ist tiefer als die zwei Ebenen, die es gibt.",
  fields_exceeded: "Die Abfrage holt mehr Felder als erlaubt. Aliasse zählen einzeln mit.",
  tables_exceeded: "Die Abfrage nennt mehr Tabellen als erlaubt. Auch zwei Aliasse auf dieselbe Tabelle sind zwei Lesungen.",
  rows_exceeded: "Die Zeilen aller Felder zusammen überschreiten die Grenze der Abfrage.",
  empty_selection: "Eine Auswahl ohne Feld.",
  selection_required: "Ein Tabellenfeld braucht eine Auswahl von Spalten.",
  duplicate_response_key: "Zwei Felder mit demselben Namen in der Antwort. Eines würde das andere überschreiben.",
  duplicate_argument: "Dasselbe Argument steht zweimal.",
  unknown_argument: "Dieses Argument gibt es an einem Tabellenfeld nicht.",
  invalid_argument: "Der Wert dieses Arguments passt nicht.",
  arguments_exceeded: "Mehr Argumente an einem Feld als erlaubt.",
  column_arguments_not_supported: "Eine Spalte nimmt keine Argumente. Hinter einer Spalte steht SELECT und sonst nichts.",
  list_too_long: "Die Liste hat mehr Einträge als erlaubt.",
  filter_invalid: "Dieser Filter hat nicht die Form spalte:operator:wert mit einem erlaubten Operator.",
  filters_exceeded: "Mehr Filter an einem Feld als erlaubt.",
  unknown_table: "Diese Tabelle steht nicht im Schema dieser Fläche.",
  unknown_field: "Dieses Feld steht nicht im Schema dieser Fläche.",
};

/* ------------------------------------------------------------------ *
 * Was die Seite nicht kann
 * ------------------------------------------------------------------ */

/** Die Seite schreibt nicht. */
export const GRAPHQL_PAGE_READ_ONLY =
  "Diese Seite führt Abfragen aus und sonst nichts. Sie legt nichts an, sie ändert nichts, und sie kann auch nichts einschalten oder abschalten: Die Fläche hängt an derselben Freigabe wie die Data API.";

/** Wer die Seite gerade ist. */
export const GRAPHQL_CONSOLE_ROLE =
  "Was Sie hier sehen, sehen Sie als angemeldeter Mensch der Console, mit dem Anspruch authenticated und Ihrer Nutzer-ID als sub. Eine Anwendung mit Public Key sieht die Zeilen, die ihre Policy für anon freigibt, und das kann weniger oder mehr sein.";

/** Keine gespeicherten Abfragen. */
export const GRAPHQL_NO_HISTORY =
  "Abfragen werden nicht gespeichert. Es gibt keine Historie, keine gespeicherten Abfragen und keine Freigabe an andere; was Sie hier tippen, steht bis zum nächsten Laden der Seite in Ihrem Browser.";

/** Keine Kostenrechnung vor der Abfrage. */
export const GRAPHQL_NO_COST_ESTIMATE =
  "Es gibt keine Schätzung der Kosten vor dem Lauf. Die Grenzen begrenzen, was eine Abfrage höchstens holt; sie sagen nicht, wie lange die Datenbank dafür braucht. Dafür gibt es das Zeitlimit der Lese-Transaktion, und das gilt hier wie überall.";

/** Alle Texte dieses Moduls, fuer den Vertrag `console-i18n-contract`. */
export function integrationsGraphqlTexts(): string[] {
  return [
    GRAPHQL_WHAT,
    GRAPHQL_NO_MUTATIONS,
    GRAPHQL_SAME_PATH,
    GRAPHQL_SCHEMA_FROM_CATALOG,
    GRAPHQL_SCHEMA_OMISSIONS,
    GRAPHQL_SCHEMA_NOT_PER_CALLER,
    GRAPHQL_WHY_LIMITS,
    GRAPHQL_LIMIT_DEPTH,
    GRAPHQL_LIMIT_FIELDS,
    GRAPHQL_LIMIT_ROWS,
    GRAPHQL_SEQUENTIAL,
    GRAPHQL_NO_INTROSPECTION,
    GRAPHQL_OWN_PARSER,
    GRAPHQL_PAGE_READ_ONLY,
    GRAPHQL_CONSOLE_ROLE,
    GRAPHQL_NO_HISTORY,
    GRAPHQL_NO_COST_ESTIMATE,
    ...Object.values(GRAPHQL_ACCEPTED_TEXTS),
    ...Object.values(GRAPHQL_REFUSED_TEXTS),
    ...Object.values(GRAPHQL_ARGUMENT_TEXTS),
    ...Object.values(GRAPHQL_REJECTIONS),
  ];
}
