/**
 * Die Texte und das Urteil zum Serverlog von PostgreSQL (2.109), deutsch und
 * an einer Stelle.
 *
 * Gleiche Bauart wie `vector-buckets-texts` (2.93) und
 * `database-health-texts` (2.70): Der Schluessel ist der deutsche Text, die
 * Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden
 * Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Das Urteil kommt aus einer Ableitung, und ein Text
 * hinter einer Variablen faellt durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * WARUM ES DIESES MODUL GIBT
 *
 * Bis 2.108 sagte die Seite Logs, Postgres-Zustand einen Satz, der so nicht
 * stimmt: das Serverlog liege in Dateien neben dem Datenverzeichnis, und
 * QKERN habe darauf keinen Zugriff. Der zweite Teil ist wahr. Der erste ist
 * eine Annahme, und in jedem Stack, den QKERN faehrt, ist sie falsch. Der
 * Server laeuft mit `logging_collector = off`, und dann gibt es die Datei
 * gar nicht; das Log geht auf stderr des Containers und nirgendwo sonst.
 *
 * Darum steht hier ein Urteil statt eines festen Satzes. Die Seite fragt den
 * Server bei jedem Oeffnen, was er mit seinem Log tut, und waehlt den Eintrag
 * aus dem Katalog, der dazu passt. Auf einem Server mit Sammler und
 * `csvlog` stuende ein anderer Satz da als auf dem Server dieses Stacks, und
 * beide waeren wahr.
 */

/**
 * Die nachpruefbaren Namen an einer Stelle. Der Fall (2.109) prueft genau
 * diese Werte am echten Server, darum stehen sie hier und nicht als Literal
 * in der Ansicht.
 */
export const SERVER_LOG_FACTS = {
  /** Der Schalter, der ueberhaupt erst eine Datei entstehen laesst. */
  collectorSetting: "logging_collector",
  /** Wohin der Server schreibt. Eine Liste, nicht ein Wert. */
  destinationSetting: "log_destination",
  /** Die Ziele, die eine Datei schreiben, die eine Maschine lesen kann. */
  structuredDestinations: ["csvlog", "jsonlog"] as readonly string[],
  /** Das Recht, das eine Rolle braucht, um eine Datei des Servers zu lesen. */
  fileRole: "pg_read_server_files",
  /** Das Recht, das eine Rolle braucht, um zu erfahren, wo die Datei liegt. */
  settingsRole: "pg_read_all_settings",
  /**
   * Die Erweiterung, die man hier zuerst vermutet. Sie brachte
   * `pg_file_read` und `pg_file_write` mit und verlangte trotzdem Superuser.
   * PostgreSQL 17 hat sie aus dem Baum entfernt, und dieser Stack faehrt 17.
   */
  removedExtension: "adminpack",
  /** Die Hauptversion, mit der es die Erweiterung nicht mehr gibt. */
  removedInMajor: 17,
} as const;

/**
 * Was dieser Server mit seinem Log tut, so weit die Laufzeitrolle es sehen
 * darf.
 *
 * `logging_collector` und `log_destination` darf jede Rolle lesen.
 * `log_directory`, `log_filename` und `data_directory` darf sie nicht: dafuer
 * braucht es `pg_read_all_settings`, und die Grenze in `pool.ts` verbietet
 * jeder Anmeldung die Mitgliedschaft darin. Die Seite weiss darum, ob es eine
 * Datei gibt, und nie, wie sie heisst.
 */
export type ServerLogObservation = {
  /** `logging_collector`. Ohne ihn entsteht keine Datei. */
  collector: boolean;
  /** `log_destination` im Wortlaut, etwa `stderr` oder `stderr,csvlog`. */
  destination: string;
  /** Ob die Rolle Mitglied von `pg_read_server_files` ist. In QKERN nie. */
  mayReadFiles: boolean;
  /** Ob die Rolle Mitglied von `pg_read_all_settings` ist. In QKERN nie. */
  maySeeLogPath: boolean;
};

export type ServerLogVerdictId =
  /** Kein Sammler, also keine Datei. Das Log ist stderr des Prozesses. */
  | "no_file"
  /** Eine Datei, aber freier Text. Keine Zeile, die eine Maschine sicher trennt. */
  | "free_text_out_of_reach"
  /** Eine Datei in Spalten, und die Rolle kommt nicht an sie heran. */
  | "structured_out_of_reach"
  /** Eine Datei in Spalten, und die Rolle darf Dateien des Servers lesen. */
  | "reachable";

export type VerdictText = {
  label: string;
  explains: string;
  /** Dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium";
};

/**
 * Der Katalog der Urteile. Die Ansicht zeigt `label` und `explains` und
 * formuliert keinen Satz selbst.
 *
 * Drei der vier Urteile sind in einem eigenen Stack erreichbar, jedes ueber
 * die Einstellungen des Servers. Das vierte verlangt ein Recht, und dieses
 * Recht gibt QKERN keiner Rolle.
 */
export const SERVER_LOG_VERDICTS: Record<ServerLogVerdictId, VerdictText> = {
  no_file: {
    label: "kein Serverlog als Datei",
    explains:
      "Dieser Server läuft ohne Sammler. Es gibt keine Logdatei neben dem Datenverzeichnis, und es gibt auch keine woanders. Der Server schreibt seine Meldungen auf stderr seines Prozesses, und dort holt sie ab, wer den Prozess gestartet hat. An stderr kommt eine Abfrage nicht heran, mit keinem Recht und mit keiner Erweiterung.",
    tone: "muted",
  },
  free_text_out_of_reach: {
    label: "Serverlog als freier Text, nicht erreichbar",
    explains:
      "Dieser Server sammelt sein Log in eine Datei und schreibt sie als freien Text. Eine Meldung darin kann über mehrere Zeilen gehen, und wo eine endet, sagt kein Trennzeichen zuverlässig. Erreichbar ist die Datei für diese Rolle ohnehin nicht: Lesen dürfte sie nur, wer Mitglied von pg_read_server_files ist.",
    tone: "muted",
  },
  structured_out_of_reach: {
    label: "Serverlog in Spalten, nicht erreichbar",
    explains:
      "Dieser Server schreibt sein Log in eine Datei mit Spalten, und eine solche Datei liesse sich als Tabelle lesen. Diese Rolle kommt nicht an sie heran. Sie darf keine Datei des Servers lesen und erfährt nicht einmal, wie die Datei heisst; beides hängt an Rechten, die QKERN keiner Anmeldung gibt.",
    tone: "muted",
  },
  reachable: {
    label: "Serverlog erreichbar",
    explains:
      "Dieser Server schreibt sein Log in Spalten, und diese Rolle darf Dateien des Servers lesen. Damit liesse sich das Log als Tabelle lesen. In QKERN kommt dieses Urteil nicht vor: Die Rollengrenze weist jede Anmeldung ab, die Mitglied von pg_read_server_files ist, und sie prüft das bei jeder Verbindung neu.",
    tone: "risk medium",
  },
};

/**
 * Das Urteil, aus dem, was der Server sagt.
 *
 * Die Reihenfolge der Fragen ist nicht beliebig. Ob eine Rolle eine Datei
 * lesen darf, ist erst interessant, wenn es eine Datei gibt. Ein Server ohne
 * Sammler faellt darum auf `no_file`, auch wenn die Rolle jedes Recht haette.
 */
export function serverLogVerdict(observation: ServerLogObservation): ServerLogVerdictId {
  if (!observation.collector) return "no_file";
  const targets = observation.destination.split(",").map((value) => value.trim().toLowerCase());
  const structured = SERVER_LOG_FACTS.structuredDestinations.some((target) => targets.includes(target));
  if (!structured) return "free_text_out_of_reach";
  return observation.mayReadFiles ? "reachable" : "structured_out_of_reach";
}

export type ServerLogNote = {
  title: string;
  body: string;
};

/**
 * Was in einem Serverlog stuende, und was QKERN davon hat.
 *
 * Kein Eintrag beschreibt eine Oberflaeche, die es nicht gibt. Jeder nennt
 * eine Zeile, die ein Serverlog traegt, und sagt daneben, was QKERN an ihrer
 * Stelle zeigt und wo die Auskunft aufhoert.
 */
export const SERVER_LOG_CONTENT: readonly ServerLogNote[] = [
  {
    title: "Jede Verbindung mit Rolle, Adresse und Zeitpunkt",
    body: "Mit log_connections und log_disconnections schreibt der Server eine Zeile, sobald sich jemand anmeldet, und eine, wenn er geht. QKERN zählt stattdessen: pg_stat_database führt eröffnete, verlorene, fatal beendete und abgeschossene Sitzungen als Summe, und Berichte → Verbindungen gruppiert die offenen nach Rolle und Zustand. Wer sich um 03:12 von welcher Adresse angemeldet hat, steht nirgends.",
  },
  {
    title: "Der Wortlaut jeder Fehlermeldung",
    body: "Ein Serverlog trägt die Meldung, den Detailtext, den Hinweis und den SQLSTATE. QKERN hat davon keinen Buchstaben. Die Statistiksichten zählen, dass eine Transaktion zurückgerollt wurde oder eine Sitzung fatal endete, und woran es lag, führt keine Sicht mit.",
  },
  {
    title: "Fehlgeschlagene Anmeldungen an der Datenbank",
    body: "Ein falsches Passwort und eine abgewiesene Regel aus pg_hba.conf landen im Serverlog und in keiner Statistiksicht. Für die Data API hat QKERN ein Auth-Protokoll in der Kontrollebene; für die Datenbank selbst gibt es nichts Vergleichbares. Wer die Anmeldungen an der Datenbank sehen will, braucht den Prozess, der den Server gestartet hat.",
  },
  {
    title: "Langsame Statements mit ihrem Text",
    body: "log_min_duration_statement schreibt jede Abfrage, die eine Grenze reisst, mit ihrem Text und ihrer Dauer. QKERN hat dafür pg_stat_statements, und dort steht seit 2.56 ausdrücklich kein Abfragetext, nur Kennung und Zähler. Eine Grenze, ab der QKERN eine Abfrage protokolliert, gibt es nicht.",
  },
  {
    title: "Autovacuum und Checkpoints als einzelnes Ereignis",
    body: "log_autovacuum_min_duration und log_checkpoints schreiben je Vorgang eine Zeile mit Dauer und Menge. QKERN zeigt die Summen: Checkpoints nach Zeitplan und auf Anforderung, die Zeit in der Schreibphase und in der Synchronisationsphase, und beides für den ganzen Server. Wann ein einzelner Checkpoint lief und wie lange er brauchte, sagt kein Zähler.",
  },
  {
    title: "Der Start und das Ende des Servers",
    body: "Dass der Server hochgefahren ist, dass er eine Wiederherstellung gefahren hat, dass er heruntergefahren wurde: alles das schreibt der Postmaster ins Log, bevor es eine Datenbank gibt, an der eine Abfrage hängen könnte. Diese Zeilen tragen keinen Datenbanknamen. Auch bei einem erreichbaren Log wären sie darum keiner Projektdatenbank zuzuordnen.",
  },
];

/**
 * Was es braeuchte, in Abhaengigkeitsreihenfolge.
 *
 * Der erste Schritt ist nicht der naechstliegende. Naeher liegt, die Datei
 * zu lesen, und genau das ist der Weg, der ein Recht verlangt. Der Weg, den
 * ein gehosteter Anbieter geht, fuehrt nicht durch die Datenbank.
 */
export const SERVER_LOG_NEXT_STEPS: readonly ServerLogNote[] = [
  {
    title: "1. Ein Sammler neben dem Server statt einer Abfrage in ihm",
    body: "Supabase liest das Serverlog nicht aus der Datenbank. Ein Sammler läuft neben den Containern, liest ihr stdout und stderr über den Docker-Socket und schickt die Zeilen an einen Dienst, der sie in Tabellen legt. Dieser Weg kommt ohne jedes Datenbankrecht aus, und er funktioniert auch bei einem gehosteten Anbieter, weil er den Server gar nicht fragt. QKERN hat diesen Sammler nicht.",
  },
  {
    title: "2. Eine fünfte Quelle im Log-Explorer, kein eigener Platz",
    body: "Der Explorer fächert seit 2.55 über vier Quellen der Kontrollebene, und jede hat eine Leseroute und eine Rolle. Zeilen des Postgres-Servers wären die fünfte, mit derselben Ordnung nach Zeit und Kennung und derselben Feldgrenze wie ein Log-Drain. Eine eigene Seite dafür wäre ein Rückschritt: Wer einen Vorfall sucht, will alle Quellen in einer Suche.",
  },
  {
    title: "3. Eine Aufbewahrung, die wirklich löscht",
    body: "Jede Logtabelle von QKERN ist heute append-only, und genau eine hat eine Frist: realtime_events. Ein Serverlog wächst schneller als alles andere im Stack, und eine Tabelle ohne Frist füllt die Platte der Kontrollebene. Diese Frist gehört in die Migration und in einen Räumer, der sie wirklich fährt.",
  },
  {
    title: "4. Die Frage, wem eine Zeile gehört",
    body: "Ein Serverlog gilt für den ganzen Cluster. Auf einem Cluster mit mehreren Projekten stehen die Meldungen aller darin, und ein Teil der Zeilen trägt überhaupt keinen Datenbanknamen. Wer solche Zeilen einer Organisation zeigt, zeigt ihr fremde. Eine Quelle für Serverlogzeilen braucht darum zuerst eine Antwort darauf und erst danach eine Route.",
  },
];

/**
 * Der Weg, der im eigenen Stack geht, und warum QKERN ihn nicht nimmt.
 *
 * Das steht hier und nicht unter den naechsten Schritten, weil es kein
 * Schritt ist. Es ist ein Befund: Es geht, es geht nur hier, und es kostet
 * mehr als es bringt.
 */
export const SERVER_LOG_OWN_STACK: readonly ServerLogNote[] = [
  {
    title: "Was im eigenen Stack ginge",
    body: "Ein Server mit logging_collector = on und log_destination = csvlog schreibt eine Datei mit Spalten. Ein Superuser legt darüber einmalig file_fdw, einen Server und eine Fremdtabelle an. Danach liest eine gewöhnliche Rolle diese Tabelle mit einem blossen SELECT-Recht, ohne Mitglied von pg_read_server_files zu sein. Gemessen wurde das gegen postgres:17-alpine, und es funktioniert.",
  },
  {
    title: "Warum das kein Weg für QKERN ist",
    body: "Der Name der Datei steht in log_filename und wechselt mit jeder Rotation; eine Fremdtabelle zeigt danach auf eine Datei, die niemand mehr schreibt. Vor allem aber gilt die Datei für den ganzen Cluster. Eine Sicht, die auf den eigenen Datenbanknamen filtert, hält die Mandanten sauber und lässt dabei jede Zeile des Postmasters weg, also gerade die, um die es geht.",
  },
  {
    title: "Warum es bei einem gehosteten Anbieter gar nicht ginge",
    body: "Ein gehosteter Anbieter gibt keinen Superuser, und ohne Superuser gibt es kein file_fdw und keine Fremdtabelle darauf. Er lässt log_destination auch nicht setzen. Dieser Weg taugt darum für einen Stack, den man selbst fährt, und nicht für ein Produkt, das bei einem Anbieter liegen soll.",
  },
];

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function serverLogTexts(): string[] {
  return [
    ...Object.values(SERVER_LOG_VERDICTS).flatMap((entry) => [entry.label, entry.explains]),
    ...SERVER_LOG_CONTENT.flatMap((entry) => [entry.title, entry.body]),
    ...SERVER_LOG_NEXT_STEPS.flatMap((entry) => [entry.title, entry.body]),
    ...SERVER_LOG_OWN_STACK.flatMap((entry) => [entry.title, entry.body]),
  ];
}
