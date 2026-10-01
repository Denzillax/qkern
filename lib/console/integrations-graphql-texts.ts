/**
 * Die Texte von Integrationen -> GraphQL (2.83, Mutationen seit 2.97), deutsch
 * und an einer Stelle.
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
 * lesend und schreibend, und die Texte hier sagen, welcher und was bewusst
 * fehlt.
 */

import type { ProjectGraphqlAccepted, ProjectGraphqlRefused } from "@/lib/server/data-plane/graphql";

/* ------------------------------------------------------------------ *
 * Was diese Fläche ist
 * ------------------------------------------------------------------ */

/** Was hier steht, in zwei Sätzen. */
export const GRAPHQL_WHAT =
  "Diese Fläche beantwortet GraphQL-Abfragen über den Tabellen Ihres Projektschemas und nimmt seit 2.97 auch Mutationen an. Jede Abfrage wird auf dieselben Lesungen abgebildet, die die Data API macht, und jede Mutation auf dieselben Schreibvorgänge.";

/** Die drei Mutationen und ihre Klammer. */
export const GRAPHQL_MUTATIONS =
  "Mutationen gibt es in drei Formen, benannt wie bei pg_graphql: insertInto<Tabelle>Collection, update<Tabelle>Collection und deleteFrom<Tabelle>Collection. Das Einfügen nimmt onConflict und wird damit zum Upsert. Alle Mutationen einer Anfrage laufen in einer Transaktion der Data API. Fällt eine, auch an einer Policy, wirkt keine. Ändern und Löschen verlangen eine Bedingung in where.";

/** Der Weg in die Datenbank. */
export const GRAPHQL_SAME_PATH =
  "Jede Abfrage und jede Mutation läuft unter der Zeilensicherheit des Aufrufers, über genau denselben Weg wie die Data API: dieselbe Projektrolle ohne BYPASSRLS, dieselbe Transaktion, lesend für Abfragen und schreibend für Mutationen, dieselben Ansprüche in request.jwt.claims. Es gibt hier keine zweite Stelle, an der Ansprüche gesetzt werden.";

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
  "Zwei Ebenen, und mehr gibt es nicht zu holen: die Tabelle und ihre Spalten. Es gibt an dieser Fläche keine Beziehungen zwischen Tabellen, also wäre eine dritte Ebene entweder leer oder ein Feld auf einem Wert. Eine Mutation hat eine Ebene mehr, weil records ihre Spalten trägt.";

/** Die Grenzen einer Mutation. */
export const GRAPHQL_LIMIT_MUTATIONS =
  "Je Anfrage gilt eine Zahl von Mutationen und je Mutation eine Zahl von Zeilen: beim Einfügen die Zeilen in objects, beim Ändern und Löschen die Zeilen, die die Bedingung trifft. Trifft sie mehr, wird die Mutation abgewiesen und die Transaktion zurückgerollt. atMost setzt eine engere Grenze.";

/** Die Beziehungen in records, und was sie kosten. */
export const GRAPHQL_LIMIT_EMBEDS =
  "Seit 2.111 darf records Beziehungen tragen, und zwar nur lesend. Jede ist eine weitere Lesung in derselben Transaktion: höchstens drei auf der ersten Ebene, eine in einer Beziehung, zwei Ebenen tief, und auf der zweiten Ebene nur ein Fremdschlüssel, der von der Nachbartabelle weg zeigt. Die andere Richtung wären zwanzig mal zwanzig Zeilen je Wurzelzeile. Die Nachbartabelle geht durch dieselbe Tür wie die Tabelle selbst und darf mit dem Argument schema in einem anderen Schema liegen. Ein Löschen trägt keine Beziehung, und geschrieben wird über eine nie.";

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
  mutations: "Mutationen: insertInto<Tabelle>Collection(objects: […]), update<Tabelle>Collection(set: {…}, where: […]) und deleteFrom<Tabelle>Collection(where: […]), mit affectedCount und records in der Antwort.",
  row_objects: "Flache Eingabeobjekte als Zeile oder Zuweisung in einer Mutation, nur mit Zahl, Zeichenkette, true, false und null.",
  upserts: "Ein Upsert: das Einfügen nimmt onConflict mit den Spalten eines vorhandenen Primärschlüssels oder eindeutigen Index. Trifft eine Zeile den Schlüssel, wird sie geändert, und die Policy entscheidet darüber wie bei einem Ändern.",
  mutation_relations: "Beziehungen in records, nur lesend: nach dem Einfügen, Ändern oder Upsert kommen die Nachbarzeilen der geschriebenen Zeilen mit, höchstens drei je Ebene und zwei Ebenen tief. Die zweite Ebene läuft nur über einen Fremdschlüssel, der von der Nachbartabelle weg zeigt. Gelesen wird in derselben Transaktion und unter denselben Ansprüchen wie eine Lesung, die Nachbartabelle braucht dieselbe Row Level Security, und mit dem Argument schema darf sie in einem anderen Schema liegen. Ein Löschen trägt keine Beziehung.",
};

/** Was er abweist, je Eintrag mit Grund. */
export const GRAPHQL_REFUSED_TEXTS: Record<ProjectGraphqlRefused, string> = {
  subscription: "Subscriptions. Laufende Änderungen laufen über Realtime, und das ist ein eigener Transport mit eigenen Rechten.",
  fragments: "Fragmente, benannt wie inline. Ohne sie gibt es auch keine Fragment-Rekursion zu begrenzen, und eine Begrenzung, die es nicht braucht, kann auch nicht danebenliegen.",
  variables: "Variablen und Variablendefinitionen. Werte stehen in der Abfrage; in SQL landen sie ohnehin als Parameter.",
  directives: "Direktiven wie @include und @skip. Sie ändern, welche Felder wirklich geholt werden, und eine Grenze, die vor der Auswertung zählt, zählte dann das Falsche.",
  introspection: "__schema, __type und __typename. Das Schema steht an der eigenen Route.",
  enum_values: "Enum-Werte. Es gibt an dieser Fläche keinen Enum-Typ, also gäbe es auch keinen, gegen den geprüft würde.",
  filter_objects: "Eingabeobjekte als Filter, also where: { … }. Ein Filter ist eine Zeichenkette in derselben Form wie der Parameter filter der Data API, in Abfragen wie in Mutationen.",
  block_strings: "Block-Zeichenketten mit drei Anführungszeichen.",
  multiple_operations: "Mehrere Operationen in einem Dokument. Ohne Operationsnamen in der Anfrage wäre nicht entscheidbar, welche gemeint ist.",
  query_relations: "Beziehungen in einer Abfrage. Ein Tabellenfeld liefert Spalten und sonst nichts. Eingebettete Beziehungen stehen lesend an der Data API, und in einer Mutation an records; eine Abfrage hier kennt sie nicht.",
  nested_writes: "Schreiben über eine Beziehung, also ein Eingabeobjekt in einem Eingabeobjekt. Eine Mutation schreibt genau eine Tabelle. Ein verschachteltes Anlegen müsste die Reihenfolge und das Zurücknehmen über mehrere Tabellen zusagen; die Fläche sagt das nicht zu und weist es mit eigenem Grund ab.",
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

/** Was ein Argument einer Mutation tut (2.97). */
export const GRAPHQL_MUTATION_ARGUMENT_TEXTS: Record<string, string> = {
  objects: "Die Zeilen, die eingefügt werden, als Liste flacher Objekte. Jede Zeile nennt dieselben Spalten.",
  set: "Die Zuweisung beim Ändern, ein flaches Objekt. Spalten des Primärschlüssels stehen nicht darin.",
  where: "Die Bedingung beim Ändern und Löschen, Pflicht, in derselben Form wie bei einer Abfrage.",
  atMost: "Wie viele Zeilen die Bedingung höchstens treffen darf. Trifft sie mehr, wird die Mutation abgewiesen und die Transaktion zurückgerollt.",
  onConflict: "Die Spalten des Konfliktschlüssels eines Upsert. Sie müssen im Katalog einen Primärschlüssel oder eindeutigen Index bilden und in jeder Zeile stehen; sonst wird die Mutation abgewiesen, bevor eine Zeile geschrieben ist.",
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
  subscription_not_supported: "Subscriptions gibt es hier nicht. Laufende Änderungen laufen über Realtime.",
  fragment_not_supported: "Fragmente gibt es hier nicht, weder benannt noch inline.",
  variable_not_supported: "Variablen gibt es hier nicht. Schreiben Sie die Werte in die Abfrage.",
  directive_not_supported: "Direktiven gibt es hier nicht.",
  introspection_not_supported: "Die Introspektion gibt es hier nicht. Das Schema steht an der Leseroute daneben.",
  block_string_not_supported: "Block-Zeichenketten mit drei Anführungszeichen gibt es hier nicht.",
  enum_not_supported: "Enum-Werte gibt es hier nicht. Nennen Sie den Wert als Zeichenkette.",
  object_argument_not_supported: "Ein Objekt als Argumentwert gibt es hier nicht. Ein Filter ist eine Zeichenkette.",
  nested_list_not_supported: "Eine Liste in einer Liste gibt es hier nicht.",
  nested_object_not_supported: "Eine Liste in einem Objekt gibt es hier nicht. Eine Zeile ist flach.",
  nested_write_not_supported: "Ein Objekt in einem Objekt wäre ein Schreiben über eine Beziehung. Eine Mutation schreibt genau eine Tabelle; Beziehungen stehen in records und nur lesend.",
  object_fields_exceeded: "Das Eingabeobjekt hat mehr Felder als eine Zeile haben kann.",
  depth_exceeded: "Die Abfrage ist tiefer als die Ebenen, die es gibt: zwei in einer Abfrage, und in einer Mutation die Hülle records und zwei Ebenen Beziehungen darin. Zwanzig Zeilen je Elternzeile auf einer dritten Ebene wären achttausend Zeilen je Wurzelzeile.",
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
  unknown_mutation: "Diese Mutation gibt es nicht. Eine Tabelle hat sie nur, wenn sie im Schema steht und die Projektrolle das Recht dazu hat.",
  mutations_exceeded: "Die Anfrage enthält mehr Mutationen als erlaubt.",
  mutation_rows_exceeded: "Die Mutation nennt oder trifft mehr Zeilen als erlaubt.",
  filter_required: "Ändern und Löschen brauchen eine Bedingung in where. Ohne sie träfe die Mutation jede Zeile, die die Policy hergibt.",
  argument_required: "Ein Pflichtargument fehlt: objects beim Einfügen, set beim Ändern.",
  embeds_exceeded: "Mehr Beziehungen an dieser Stelle als erlaubt. Jede ist eine weitere Lesung, und die zweite Ebene hat ihre eigene, kleinere Zahl.",
};

/* ------------------------------------------------------------------ *
 * Was die Seite nicht kann
 * ------------------------------------------------------------------ */

/** Die Seite führt aus, was da steht, auch eine Mutation. */
export const GRAPHQL_PAGE_WRITES =
  "Diese Seite führt aus, was Sie hier eingeben, auch eine Mutation. Sie schreibt dann als angemeldeter Mensch der Console mit dem Anspruch authenticated, unter der Policy Ihrer Tabelle und in einer Transaktion. Ein- oder ausschalten kann die Seite die Fläche nicht; sie hängt an derselben Freigabe wie die Data API.";

/** Wer die Seite gerade ist. */
export const GRAPHQL_CONSOLE_ROLE =
  "Was Sie hier sehen, sehen Sie als angemeldeter Mensch der Console, mit dem Anspruch authenticated und Ihrer Nutzer-ID als sub. Eine Anwendung mit Public Key sieht die Zeilen, die ihre Policy für anon freigibt, und das kann weniger oder mehr sein.";

/** Keine gespeicherten Abfragen. */
export const GRAPHQL_NO_HISTORY =
  "Abfragen werden nicht gespeichert. Es gibt keine Historie, keine gespeicherten Abfragen und keine Freigabe an andere; was Sie hier tippen, steht bis zum nächsten Laden der Seite in Ihrem Browser.";

/** Keine Kostenrechnung vor der Abfrage. */
export const GRAPHQL_NO_COST_ESTIMATE =
  "Es gibt keine Schätzung der Kosten vor dem Lauf. Die Grenzen begrenzen, was eine Abfrage höchstens holt; sie sagen nicht, wie lange die Datenbank dafür braucht. Dafür gibt es das Zeitlimit der Transaktion, und das gilt hier wie überall.";

/** Alle Texte dieses Moduls, fuer den Vertrag `console-i18n-contract`. */
export function integrationsGraphqlTexts(): string[] {
  return [
    GRAPHQL_WHAT,
    GRAPHQL_MUTATIONS,
    GRAPHQL_SAME_PATH,
    GRAPHQL_SCHEMA_FROM_CATALOG,
    GRAPHQL_SCHEMA_OMISSIONS,
    GRAPHQL_SCHEMA_NOT_PER_CALLER,
    GRAPHQL_WHY_LIMITS,
    GRAPHQL_LIMIT_DEPTH,
    GRAPHQL_LIMIT_FIELDS,
    GRAPHQL_LIMIT_ROWS,
    GRAPHQL_LIMIT_MUTATIONS,
    GRAPHQL_LIMIT_EMBEDS,
    GRAPHQL_SEQUENTIAL,
    GRAPHQL_NO_INTROSPECTION,
    GRAPHQL_OWN_PARSER,
    GRAPHQL_PAGE_WRITES,
    GRAPHQL_CONSOLE_ROLE,
    GRAPHQL_NO_HISTORY,
    GRAPHQL_NO_COST_ESTIMATE,
    ...Object.values(GRAPHQL_ACCEPTED_TEXTS),
    ...Object.values(GRAPHQL_REFUSED_TEXTS),
    ...Object.values(GRAPHQL_ARGUMENT_TEXTS),
    ...Object.values(GRAPHQL_MUTATION_ARGUMENT_TEXTS),
    ...Object.values(GRAPHQL_REJECTIONS),
  ];
}
