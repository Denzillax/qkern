/**
 * Die Texte der Nutzungs-Zeitreihen (2.45), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `cron-log-texts` (2.42) und `health-advisor-texts`
 * (2.44): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn
 * ueber ihren Katalog, und der Vertrag `console-i18n-contract` liest diese
 * Tabellen mit und verlangt fuer jeden Text en, fr und it. Das eigene Modul
 * braucht es, weil die Ansicht `t(variable)` aufruft und ein Text hinter
 * einer Variablen durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der wichtigste Teil sind die `cannotShow`-Saetze. Die drei Platzhalter
 * dieser Seiten versprachen bis 2.45 Antwortzeiten (API), Belegung (Storage)
 * und Fehler (Functions). Nichts davon steht in einem Nutzungsereignis: Es
 * traegt eine Menge, einen Zeitpunkt und den Entscheid der Quota. Die Reihe
 * sagt deshalb an jeder der drei Stellen selbst, was sie nicht zeigt.
 */

export const USAGE_SERIES_METRIC_IDS = [
  "api_requests",
  "database_row_reads",
  "storage_egress_bytes",
  "realtime_messages",
  "queue_operations",
  "function_invocations",
] as const;

export type UsageSeriesMetricId = (typeof USAGE_SERIES_METRIC_IDS)[number];

export type UsageSeriesMetricText = {
  label: string;
  /** Die Einheit in Worten, fuer Achse und Tabelle. */
  unit: string;
};

export const USAGE_SERIES_METRIC_TEXTS: Record<UsageSeriesMetricId, UsageSeriesMetricText> = {
  api_requests: { label: "API-Anfragen", unit: "Vorgänge" },
  database_row_reads: { label: "Gelesene Datenbankzeilen", unit: "Zeilen" },
  storage_egress_bytes: { label: "Ausgehende Storage-Bytes", unit: "Bytes" },
  realtime_messages: { label: "Realtime-Nachrichten", unit: "Nachrichten" },
  queue_operations: { label: "Queue-Vorgänge", unit: "Vorgänge" },
  function_invocations: { label: "Function-Aufrufe", unit: "Aufrufe" },
};

export type UsageSeriesViewText = {
  /** Kleiner Grossbuchstaben-Vorspann der Karte. */
  kicker: string;
  title: string;
  /** Die Metriken dieser Seite, in der Reihenfolge der Auswahl. */
  metrics: ReadonlyArray<UsageSeriesMetricId>;
  /** Was diese Seite ausdruecklich nicht zeigt. */
  cannotShow: string;
};

export const USAGE_SERIES_VIEWS = {
  api: {
    kicker: "BERICHTE",
    title: "Data API über die Zeit",
    metrics: ["api_requests", "database_row_reads"],
    cannotShow: "Antwortzeiten und Fehlercodes der Data API stehen nicht in den Nutzungsereignissen. Diese Reihe zählt Anfragen und gelesene Zeilen; abgelehnt heisst hier, dass eine Quota gegriffen hat, nicht dass die Anfrage mit einem Fehler beantwortet wurde.",
  },
  storage: {
    kicker: "BERICHTE",
    title: "Storage über die Zeit",
    metrics: ["storage_egress_bytes"],
    cannotShow: "Wie viele Bytes gerade im Bucket liegen, steht nicht in den Nutzungsereignissen. Diese Reihe zählt die ausgehenden Bytes je Zeitabschnitt, nicht die Belegung; für die Belegung zeigt Storage seine eigene Ansicht.",
  },
  functions: {
    kicker: "BERICHTE",
    title: "Functions über die Zeit",
    metrics: ["function_invocations"],
    cannotShow: "Ob ein Aufruf im Container gescheitert ist, steht nicht in den Nutzungsereignissen. Diese Reihe zählt die Aufrufe; abgelehnt heisst hier, dass eine Quota gegriffen hat, nicht dass die Function einen Fehler geworfen hat.",
  },
} as const satisfies Record<string, UsageSeriesViewText>;

export type UsageSeriesViewId = keyof typeof USAGE_SERIES_VIEWS;

/**
 * Der Satz, der an jeder der drei Seiten steht — vor jedem Balken und vor
 * jeder Zahl.
 */
export const USAGE_SERIES_HONESTY =
  "Die Reihe entsteht aus den Nutzungsereignissen. Sie zeigt, was gemessen wurde, nicht Antwortzeiten, und sie reicht nur so weit zurück wie die Aufbewahrung der Ereignisse.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function usageSeriesTexts(): string[] {
  return [
    ...Object.values(USAGE_SERIES_METRIC_TEXTS).flatMap((metric) => [metric.label, metric.unit]),
    ...Object.values(USAGE_SERIES_VIEWS).flatMap((view) => [view.kicker, view.title, view.cannotShow]),
    USAGE_SERIES_HONESTY,
  ];
}
