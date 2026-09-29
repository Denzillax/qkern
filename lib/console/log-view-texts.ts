/**
 * Die Texte der beiden Logseiten (2.51), deutsch und an einer Stelle:
 * Logs → Functions und Logs → Data API.
 *
 * Gleiche Bauart wie `usage-series-texts` (2.45) und `storage-log-texts`
 * (2.51): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn
 * ueber ihren Katalog, und der Vertrag `console-i18n-contract` liest diese
 * Tabellen mit und verlangt fuer jeden Text en, fr und it. Das eigene Modul
 * braucht es, weil beide Ansichten `t(variable)` aufrufen und ein Text
 * hinter einer Variablen durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der wichtigste Teil sind die Ehrlichkeitssaetze. Beide Platzhalter haben
 * mehr versprochen, als es gibt:
 *
 * - Logs → Functions versprach „Start, Ende und Fehler je Function-Aufruf,
 *   mit Dauer und Ausgangsverbindungen". Es gibt Start, Dauer, Ausgang und
 *   einen festen Fehlercode — eine Aufrufzeile aus Migration 0045. Es gibt
 *   **kein** Ende als eigene Zeit (nur Start plus Dauer), **keine**
 *   Ausgangsverbindungen und **keine** Ausgabe des Containers.
 * - Logs → Data API versprach „jede Anfrage mit Rolle, Tabelle und
 *   Antwortzeit". Eine solche Zeile schreibt niemand. Was es gibt, ist ein
 *   Zaehler je Anfrage in den Nutzungsereignissen (`api_requests`) — und der
 *   zaehlt alle Quellen zusammen, nicht nur die Data API.
 */

/** Der Ausgang eines Aufrufs, wie ihn Migration 0045 kennt. */
export const FUNCTION_LOG_OUTCOMES = {
  completed: { label: "erfolgreich", meaning: "Der Container ist gelaufen und hat mit einem HTTP-Status geantwortet." },
  failed: { label: "fehlgeschlagen", meaning: "Der Aufruf endete mit einem festen Fehlercode. Warum, steht nicht im Protokoll." },
} as const satisfies Record<string, { label: string; meaning: string }>;

export type FunctionLogOutcomeId = keyof typeof FUNCTION_LOG_OUTCOMES;

/**
 * Was eine Protokollzeile traegt — Spalte fuer Spalte, in der Reihenfolge
 * der Tabelle. Keine Spalte ohne Gegenstueck in Migration 0045.
 */
export const FUNCTION_LOG_COLUMNS = [
  { label: "Beginn", meaning: "Der Zeitpunkt, an dem der Aufruf angenommen wurde." },
  { label: "Function", meaning: "Der Name der aufgerufenen Function." },
  { label: "Ausgelöst von", meaning: "Der Projektschlüssel oder die Administratorin, die aufgerufen hat." },
  { label: "Dauer", meaning: "Millisekunden zwischen Beginn und Ende des Aufrufs." },
  { label: "Ausgang", meaning: "Erfolgreich oder fehlgeschlagen; nichts dazwischen." },
  { label: "Status", meaning: "Der HTTP-Status der Antwort oder der feste Fehlercode." },
] as const;

/** Der Satz, der ueber jeder Zeile des Function-Protokolls steht. */
export const FUNCTION_LOG_HONESTY =
  "Protokolliert wird der Aufruf, nicht sein Inhalt: Beginn, Dauer, Ausgang und entweder ein HTTP-Status oder ein fester Fehlercode. Die Nutzlast des Aufrufs steht nicht hier, und die Antwort des Containers auch nicht.";

/**
 * Der Satz zu dem, was der Platzhalter versprochen hat und was es nicht
 * gibt. Er steht ausdruecklich auf der Seite, nicht nur im Handbuch.
 */
export const FUNCTION_LOG_CONTAINER_OUTPUT =
  "Was die Function auf stdout oder stderr geschrieben hat, steht nicht in dieser Tabelle. Seit 2.67.0 hebt QKERN es je Aufruf in einer eigenen Tabelle auf, mit harten Grenzen, und zeigt es unter Functions → Function-Logs. Diese Seite bleibt das Protokoll des Aufrufs, nicht seines Inhalts.";

export const FUNCTION_LOG_NO_EGRESS =
  "Ausgangsverbindungen stehen nicht im Protokoll. Jede Verbindung einer Function wird gegen ihre Allowlist geprüft, aber die Prüfung hinterlässt keine Zeile; eine Liste der Ziele je Aufruf gibt es deshalb nicht. Ein eigenes Ende steht ebenfalls nicht da: Es ergibt sich aus Beginn plus Dauer.";

/**
 * Logs → Data API. Der ehrliche Teil ist der erste Satz: Es gibt kein
 * Anfrageprotokoll.
 */
export const DATA_API_LOG_TEXTS = {
  kicker: "LOGS",
  title: "Data API: was es statt eines Anfrageprotokolls gibt",
  /** Der Satz, der die Seite eroeffnet. Er sagt „noch nicht", nicht „bald". */
  noRequestLog:
    "Ein Protokoll je Anfrage gibt es nicht. QKERN schreibt für die generierte Data API keine Zeile mit Rolle, Tabelle, Status und Antwortzeit — weder in der Datenbank noch irgendwo sonst. Diese Seite zeigt darum, was wirklich da ist, und erfindet den Rest nicht.",
  /** Was es gibt: der Zaehler. Mit seiner Grenze im selben Satz. */
  counterTitle: "Der Zähler der API-Anfragen",
  /**
   * Ebenfalls in 2.84 berichtigt: „jede Anfrage an eine QKERN-Schnittstelle"
   * stand direkt ueber dem Satz, der die Reichweite einschraenkt, und hat ihm
   * widersprochen.
   */
  counterMeaning:
    "Anfragen an die generierte Data API, an Project Storage und an die Queues werden an ihrer HTTP-Grenze einmal gezählt und landen als Nutzungsereignis in der Messung. Daraus entsteht die Reihe unten, in Stundenschritten über die letzten 48 Stunden.",
  /**
   * Nachgezaehlt in 2.84 an den Aufrufstellen von `admitApiRequest`: Die Metrik
   * wird von genau drei Modulen erhoeht. Der Satz nannte vorher sechs weitere
   * und war damit in die falsche Richtung falsch, also zu beruhigend.
   */
  counterLimit:
    "Diese Zahl ist keine Zahl der Data-API-Anfragen: Gezählt wird unter derselben Metrik auch Project Storage und die Queues. Die Control Plane, Auth, Realtime, Compute und MCP zählen hier dagegen nicht mit, obwohl die Messung sie als Quelle kennt. Das Nutzungsereignis trägt seine Quelle zwar, die Reihe gruppiert aber nur nach Metrik. Nehmen Sie die Kurve als Obergrenze, nicht als Messwert der Data API.",
  /** Was es gibt: die Freigabe. */
  exposureTitle: "Was die Data API freigibt",
  exposureMeaning:
    "Freigegeben heisst: Der Pfad zu den Zeilen dieser Tabelle steht im erzeugten OpenAPI-Dokument. Die Console rechnet das nicht nach, sondern liest das Dokument, das der Server ausliefert — sie kann also nichts anzeigen, was der Server nicht freigibt.",
  /** Was ein echtes Anfrageprotokoll bräuchte. Konkret, nicht vage. */
  whatItWouldTake:
    "Ein echtes Anfrageprotokoll müsste an der HTTP-Grenze der generierten Data API entstehen, dort, wo heute nur gezählt wird: je Anfrage eine Zeile mit Rolle, Schema, Tabelle, Operation, Statuscode und Dauer, mit eigener Aufbewahrung und eigenem Leserecht. Diese Zeile gibt es nicht, und bevor sie es gibt, kann diese Seite kein Log zeigen.",
  /** Was auch dann nicht darin stünde. */
  neverInIt:
    "Auch ein solches Protokoll trüge nie den Filter, die Werte oder die gelesenen Zeilen einer Anfrage. Wer die Daten sehen will, braucht die Daten, nicht das Log.",
} as const;

/** Zustandstexte, die beide Ansichten ueber `t(variable)` zeigen. */
export const LOG_VIEW_STATES = {
  disabled: "Compute ist für diese Umgebung nicht eingeschaltet. Ohne Compute gibt es keine Aufrufe und damit kein Protokoll.",
  unavailable: "Das Protokoll ist gerade nicht erreichbar. Das ist kein Befund über Ihre Aufrufe, sondern über diese Abfrage.",
  empty: "Noch kein Aufruf protokolliert. Sobald eine Function läuft, steht ihr Aufruf hier — auch ein gescheiterter.",
  emptyFiltered: "Kein Aufruf passt zu diesem Filter. Ohne Filter kann trotzdem etwas dastehen.",
} as const;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function logViewTexts(): string[] {
  return [
    ...Object.values(FUNCTION_LOG_OUTCOMES).flatMap((entry) => [entry.label, entry.meaning]),
    ...FUNCTION_LOG_COLUMNS.flatMap((entry) => [entry.label, entry.meaning]),
    FUNCTION_LOG_HONESTY,
    FUNCTION_LOG_CONTAINER_OUTPUT,
    FUNCTION_LOG_NO_EGRESS,
    ...Object.values(DATA_API_LOG_TEXTS),
    ...Object.values(LOG_VIEW_STATES),
  ];
}
