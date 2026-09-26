/**
 * Die Texte und die Rechnungen der Seiten Datenbank und Verbindungen (2.46),
 * deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `health-advisor-texts` (2.44) und `usage-series-texts`
 * (2.45): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn
 * ueber ihren Katalog, und der Vertrag `console-i18n-contract` liest diese
 * Tabellen mit und verlangt fuer jeden Text en, fr und it. Das eigene Modul
 * braucht es, weil die Ansichten `t(variable)` aufrufen: Der Zustandsname
 * einer Verbindung kommt aus der Datenbank, und ein Text hinter einer
 * Variablen faellt durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, keine Farbe.
 *
 * Wichtig fuer die Geheimhaltung: Hier steht kein Wert aus der
 * Projektdatenbank und kein Abfragetext. Die Zustandsnamen sind die festen
 * Woerter, die `pg_stat_activity` kennt; ein unbekannter Zustand wird als
 * solcher gezeigt, nicht erfunden.
 */

/** Die Zustaende, die `pg_stat_activity` kennt, plus `unknown`. */
export const CONNECTION_STATES = [
  "active",
  "idle",
  "idle in transaction",
  "idle in transaction (aborted)",
  "fastpath function call",
  "disabled",
  "unknown",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

export type ConnectionStateText = {
  label: string;
  explains: string;
  /** Wie die Ansicht den Zustand einfaerbt; dieselben Klassen wie die Berater. */
  tone: "secure" | "muted" | "risk medium";
};

export const CONNECTION_STATE_TEXTS: Record<ConnectionState, ConnectionStateText> = {
  "active": {
    label: "arbeitet",
    explains: "Die Sitzung führt gerade ein Statement aus.",
    tone: "secure",
  },
  "idle": {
    label: "wartet",
    explains: "Die Sitzung ist offen und tut nichts. Das ist der Normalfall eines Verbindungspools.",
    tone: "muted",
  },
  "idle in transaction": {
    label: "wartet in einer Transaktion",
    explains: "Die Sitzung hat eine Transaktion offen und tut nichts. Solche Sitzungen halten Sperren und blockieren das Aufräumen.",
    tone: "risk medium",
  },
  "idle in transaction (aborted)": {
    label: "wartet in einer abgebrochenen Transaktion",
    explains: "Die Transaktion ist gescheitert, aber weder abgeschlossen noch zurückgerollt. Sie hält weiter eine Verbindung.",
    tone: "risk medium",
  },
  "fastpath function call": {
    label: "direkter Funktionsaufruf",
    explains: "Ein Aufruf am Protokoll vorbei, wie ihn manche Treiber für grosse Objekte verwenden.",
    tone: "muted",
  },
  "disabled": {
    label: "Statistik abgeschaltet",
    explains: "Diese Sitzung meldet ihren Zustand nicht, weil track_activities für sie aus ist.",
    tone: "muted",
  },
  "unknown": {
    label: "unbekannt",
    explains: "Die Datenbank hat für diese Sitzungen keinen Zustand gemeldet.",
    tone: "muted",
  },
};

export function connectionStateText(state: string): ConnectionStateText {
  return (CONNECTION_STATES as readonly string[]).includes(state)
    ? CONNECTION_STATE_TEXTS[state as ConnectionState]
    : CONNECTION_STATE_TEXTS.unknown;
}

/**
 * Der Satz der Datenbankseite. Er steht ueber jeder Zahl, weil eine
 * Trefferquote von 99 Prozent ueber zwei Minuten etwas anderes ist als ueber
 * zwei Wochen.
 */
export const DATABASE_REPORT_HONESTY =
  "Die Zahlen gelten seit dem letzten Zuruecksetzen der Statistik, nicht seit dem Start der Datenbank.";

/**
 * Der Satz der Verbindungsseite. PostgreSQL blendet fuer eine
 * unprivilegierte Rolle die Sitzungen anderer Rollen aus; was sie nicht
 * sieht, fehlt in der Zaehlung. Das ist keine Stoerung, sondern die Grenze,
 * und sie gehoert auf die Seite.
 */
export const CONNECTIONS_REPORT_HONESTY =
  "Gezaehlt wird, was diese Rolle sehen darf. Einzelne Sitzungen und ihre Abfragen zeigt QKERN nicht.";

/**
 * Die Trefferquote des Caches: Anteil der Bloecke, die schon im Speicher
 * lagen. `null` heisst, dass noch kein Block gelesen wurde — weder aus dem
 * Cache noch von der Platte. Eine frisch zurueckgesetzte Statistik zeigt
 * dann keine 0 Prozent und keine 100, sondern gar nichts; beides waere eine
 * Behauptung ueber eine Datenbank, die noch nichts getan hat.
 */
export function cacheHitRatio(blocksHit: number, blocksRead: number): number | null {
  if (!Number.isFinite(blocksHit) || !Number.isFinite(blocksRead) || blocksHit < 0 || blocksRead < 0) return null;
  const total = blocksHit + blocksRead;
  return total === 0 ? null : blocksHit / total;
}

/**
 * Der Anteil der belegten Verbindungen an `max_connections`. `null`, wenn
 * die Grenze nicht sinnvoll gemeldet wurde; eine Division durch null ist
 * keine Auslastung.
 */
export function connectionLoad(backends: number, maxConnections: number): number | null {
  if (!Number.isFinite(backends) || !Number.isFinite(maxConnections) || maxConnections <= 0 || backends < 0) return null;
  return backends / maxConnections;
}

export const AGE_UNITS = ["Sekunden", "Minuten", "Stunden", "Tage"] as const;
export type AgeUnit = (typeof AGE_UNITS)[number];
export type SessionAge = { value: number; unit: AgeUnit };

/**
 * Das Alter der aeltesten Sitzung einer Gruppe in einer lesbaren Einheit.
 * Abgerundet, nie aufgerundet: Eine Sitzung, die 119 Sekunden offen ist, ist
 * eine Minute alt und nicht zwei.
 */
export function sessionAge(seconds: number): SessionAge {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  if (total < 60) return { value: total, unit: "Sekunden" };
  if (total < 3600) return { value: Math.floor(total / 60), unit: "Minuten" };
  if (total < 86400) return { value: Math.floor(total / 3600), unit: "Stunden" };
  return { value: Math.floor(total / 86400), unit: "Tage" };
}

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function databaseActivityTexts(): string[] {
  return [
    ...Object.values(CONNECTION_STATE_TEXTS).flatMap((state) => [state.label, state.explains]),
    ...AGE_UNITS,
    DATABASE_REPORT_HONESTY,
    CONNECTIONS_REPORT_HONESTY,
  ];
}
