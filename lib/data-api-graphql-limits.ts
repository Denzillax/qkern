import { DATA_API_LIMITS } from "@/lib/data-api-limits";

/**
 * Die Grenzen der lesenden GraphQL-Fläche (2.83) an einer Stelle.
 *
 * Gleiche Bauart wie `lib/data-api-limits.ts`: Der Server prüft mit genau
 * diesen Werten, die Console zeigt sie an, und es gibt keine zweite Tabelle.
 * Keine Server-Importe, damit die Datei auch im Browser läuft.
 *
 * Warum überhaupt harte Grenzen: GraphQL lässt den Aufrufer die Form der
 * Antwort bestimmen. Ohne Tiefenbegrenzung und ohne Feldzahl ist eine einzige
 * Anfrage genug, um die Datenbank beliebig lange zu beschäftigen, und der
 * Aufrufer merkt davon nichts. Die Grenzen stehen deshalb vor der Datenbank
 * und nicht in einem Zeitlimit hinter ihr.
 */
export const DATA_API_GRAPHQL_LIMITS = {
  /**
   * Die Abfrage selbst. 8 KiB sind mehr als jede Abfrage braucht, die diese
   * Fläche bedienen kann, und wenig genug, dass der Parser keine Arbeit an
   * einem Text tut, der ohnehin abgewiesen wird.
   */
  maxQueryBytes: 8_192,
  /**
   * Zwei Ebenen, und mehr gibt es nicht zu holen: die Tabelle und ihre
   * Spalten. Es gibt keine Beziehungen an dieser Fläche, also wäre eine dritte
   * Ebene entweder leer oder ein Feld auf einem Skalar.
   */
  maxDepth: 2,
  /**
   * Alle Felder der Abfrage zusammen, **jedes Vorkommen einzeln**. Ein Alias
   * zählt mit: sonst wäre `a: id b: id c: id …` ein Weg, die Grenze zu
   * umgehen, ohne sie zu verletzen.
   */
  maxFields: 60,
  /**
   * Die Felder der obersten Ebene, also die Zahl der Lesungen. Auch hier zählt
   * jedes Vorkommen: Zwei Aliasse auf dieselbe Tabelle sind zwei Abfragen an
   * die Datenbank und nicht eine.
   */
  maxTables: 5,
  /** Zeilen je Feld, dieselbe Obergrenze wie die Data API sie kennt. */
  maxRowsPerField: DATA_API_LIMITS.rowsMax,
  /** Zeilen der ganzen Abfrage, über alle Felder der obersten Ebene summiert. */
  maxRowsPerQuery: 200,
  /** Vorgabe je Feld, wenn die Abfrage kein `limit` nennt; wie bei der Data API. */
  defaultRowsPerField: 20,
  /** Argumente je Feld. Es gibt fünf; die Grenze ist die Form, nicht die Zahl. */
  maxArgumentsPerField: 8,
  /** Filter je Feld, dieselbe Zahl wie bei der Data API. */
  maxFiltersPerField: DATA_API_LIMITS.maxFilters,
  /** Einträge in einer Liste als Argumentwert, etwa hinter `in`. */
  maxListEntries: 20,
  /** Die Argumente, die ein Feld der obersten Ebene kennt. */
  arguments: ["limit", "orderBy", "direction", "where", "after"] as const,
  /**
   * Mutationen je Anfrage (2.97), aus derselben Tabelle wie die REST-Grenze.
   * Alle Mutationen einer Anfrage laufen in einer Transaktion.
   */
  maxMutationsPerRequest: DATA_API_LIMITS.mutationsMax,
  /** Zeilen je Mutation: eingefuegte Zeilen wie getroffene Zeilen beim Aendern und Loeschen. */
  maxRowsPerMutation: DATA_API_LIMITS.mutationRowsMax,
  /**
   * Felder in einem Eingabeobjekt, also Spalten je Zeile. Dieselbe Zahl, die
   * die Data API je Tabelle hoechstens kennt; ein Objekt darueber ist keine
   * Zeile einer bedienbaren Tabelle.
   */
  maxObjectFields: 100,
  /**
   * Die Argumente einer Mutation: `objects` beim Einfuegen, `onConflict` beim
   * Upsert (2.105), `set` beim Aendern, `where` und `atMost` bei beiden
   * Bedingungen.
   */
  mutationArguments: ["objects", "onConflict", "set", "where", "atMost"] as const,
} as const;

export type DataApiGraphqlArgument = (typeof DATA_API_GRAPHQL_LIMITS.arguments)[number];
