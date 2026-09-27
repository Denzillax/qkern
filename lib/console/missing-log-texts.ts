/**
 * Die Texte der drei Logseiten aus 2.84, deutsch und an einer Stelle:
 * Functions -> Function-Logs, Logs -> API-Gateway und Logs -> Pooler.
 *
 * Gleiche Bauart wie `log-view-texts` (2.51): Der Schluessel ist der deutsche
 * Text, die Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden
 * Text en, fr und it. Das eigene Modul braucht es, weil die drei Ansichten
 * `t(variable)` aufrufen und ein Text hinter einer Variablen durch die Suche
 * nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Alle drei waren Platzhalter, und alle drei haben mehr versprochen, als es
 * gibt. Der Unterschied zu 2.51 ist, dass hier zweimal gar kein Backend fehlt,
 * sondern die Sache selbst: Es gibt keinen Rand, der protokolliert, und es gibt
 * keinen Pooler. Eine Seite, die auf ein fehlendes Backend wartet, waere in
 * beiden Faellen eine falsche Auskunft.
 *
 * Was jede Seite trotzdem zeigt, ist nachgeprueft und stammt aus einer Route,
 * die es schon gibt. Geschaetzt wird nichts.
 */

/* ------------------------------------------------------------------ *
 * Functions -> Function-Logs
 * ------------------------------------------------------------------ */

/**
 * Der Platzhalter versprach „Ausgaben aus dem Container". Der Grund, warum es
 * sie nicht gibt, steht seit Migration 0045 im Quelltext und wird hier
 * woertlich vertreten, nicht umschrieben.
 */
export const CONTAINER_LOG_TEXTS = {
  kicker: "FUNCTIONS",
  title: "Function-Logs: was der Container gesagt hat, ist weg",
  /** Der Satz, der die Seite eroeffnet. */
  noOutput:
    "Die Ausgabe des Containers gibt es nicht, und sie ist auch nicht bloss noch nicht gebaut. QKERN hebt stdout und stderr einer Function bewusst nicht auf. Migration 0045 schreibt den Grund selbst hin: Beides stammt aus fremdem Code und könnte alles enthalten, was die Function gesehen hat. Diese Seite zeigt darum, was wirklich da ist, und erfindet den Rest nicht.",
  /** Warum stdout nicht einmal im Prinzip ein Log sein kann. */
  stdoutIsProtocol:
    "stdout ist bei QKERN kein Ausgabekanal, sondern die Leitung: Host und Container sprechen darüber zeilenweise JSON, entweder eine Bitte um eine Ausgangsverbindung oder das Ergebnis des Aufrufs. Eine Zeile, die kein JSON ist, beendet den Aufruf mit einem festen Fehlercode. Eine Function kann auf stdout also gar nicht protokollieren, ohne ihren eigenen Aufruf abzubrechen.",
  /** Was mit stderr wirklich passiert. Gezaehlt, nicht gelesen. */
  stderrIsCounted:
    "stderr wird gelesen, aber nie behalten: Der Host zählt die Bytes und kappt den Kanal bei 8 KiB, damit ein geschwätziger Container nicht den Speicher des Hosts frisst. Die Bytes selbst werden nie zu einer Zeichenkette zusammengesetzt, nirgends gespeichert und an niemanden weitergegeben. Es gibt keinen Puffer, in dem sie noch stünden.",
  /** Und warum auch nachher nichts mehr da ist. */
  containerIsGone:
    "Nach dem Aufruf ist der Container weg. Er läuft mit --rm und wird danach zusätzlich mit docker rm --force entfernt. Ein späteres docker logs findet ihn nicht mehr, auch nicht auf dem Host, auf dem er lief.",
  /** Was es stattdessen gibt: die Einsatzhistorie. */
  deploymentsTitle: "Welches Image gelaufen ist",
  deploymentsMeaning:
    "Was der Container gesagt hat, ist weg. Welcher Container es war, steht fest: Jeder Einsatz einer Function hält seine Revision, das Image mit seinem sha256-Digest, wer eingesetzt hat und wann. Die Historie ist append-only, und eine Änderung des Images ohne ihre Zeile ist gar nicht ausdrückbar.",
  deploymentsLimit:
    "Diese Liste sagt, was lief, nicht wie es lief. Ein Digest verrät nichts über einen einzelnen Aufruf, und aus ihm lässt sich keine Ausgabe rekonstruieren. Gezeigt werden die jüngsten Revisionen; die laufende steht oben.",
  /** Der Verweis auf das Aufrufprotokoll. */
  invocationsTitle: "Das Aufrufprotokoll gibt es",
  invocationsMeaning:
    "Je Aufruf schreibt QKERN eine Zeile mit Beginn, Dauer, Ausgang und entweder einem HTTP-Status oder einem festen Fehlercode. Sie steht unter Logs → Functions. Das ist kein Ersatz für die Ausgabe des Containers, und diese Seite tut nicht so, als wäre es einer: Ein Fehlercode sagt, dass es schiefging, nicht warum.",
  /** Was ein Betreiber tun kann. Konkret. */
  operatorTitle: "Wenn Sie die Ausgabe wirklich brauchen",
  operatorSteps:
    "Während ein Aufruf läuft, existiert der Container unter einem Namen, der mit qkern-fn- beginnt; das Präfix gibt es genau dafür. Wer auf dem Host sitzt, kann ihn in dieser Zeit sehen. Dauerhaft hinausschreiben kann nur der Docker-Dämon selbst: Ein Log-Treiber, der vor dem Lauf eingerichtet ist, trägt die Zeilen weg, solange der Container lebt. QKERN richtet ihn nicht ein und liest ihn nicht mit.",
  operatorDrain:
    "Ein Log-Drain kann das Aufrufprotokoll nach draussen tragen, die Ausgabe des Containers nicht. Die Quelle heisst function_invocations und führt genau die Felder, die Logs → Functions zeigt; sie hält sogar die Referenz des Aufrufers zurück. Einzurichten unter Einstellungen → Log-Drains.",
  /** Was auch ein Ausbau nie zeigen wuerde. */
  neverInIt:
    "Auch ein Serverlog trüge nie die Nutzlast eines Aufrufs und nie den Wert eines Geheimnisses. Der Wert eines Geheimnisses erreicht den Prozess, der den Container startet, gar nicht; weitergegeben werden nur Referenzen.",
} as const;

/** Die Spalten der Einsatzhistorie, jede mit ihrem Gegenstueck im Backend. */
export const DEPLOYMENT_COLUMNS = [
  { label: "Revision", meaning: "Die laufende Nummer des Einsatzes; die höchste ist die geltende." },
  { label: "Image", meaning: "Das Image mit seinem sha256-Digest. Ein Tag allein wird nicht angenommen." },
  { label: "Eingesetzt von", meaning: "Die Administratorin, die den Einsatz ausgelöst hat." },
  { label: "Eingesetzt am", meaning: "Der Zeitpunkt, an dem dieses Image geltend wurde." },
] as const;

/* ------------------------------------------------------------------ *
 * Logs -> API-Gateway
 * ------------------------------------------------------------------ */

/**
 * Der Platzhalter versprach „jede Anfrage am Rand mit Status und Dauer". Hier
 * fehlt nicht das Log, sondern der Rand: Es gibt keine Stelle, die jede
 * Anfrage sieht.
 */
export const API_GATEWAY_LOG_TEXTS = {
  kicker: "LOGS",
  title: "API-Gateway: es gibt keinen Rand, der protokolliert",
  /** Der Satz, der die Seite eroeffnet. Er sagt nicht „noch nicht". */
  noEdge:
    "Ein API-Gateway hat QKERN nicht. Es gibt keine Middleware und keine andere Stelle, durch die jede Anfrage läuft; jeder Routenhandler steht für sich. Das Einzige, was für alle Pfade gilt, sind feste Sicherheits-Header aus der Next-Konfiguration, und die schreiben nichts mit. Eine Zeile je Anfrage mit Status und Dauer entsteht deshalb nirgends, und sie fehlt nicht bloss noch.",
  /** Was es gibt: der Zaehler, mit der ehrlichen Reichweite. */
  counterTitle: "Der Zähler der API-Anfragen",
  counterMeaning:
    "Drei Module zählen eine Anfrage, wenn sie ihren Scope bekommen haben: die generierte Data API, Project Storage und die Queues. Jede gezählte Anfrage wird ein Nutzungsereignis der Metrik api_requests mit der Menge eins. Daraus entsteht die Reihe unten, in Stundenschritten über die letzten 48 Stunden.",
  /** Die Grenze, nachgeprueft an den Aufrufstellen. */
  counterLimit:
    "Diese Zahl ist keine Zahl aller Anfragen. Gezählt wird nur in diesen drei Modulen; die Control Plane, Project Auth, Realtime, Compute und MCP zählen unter dieser Metrik nicht mit, obwohl die Messung sie als Quelle kennt. Die Reihe gruppiert ausserdem nur nach Metrik, nicht nach Quelle, und über HTTP gibt es keine Aufteilung je Quelle.",
  /** Warum der Zaehler nicht einmal die gezaehlten Module vollstaendig zaehlt. */
  counterBlindSpot:
    "Gezählt wird am Ende des Kontext-Resolvers, also erst, wenn die Anfrage einen Scope hat. Eine Anfrage, die schon an der Anmeldung scheitert, wird nie gezählt: Sie hat keinen Scope, den man belasten könnte, und einen fremden zu belasten wäre schlimmer. Abgewiesene Zugriffe stehen also in keiner dieser Zahlen.",
  /** Was „abgelehnt" hier heisst und was nicht. */
  rejectedMeaning:
    "Abgelehnt heisst hier ausschliesslich, dass eine Quota gegriffen hat; es gibt genau einen Ablehnungsgrund. Eine Anfrage, die mit 400, 404 oder 500 endete, gilt als angenommen und ist von einer erfolgreichen nicht zu unterscheiden. Statuscodes führt die Messung nicht.",
  /** Wo eine Zeile je Vorgang wirklich steht. */
  whereRowsExistTitle: "Wo es Zeilen je Vorgang wirklich gibt",
  whereRowsExistMeaning:
    "Eine Zeile mit Status und Dauer führt QKERN an genau einer Stelle, und das ist nicht der Rand: das Aufrufprotokoll der Functions unter Logs → Functions. Verwaltende Eingriffe stehen im Audit-Log unter Logs → Audit, mit Handlung, Akteursart und Ausgang, aber ohne Statuscode und ohne Dauer. Eine Anfrage an die Data API steht in keinem von beiden.",
  /** Was ein echtes Log braeuchte. */
  whatItWouldTake:
    "Ein echtes Anfrageprotokoll bräuchte zuerst einen Rand: eine Stelle, die jede Anfrage sieht, bevor sie in einen Handler geht, und nach ihr wieder. Dort entstünde je Anfrage eine Zeile mit Pfad, Verb, Statuscode und Dauer, mit eigener Aufbewahrung und eigenem Leserecht. Die Vorlage dafür steht schon: Migration 0045 führt genau diese Form für Function-Aufrufe.",
  /** Was ein Betreiber heute tun kann. */
  operatorTitle: "Wenn Sie die Zeilen heute brauchen",
  operatorSteps:
    "Ein Serverlog erzeugt nicht QKERN, sondern der Prozess davor. Wer Node hinter einem Reverse Proxy betreibt, bekommt dort ein Zugriffsprotokoll mit Pfad, Status und Dauer, und das ist heute der einzige Ort, an dem es eines gibt. QKERN liest es nicht mit und kann es nicht anzeigen.",
  operatorDrain:
    "Nach draussen tragen lässt sich, was es gibt: Ein Log-Drain kennt die Quelle usage_series für abgeschlossene Stunden dieses Zählers und auth_audit für das Auth-Protokoll. Eine Quelle für Anfragen am Rand hat er nicht, weil es sie nicht gibt. Einzurichten unter Einstellungen → Log-Drains.",
} as const;

/* ------------------------------------------------------------------ *
 * Logs -> Pooler
 * ------------------------------------------------------------------ */

/**
 * Der Platzhalter versprach „Warteschlange, abgewiesene Verbindungen,
 * Grenzen". Es gibt keinen Pooler zwischen Anwendung und Datenbank, also auch
 * keine Warteschlange, die jemand fuehren koennte.
 */
export const POOLER_LOG_TEXTS = {
  kicker: "LOGS",
  title: "Pooler: QKERN hat keinen",
  /** Der Satz, der die Seite eroeffnet. */
  noPooler:
    "Zwischen Anwendung und Datenbank steht bei QKERN nichts. Es gibt keinen PgBouncer, keinen Supavisor und keinen zweiten Port neben 5432. Jeder Prozess hält seinen eigenen Verbindungspool im eigenen Speicher und verbindet sich direkt. Ein Log des Verbindungspools kann es deshalb nicht geben: Es gibt keine gemeinsame Stelle, die eines schreiben könnte.",
  /** Der Pool der Anwendung: was es gibt und was davon nicht lesbar ist. */
  appPoolTitle: "Der Pool der Anwendung ist nicht lesbar",
  appPoolMeaning:
    "Es gibt ihn: Jeder Prozess baut einen Pool je Rechtegrenze, und die Grössen stehen in der Umgebung, mit DATABASE_POOL_MAX und der Vorgabe zehn. Nur erreicht diese Zahl keine Route, und die Auslastung schon gar nicht.",
  appPoolWhyNot:
    "Der Treiber kennt die Auslastung durchaus: offene, freie und wartende Verbindungen. QKERN legt den Pool aber hinter eine Schnittstelle, die genau drei Dinge kann, nämlich abfragen, verbinden und schliessen. Die Zähler des Treibers liegen dahinter und werden nirgends gelesen. Eine Warteschlange auf dieser Seite wäre also entweder geschätzt oder erfunden, und beides steht hier nicht.",
  appPoolNoQueueLog:
    "Auch mit diesen Zählern gäbe es kein Log: Niemand schreibt eine Zeile, wenn eine Anfrage auf einen Platz wartet. Läuft die Wartezeit ab, wird daraus ein Fehler auf dem Weg dieser einen Anfrage und sonst nichts. Eine Zahl abgewiesener Verbindungen über die Zeit führt QKERN nirgends.",
  /** Was es gibt: die Verbindungen, die der Server selbst sieht. */
  connectionsTitle: "Was die Datenbank über ihre Verbindungen sagt",
  connectionsMeaning:
    "Der Server weiss, wer verbunden ist. Gelesen wird pg_stat_activity, gefiltert auf diese Datenbank und gruppiert nach Rolle und Zustand: je Gruppe eine Anzahl und das Alter der ältesten Sitzung, nie eine Zeile je Sitzung. Dazu die offenen Verbindungen, die der Server selbst meldet, und die Grenze aus max_connections.",
  connectionsLimit:
    "Nach Rolle, nicht nach Prozess. Der Name der Anwendung und die Adresse des Clients werden ausdrücklich nicht gelesen, obwohl jeder Pool einen Anwendungsnamen setzt. Welcher Pool welche Verbindung hält, ist von hier aus deshalb nicht zu sehen. Und max_connections gilt für den ganzen Cluster, nicht für QKERN allein.",
  connectionsNoHistory:
    "Alle diese Zahlen sind ein Stand von jetzt, kein Verlauf. Wie viele Verbindungen vor einer Stunde offen waren, weiss niemand; eine Zeitreihe zu Verbindungen führt QKERN nicht.",
  /** Die Grenzen, die wirklich gelten. */
  limitsTitle: "Die Grenzen, die wirklich gelten",
  limitsMeaning:
    "Vier Grenzen entscheiden, wann eine Verbindung abgewiesen wird: max_connections für den Server, die für Superuser zurückgelegten Plätze, die Grenze dieser Datenbank und die Grenze der lesenden Rolle. Alle vier stehen auch unter Datenbank → Einstellungen, und sie sind Einstellungen, keine Ereignisse.",
  /** Was ein Betreiber tun kann. */
  operatorTitle: "Wenn Sie mehr brauchen",
  operatorSteps:
    "Wer ein Protokoll je Verbindung braucht, lässt es den Server schreiben: log_connections und log_disconnections erzeugen je Verbindung eine Zeile im Serverlog. Dieses Log liegt in Dateien neben dem Datenverzeichnis, QKERN hat darauf keinen Zugriff und zeigt es nicht. Wer stattdessen eine einzelne blockierende Sitzung sucht, findet die Vorlage aktuelle Sperren im SQL-Editor.",
  operatorDrain:
    "Ein Log-Drain hat keine Quelle für Verbindungen. Seine fünf Quellen sind das Auth-Protokoll, die Function-Aufrufe, die Speicherobjekte, die Webhook-Zustellungen und die Nutzungsreihe; ein Verbindungslog ist keine davon, weil es keines gibt.",
} as const;

/** Zustandstexte, die alle drei Ansichten ueber `t(variable)` zeigen. */
export const MISSING_LOG_STATES = {
  computeDisabled: "Compute ist für diese Umgebung nicht eingeschaltet. Ohne Compute gibt es keine Function und damit auch keinen Einsatz.",
  unavailable: "Diese Lesung ist gerade nicht erreichbar. Das ist kein Befund über Ihre Umgebung, sondern über diese Abfrage.",
  noFunctions: "In dieser Umgebung ist keine Function angelegt. Sobald eine eingesetzt wird, steht ihr Image hier.",
  noDeployments: "Für diese Function ist kein Einsatz verzeichnet. Ohne Einsatz gibt es kein Image, das gelaufen sein könnte.",
  databaseUnavailable: "Die Datenbank dieser Umgebung antwortet gerade nicht. Was sie über ihre Verbindungen sagt, steht deshalb hier nicht, und geschätzt wird es nicht.",
} as const;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function missingLogTexts(): string[] {
  return [
    ...Object.values(CONTAINER_LOG_TEXTS),
    ...DEPLOYMENT_COLUMNS.flatMap((entry) => [entry.label, entry.meaning]),
    ...Object.values(API_GATEWAY_LOG_TEXTS),
    ...Object.values(POOLER_LOG_TEXTS),
    ...Object.values(MISSING_LOG_STATES),
  ];
}
