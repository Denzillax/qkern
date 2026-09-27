import {
  CONSOLE_DISPLAY_REASONS,
  CONSOLE_FORMAT_LOCALES,
  CONSOLE_THEMES,
  type ConsoleFormatLocale,
  type ConsoleTheme,
} from "@/lib/console/display-settings";

/**
 * Die Texte der Seite Einstellungen -> Dashboard (2.55), deutsch und an einer
 * Stelle.
 *
 * Gleiche Bauart wie `log-drains` aus 2.54: Der Schluessel ist der deutsche
 * Text, die Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabelle mit und verlangt fuer jeden Text
 * en, fr und it. Das eigene Modul braucht es, weil die Ansicht `t(variable)`
 * aufruft und ein Text hinter einer Variablen durch die Suche nach `t("...")`
 * faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 */

/** Wie das Formatgebietsschema in der Auswahl heisst. */
export const CONSOLE_FORMAT_LOCALE_LABELS: Record<ConsoleFormatLocale, string> = {
  "de-CH": "Deutsch (Schweiz)",
  "de-DE": "Deutsch (Deutschland)",
  "en-GB": "Englisch (Vereinigtes Königreich)",
  "en-US": "Englisch (Vereinigte Staaten)",
  "fr-CH": "Französisch (Schweiz)",
  "fr-FR": "Französisch (Frankreich)",
  "it-CH": "Italienisch (Schweiz)",
  "it-IT": "Italienisch (Italien)",
};

/** Wie das Aussehen in der Auswahl heisst. */
export const CONSOLE_THEME_LABELS: Record<ConsoleTheme, string> = {
  system: "Wie das Betriebssystem",
  light: "Hell",
  dark: "Dunkel",
};

/** Der Wert, der "nicht festgelegt" heisst, in Worten. */
export const CONSOLE_DISPLAY_INHERIT_LANGUAGE = "Wie die Website (Cookie)";
export const CONSOLE_DISPLAY_INHERIT_TIME_ZONE = "Wie der Browser";

/**
 * Die fuenf Saetze, die auf der Seite stehen, weil sie der Punkt des Slices
 * sind. Sie stehen hier und nicht in der Ansicht, damit sie uebersetzt werden
 * und nicht in einer Zeile JSX verschwinden.
 */
export const CONSOLE_DISPLAY_SCOPE =
  "Diese Einstellungen gehören zu Ihrem Konto, nicht zum Projekt und nicht zur Organisation. Ein anderes Mitglied sieht seine eigenen.";
export const CONSOLE_DISPLAY_APPLIES =
  "Sie wirken überall in dieser Console: jedes Datum, jede Uhrzeit und jede Zahl läuft durch dieselbe Stelle, und ein Vertrag hält fest, dass keine Ansicht daran vorbei formatiert.";
export const CONSOLE_DISPLAY_TIME_ZONE_BEFORE =
  "Vor 2.55 rechnete die Console stillschweigend in der Zeitzone des Browsers, ohne sie je zu nennen. Wer die Vorgabe lässt, sieht weiterhin genau das, nur steht die Zone jetzt dabei.";
export const CONSOLE_DISPLAY_MONEY =
  "Geldbeträge bleiben im Format des Ledgers (de-CH, auf Rappen abgerundet). Was die Console als Betrag zeigt, muss der Rechnung gleichen; das Format des Betrachters ändert daran nichts.";
export const CONSOLE_DISPLAY_DAY =
  "Ein Kalendertag wie ein Gültigkeitsdatum oder eine Rechnungsperiode bleibt ISO. Er hat keine Uhrzeit, in die sich eine Zeitzone umrechnen liesse.";
export const CONSOLE_DISPLAY_DEFAULTS_KEEP =
  "Die Vorgaben bilden das Verhalten vor 2.55 ab. Solange Sie nichts ändern, ändert sich nichts.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function displaySettingsTexts(): string[] {
  return [
    ...Object.values(CONSOLE_DISPLAY_REASONS),
    ...CONSOLE_FORMAT_LOCALES.map((entry) => CONSOLE_FORMAT_LOCALE_LABELS[entry]),
    ...CONSOLE_THEMES.map((entry) => CONSOLE_THEME_LABELS[entry]),
    CONSOLE_DISPLAY_INHERIT_LANGUAGE, CONSOLE_DISPLAY_INHERIT_TIME_ZONE,
    CONSOLE_DISPLAY_SCOPE, CONSOLE_DISPLAY_APPLIES, CONSOLE_DISPLAY_TIME_ZONE_BEFORE,
    CONSOLE_DISPLAY_MONEY, CONSOLE_DISPLAY_DAY, CONSOLE_DISPLAY_DEFAULTS_KEEP,
  ];
}
