/**
 * Die Texte und die Rechnungen der Seite Berichte -> Abfrage-Leistung (2.67),
 * deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `database-activity-texts` (2.46): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Das eigene Modul braucht es, weil die Ansicht
 * Einheiten ueber `t(variable)` zeigt; ein Text hinter einer Variablen faellt
 * durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Datenbank, kein React, keine Farbe.
 *
 * Hier steht kein Wert aus der Projektdatenbank und vor allem kein
 * Abfragetext. Warum die Seite ihn nicht zeigt, steht ausgeschrieben an der
 * Abfrage selbst (`STATEMENT_DIGESTS_SQL` in der Data Plane) und in
 * `QUERY_PERFORMANCE_NO_TEXT`, dem Satz, den die Seite dem Leser sagt.
 */

/** Die Einheiten, in denen die Seite eine Dauer zeigt. */
export const DURATION_UNITS = ["Mikrosekunden", "Millisekunden", "Sekunden", "Minuten"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export type Duration = {
  value: number;
  unit: DurationUnit;
  /** Wie viele Nachkommastellen die Ansicht zeigen soll. */
  fractionDigits: number;
};

/**
 * Eine Dauer in Mikrosekunden in der groessten Einheit, in der sie noch eine
 * Stelle vor dem Komma hat.
 *
 * Eine Mikrosekunde ist die kleinste Zahl, die aus der Data Plane kommt, und
 * sie bleibt ganzzahlig: Ein Bruchteil davon waere erfunden. Ab Millisekunden
 * bleibt eine Nachkommastelle stehen, weil 1,4 Millisekunden und 1,9
 * Millisekunden fuer den Leser nicht dasselbe sind.
 */
export function duration(microseconds: number): Duration {
  const total = Number.isFinite(microseconds) && microseconds > 0 ? Math.floor(microseconds) : 0;
  if (total < 1000) return { value: total, unit: "Mikrosekunden", fractionDigits: 0 };
  if (total < 1_000_000) return { value: total / 1000, unit: "Millisekunden", fractionDigits: 1 };
  if (total < 60_000_000) return { value: total / 1_000_000, unit: "Sekunden", fractionDigits: 1 };
  return { value: total / 60_000_000, unit: "Minuten", fractionDigits: 1 };
}

/** Eine Dauer, die als Millisekunden ankommt, in derselben Staffel. */
export function durationFromMilliseconds(milliseconds: number): Duration {
  const total = Number.isFinite(milliseconds) && milliseconds > 0 ? Math.floor(milliseconds) : 0;
  return duration(total * 1000);
}

/**
 * Der Anteil eines Statements an der Gesamtzeit der gezeigten Liste.
 *
 * `null`, wenn die Summe null ist: Eine frisch zurueckgesetzte Statistik hat
 * keine Gesamtzeit, und 0 Prozent waere eine Behauptung ueber eine Datenbank,
 * die noch nichts getan hat. Der Nenner ist ausdruecklich die Summe der
 * gezeigten Zeilen und nicht die Zeit der ganzen Datenbank; genau das sagt
 * `QUERY_PERFORMANCE_SHARE`.
 */
export function timeShare(totalTimeMs: number, sumTotalMs: number): number | null {
  if (!Number.isFinite(totalTimeMs) || !Number.isFinite(sumTotalMs)) return null;
  if (totalTimeMs < 0 || sumTotalMs <= 0) return null;
  return totalTimeMs / sumTotalMs;
}

/**
 * Zeilen je Aufruf. `null` bei null Aufrufen: Eine Zeile ohne Aufruf kann es
 * in der Sicht nicht geben, und eine Division durch null ist kein Mittelwert.
 */
export function rowsPerCall(rows: number, calls: number): number | null {
  if (!Number.isFinite(rows) || !Number.isFinite(calls) || calls <= 0 || rows < 0) return null;
  return rows / calls;
}

/**
 * Der Satz zum Zeitraum. Eine Gesamtzeit von zwei Minuten bedeutet etwas
 * anderes ueber eine Stunde als ueber einen Monat, und `pg_stat_statements`
 * sagt selbst nicht, wann sie zuletzt zurueckgesetzt wurde.
 */
export const QUERY_PERFORMANCE_HONESTY =
  "Die Zahlen zählen seit dem letzten Zurücksetzen von pg_stat_statements. Wann das war, meldet die Erweiterung dieser Ansicht nicht.";

/**
 * Der Satz zum fehlenden Abfragetext. Er steht auf der Seite, weil das, was
 * eine Fläche nicht hält, wörtlich dastehen muss.
 */
export const QUERY_PERFORMANCE_NO_TEXT =
  "QKERN zeigt den Abfragetext nicht, auch nicht den normalisierten. Jede Zeile nennt die Kennung, die PostgreSQL für den Abfragebaum vergibt, und sonst nur Zahlen.";

/** Warum das so ist, in einem Satz für den Leser, der es wissen will. */
export const QUERY_PERFORMANCE_NO_TEXT_REASON =
  "pg_stat_statements ersetzt die Literale einer Abfrage durch $1 und $2, aber nicht die eines Utility-Befehls: Ein CREATE ROLE steht mit seinem Passwort in der Sicht. Darum liest QKERN die Spalte gar nicht erst.";

/** Der Nenner des Anteils, ausgeschrieben statt angenommen. */
export const QUERY_PERFORMANCE_SHARE =
  "Der Anteil misst sich an der Summe der hier gezeigten Statements, nicht an der gesamten Zeit der Datenbank.";

/** Fehlt die Erweiterung, sagt die Seite das wörtlich statt eine leere Liste zu zeigen. */
export const QUERY_PERFORMANCE_MISSING_EXTENSION =
  "Die Erweiterung pg_stat_statements ist in dieser Projektdatenbank nicht erreichbar. Ohne sie zählt niemand mit, und diese Seite hat nichts zu zeigen. Sie ist darum leer und nicht etwa schnell.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function queryPerformanceTexts(): string[] {
  return [
    ...DURATION_UNITS,
    QUERY_PERFORMANCE_HONESTY,
    QUERY_PERFORMANCE_NO_TEXT,
    QUERY_PERFORMANCE_NO_TEXT_REASON,
    QUERY_PERFORMANCE_SHARE,
    QUERY_PERFORMANCE_MISSING_EXTENSION,
  ];
}
