/**
 * Die Texte des Cron-Logs (2.42), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `performance-advisor-texts` aus 2.40: Der Schluessel ist
 * der deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabellen mit und verlangt fuer
 * jeden Text en, fr und it. Der Grund fuer das eigene Modul ist derselbe: Die
 * Ansicht ruft `t(variable)` auf, und ein Text hinter einer Variablen faellt
 * durch die Suche nach `t("...")`.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 */

export const CRON_OCCURRENCE_STATUSES = ["found", "missing", "not_yet_due", "expected"] as const;
export type CronOccurrenceStatusId = (typeof CRON_OCCURRENCE_STATUSES)[number];

export type CronOccurrenceStatusText = {
  label: string;
  explains: string;
  /** Wie die Ansicht den Zustand einfaerbt; dieselben Klassen wie die Berater. */
  tone: "secure" | "risk high" | "muted";
};

export const CRON_OCCURRENCE_STATUS_TEXTS:
Record<CronOccurrenceStatusId, CronOccurrenceStatusText> = {
  found: {
    label: "gefunden",
    explains: "Zu diesem Vorkommen liegt eine Nachricht in der Queue. Der Zustand daneben ist ihr Zustand, nicht das Ergebnis des Jobs.",
    tone: "secure",
  },
  missing: {
    label: "fehlt",
    explains: "Das Vorkommen war fällig, die Definition gab es schon, und in der Queue liegt keine Nachricht dazu. Entweder lief der Cron-Prozess nicht, oder das Einreihen scheiterte.",
    tone: "risk high",
  },
  not_yet_due: {
    label: "noch nicht fällig",
    explains: "Das Vorkommen liegt in der Zukunft oder ist erst vor wenigen Minuten vergangen. Der Dispatcher läuft im Intervall; eine Lücke ist das nicht.",
    tone: "muted",
  },
  expected: {
    label: "nicht nachweisbar",
    explains: "Das Vorkommen gehört zum Plan, aber sein Ausgang lässt sich nicht mehr nachweisen: Es liegt vor dem Anlegen der Definition, oder das Dedupe-Fenster der Queue ist abgelaufen und der Schlüssel darin gelöscht.",
    tone: "muted",
  },
};

export const CRON_MESSAGE_STATES = ["pending", "in_flight", "done", "dead_letter"] as const;
export type CronMessageStateId = (typeof CRON_MESSAGE_STATES)[number];

/** Der Zustand der Nachricht in der Queue, in Worten. */
export const CRON_MESSAGE_STATE_TEXTS: Record<CronMessageStateId, string> = {
  pending: "wartet",
  in_flight: "in Arbeit",
  done: "erledigt",
  dead_letter: "Dead Letter",
};

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function cronLogTexts(): string[] {
  return [
    ...Object.values(CRON_OCCURRENCE_STATUS_TEXTS).flatMap((status) => [status.label, status.explains]),
    ...Object.values(CRON_MESSAGE_STATE_TEXTS),
  ];
}
