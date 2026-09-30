/**
 * Die Texte und die Ableitungen der Seite Logs → Postgres-Zustand (2.70),
 * deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `infrastructure-texts` (2.68): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft: Der Name einer Quelle und ein Urteil kommen aus einer
 * Ableitung, und ein Text hinter einer Variablen faellt durch die Suche nach
 * `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, kein `fetch`.
 *
 * Hier steht kein Wert aus einer Projektdatenbank und keine Fehlermeldung. Die
 * Woerter sind die festen Begriffe der Statistiksichten von PostgreSQL, in
 * Prosa uebersetzt.
 */

export type HealthNote = {
  title: string;
  body: string;
};

/**
 * Der erste Satz der Seite, und der wichtigste.
 *
 * Der Platzhalter versprach ein Serverlog. Es gibt keines, und die Seite sagt
 * das, bevor sie eine einzige Zahl zeigt.
 */
export const NO_SERVER_LOG_NOTE =
  "Ein Serverlog der Projektdatenbank zeigt diese Seite nicht. Was dieser Server mit seinem Log tut, fragt sie ihn bei jedem Öffnen, und das Urteil dazu steht weiter unten. Was sie an Zahlen zeigt, kommt aus den Statistiksichten der Datenbank.";

/**
 * Der zweite Satz, und ohne ihn wuerde jede Zahl falsch gelesen. Eine
 * Deadlock-Zahl ist keine Meldung von gerade eben.
 */
export const COUNTER_NOTE =
  "Jede Zahl auf dieser Seite ist ein Zähler seit der letzten Rücksetzung der Statistik, kein Ereignis mit Zeitpunkt. Zwei Deadlocks heissen nicht zwei Deadlocks gerade eben, sondern zwei seit dem Zeitpunkt, der unten steht.";

export const SCOPE_NOTE =
  "Gelesen wird die Zeile dieser einen Datenbank in pg_stat_database. Der Durchsatz und die Verbindungen je Rolle stehen unter Berichte → Datenbank und Berichte → Verbindungen; diese Seite wiederholt sie nicht.";

export const WRITEBACK_SCOPE_NOTE =
  "Der Schreibweg gilt für den ganzen Server und nicht nur für diese Datenbank. Auf einem Cluster mit mehreren Projekten zählen die anderen mit.";

/** Ob die Statistik je zurueckgesetzt wurde, als Satz statt als leeres Feld. */
export const NEVER_RESET_NOTE =
  "Die Statistik dieser Datenbank wurde nie zurückgesetzt. Die Zähler laufen, seit der Server sie zu führen begann.";

/** Woher die Checkpoint-Zaehler dieses Servers kommen. */
export type CheckpointSourceId = "pg_stat_checkpointer" | "pg_stat_bgwriter";

export type SourceText = {
  label: string;
  explains: string;
};

export const CHECKPOINT_SOURCE_TEXTS: Record<CheckpointSourceId, SourceText> = {
  pg_stat_checkpointer: {
    label: "pg_stat_checkpointer",
    explains: "Dieser Server führt die Checkpoint-Zähler in einer eigenen Sicht. PostgreSQL 17 hat sie dorthin verschoben.",
  },
  pg_stat_bgwriter: {
    label: "pg_stat_bgwriter",
    explains: "Dieser Server führt die Checkpoint-Zähler noch beim Hintergrundschreiber. So war es bis einschliesslich PostgreSQL 16.",
  },
};

export function checkpointSource(value: string): CheckpointSourceId {
  return value === "pg_stat_checkpointer" ? "pg_stat_checkpointer" : "pg_stat_bgwriter";
}

/** Was die Pruefsummenzaehlung dieses Servers ueberhaupt aussagt. */
export type ChecksumStateId = "off" | "clean" | "failed";

export type ChecksumStateText = {
  label: string;
  explains: string;
  /** Dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk high";
};

export const CHECKSUM_STATE_TEXTS: Record<ChecksumStateId, ChecksumStateText> = {
  off: {
    label: "nicht geprüft",
    explains: "Dieser Server läuft ohne Datenprüfsummen, darum zählt niemand mit. Eine Null stünde hier für „geprüft und nichts gefunden“ und wäre gelogen.",
    tone: "muted",
  },
  clean: {
    label: "keine gefallen",
    explains: "Datenprüfsummen sind eingeschaltet, und seit der letzten Rücksetzung ist keine gefallen.",
    tone: "secure",
  },
  failed: {
    label: "Prüfsummen gefallen",
    explains: "Mindestens ein Block dieser Datenbank kam nicht so von der Platte zurück, wie er geschrieben wurde. Das ist ein Fall für den Betrieb und nicht für die Console.",
    tone: "risk high",
  },
};

export function checksumState(failures: number | null): ChecksumStateId {
  if (failures === null) return "off";
  return failures > 0 ? "failed" : "clean";
}

/**
 * Der Anteil der zurueckgerollten Transaktionen. `null`, solange es keine
 * Transaktion gab: Null Prozent waere eine Behauptung ueber eine Datenbank,
 * die noch nichts getan hat.
 */
export function rollbackRatio(commits: number, rollbacks: number): number | null {
  if (!Number.isFinite(commits) || !Number.isFinite(rollbacks) || commits < 0 || rollbacks < 0) return null;
  const total = commits + rollbacks;
  return total === 0 ? null : rollbacks / total;
}

/**
 * Der Anteil der angeforderten an allen Checkpoints.
 *
 * Die Zahl sagt etwas, was keiner der beiden Zaehler allein sagt: Ein hoher
 * Anteil heisst, dass die Menge an WAL die Checkpoints erzwingt, statt dass
 * der Zeitplan sie setzt. `null`, solange es keinen Checkpoint gab.
 */
export function requestedCheckpointRatio(timed: number, requested: number): number | null {
  if (!Number.isFinite(timed) || !Number.isFinite(requested) || timed < 0 || requested < 0) return null;
  const total = timed + requested;
  return total === 0 ? null : requested / total;
}

/**
 * Die mittlere Groesse einer temporaeren Datei. `null`, wenn keine geschrieben
 * wurde; eine Division durch null ist keine Groesse.
 */
export function averageTempFileBytes(tempFiles: number, tempBytes: number): number | null {
  if (!Number.isFinite(tempFiles) || !Number.isFinite(tempBytes) || tempFiles <= 0 || tempBytes < 0) return null;
  return tempBytes / tempFiles;
}

/**
 * Sitzungen, die nicht ordentlich endeten. Eine Summe, weil die drei Zaehler
 * dasselbe sagen: Die Sitzung endete, ohne dass die Anwendung sie schloss.
 */
export function brokenSessions(abandoned: number, fatal: number, killed: number): number {
  const parts = [abandoned, fatal, killed];
  if (parts.some((value) => !Number.isFinite(value) || value < 0)) return 0;
  return Math.floor(abandoned) + Math.floor(fatal) + Math.floor(killed);
}

/**
 * Was es hier nicht gibt, jeweils mit Grund. Kein Eintrag beschreibt eine
 * Oberflaeche, die es nicht gibt; jeder sagt, warum QKERN die Angabe nicht
 * machen kann.
 */
export const MISSING_POSTGRES_LOG: readonly HealthNote[] = [
  {
    title: "Kein Serverlog",
    body: "Ob dieser Server sein Log überhaupt in eine Datei schreibt, steht in der Karte zum Serverlog weiter unten, und dort steht auch, welches Recht es bräuchte, um an so eine Datei zu kommen. Eine Fläche, die so täte, als läse sie mit, wäre eine Lüge. Wer das Serverlog braucht, holt es dort, wo der Server läuft.",
  },
  {
    title: "Keine einzelne Verbindung und kein Verbindungsverlauf",
    body: "pg_stat_database zählt eröffnete und verlorene Sitzungen, führt aber keine Liste. Wer offen ist, steht unter Berichte → Verbindungen, gruppiert nach Rolle und Zustand und ohne Prozessnummer, Adresse und Abfragetext.",
  },
  {
    title: "Keine langsamen Statements",
    body: "Welche Abfrage wie viel Zeit gekostet hat, steht unter Berichte → Abfrage-Leistung, und auch dort ohne ihren Text. Eine Grenze, ab der ein Statement als langsam protokolliert wird, gibt es in QKERN nicht: log_min_duration_statement schriebe die Abfrage dorthin, wohin dieser Server sein Log schreibt, und dorthin kommt keine Abfrage.",
  },
  {
    title: "Keine Fehlermeldung im Wortlaut",
    body: "Die Statistiksichten führen keinen Text. Sie zählen, dass eine Transaktion zurückgerollt wurde oder eine Sitzung fatal endete, und sagen nicht, woran. Der Wortlaut stünde im Serverlog, und das gibt es hier nicht.",
  },
  {
    title: "Kein Zeitpunkt zu einer Zahl",
    body: "Ein Zähler weiss nicht, wann er gestiegen ist. Diese Seite kann sagen, wie viele Deadlocks es seit der letzten Rücksetzung gab, und nicht, wann sie waren. Die einzige Ausnahme ist die letzte gefallene Prüfsumme, denn die führt pg_stat_database mit ihrem Zeitpunkt.",
  },
  {
    title: "Kein Zurücksetzen der Statistik",
    body: "pg_stat_reset() ist ein Schreibaufruf, und diese Seite liest. Ein Knopf, der die Zähler aller Betrachter gleichzeitig auf null setzt, gehört nicht in eine Leseansicht.",
  },
];

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function databaseHealthTexts(): string[] {
  return [
    ...Object.values(CHECKPOINT_SOURCE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...Object.values(CHECKSUM_STATE_TEXTS).flatMap((entry) => [entry.label, entry.explains]),
    ...MISSING_POSTGRES_LOG.flatMap((entry) => [entry.title, entry.body]),
    NO_SERVER_LOG_NOTE,
    COUNTER_NOTE,
    SCOPE_NOTE,
    WRITEBACK_SCOPE_NOTE,
    NEVER_RESET_NOTE,
  ];
}
