/**
 * Grenzen der generierten Data API an einer Stelle.
 *
 * Der Server (`lib/server/data-plane/generated-api.ts`) prueft mit genau
 * diesen Werten, die Console (`components/console/data-api-settings-view.tsx`)
 * zeigt sie an. Keine Server-Importe, damit die Datei auch im Browser laeuft.
 *
 * `schema` ist das Standardschema: Die Routen setzen `public`, wenn die
 * Anfrage keines nennt, und die Console zeigt nur dieses.
 */
export const DATA_API_LIMITS = {
  schema: "public",
  rowsMin: 1,
  rowsMax: 100,
  maxFilters: 10,
  operators: ["eq", "neq", "gt", "gte", "lt", "lte", "in"] as const,
  /**
   * Eingebettete Beziehungen je Anfrage (2.66): `select=id,autor:autoren(name)`
   * holt ueber einen Fremdschluessel die Zeilen der Nachbartabelle mit. Jede
   * Einbettung ist eine weitere Abfrage unter der RLS des Aufrufers; drei sind
   * genug fuer eine Liste mit ihren Nachbarn und wenig genug, dass eine
   * Anfrage die Datenbank nicht vervielfacht beschaeftigt.
   *
   * Die Zahl gilt je Ebene: drei auf der ersten, und auf der zweiten
   * `maxNestedEmbeds` je Einbettung der ersten.
   *
   * Seit 2.112 darf die Nachbartabelle in einem anderen Schema liegen
   * (`select=titel,autor:verlag.autoren(name)`). Sie geht dann durch dieselbe
   * Pruefung wie eine Basistabelle: Zeilensicherheit, nicht im Besitz der
   * Aufruferrolle, Leserecht. Ein Schemawechsel ist kein Weg an einer Policy
   * vorbei, weil die Policy an der Tabelle haengt und nicht am Schema.
   */
  maxEmbeds: 3,
  /**
   * Zeilen je Einbettung und Elternzeile, wenn der Fremdschluessel von der
   * Nachbartabelle her zeigt (eins zu viele). Mehr werden beschnitten, und die
   * Antwort nennt es als `truncated` an der Einbettung. Eine Einbettung von
   * der anderen Seite (viele zu eins) liefert genau eine Zeile oder `null`.
   */
  maxEmbedRows: 20,
  /**
   * Ebenen einer Einbettung (2.111): `beitraege(autor(name))` ist zwei.
   *
   * Die zweite Ebene hat ihre eigene Grenze, und diese Grenze ist eine
   * Richtung: Auf der zweiten Ebene gibt es nur `one`, also den
   * Fremdschluessel, der von der Nachbartabelle weg zeigt. Die Rechnung
   * dahinter, mit den Zahlen dieser Tabelle:
   *
   * - Erste Ebene, `many`: `rowsMax` Wurzelzeilen mal `maxEmbedRows` sind
   *   100 mal 20, also 2000 Zeilen je Einbettung, und bei `maxEmbeds`
   *   Einbettungen 6000.
   * - Zweite Ebene als `many` waere `maxEmbedRows` je dieser Zeilen: 20 mal 20
   *   sind 400 Zeilen je Wurzelzeile und Kette, bei 100 Wurzelzeilen 40000,
   *   und ueber drei Ketten 120000. Das ist das Zwanzigfache dessen, was eine
   *   Anfrage heute hoechstens liest, aus einer Anfrage, die acht Worte lang
   *   ist.
   * - Zweite Ebene als `one` liefert je Zeile der ersten Ebene hoechstens eine
   *   Zeile, und die Abfrage fragt jeden Schluesselwert nur einmal: hoechstens
   *   2000 Zeilen je Kette, ueber drei Ketten 6000. Zusammen mit der ersten
   *   Ebene sind das 12100 Zeilen und sieben Abfragen je Anfrage, gegen 6100
   *   Zeilen und vier Abfragen vorher.
   *
   * Darum: zwei Ebenen ja, die zweite nur `one`. Eine zweite Ebene in der
   * Richtung `many` wird abgewiesen, und zwar wegen dieser Zahlen und nicht,
   * weil sie schwer zu bauen waere.
   */
  maxEmbedDepth: 2,
  /**
   * Einbettungen in einer Einbettung (2.111). Eine, nicht drei: `maxEmbeds` auf
   * der ersten Ebene mal drei auf der zweiten waeren neun Abfragen fuer die
   * zweite Ebene allein, und jede davon ueber bis zu 2000 Elternzeilen.
   */
  maxNestedEmbeds: 1,
  /**
   * Zeilen je Mutation (2.97). Beim Einfuegen die Zeilen in `objects`, beim
   * Aendern und Loeschen die Zeilen, die die Bedingung trifft: Trifft sie
   * mehr, wird die Mutation abgewiesen und die ganze Transaktion
   * zurueckgerollt. Dieselbe Zahl gilt fuer ein Einfuegen ueber REST.
   */
  mutationRowsMax: 25,
  /**
   * Mutationen je GraphQL-Anfrage (2.97). Alle laufen in einer Transaktion:
   * Faellt eine, wirkt keine. Fuenf reichen fuer ein Formular mit seinen
   * Nebenzeilen und sind wenig genug, dass eine Anfrage keine Massenaenderung
   * an der Grenze vorbei traegt.
   */
  mutationsMax: 5,
  keyClaims: { public: "anon", service: "service_role" } as const,
} as const;

export type DataApiFilterOperator = (typeof DATA_API_LIMITS.operators)[number];
export type DataApiKeyClaim = (typeof DATA_API_LIMITS.keyClaims)[keyof typeof DATA_API_LIMITS.keyClaims];

/** Quelle des Musters fuer sensible Spaltennamen; der Server baut daraus `new RegExp(..., "i")`. */
export const SENSITIVE_COLUMN_PATTERN = "(?:password|secret|token|cookie|private.?key|authorization|api.?key)";

/** Die Woerter hinter dem Muster, lesbar fuer die Console. Ein Test prueft, dass jedes Wort trifft. */
export const SENSITIVE_COLUMN_WORDS = ["password", "secret", "token", "cookie", "private key", "authorization", "api key"] as const;
