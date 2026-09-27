import {
  CONSOLE_DISPLAY_DEFAULTS,
  formatConsoleCount,
  formatConsoleDay,
  formatConsoleDecimal,
  formatConsoleMoment,
  formatConsoleNumber,
  formatConsolePercent,
  resolvedConsoleTimeZone,
  type ConsoleDisplaySettings,
  type ConsoleMomentStyle,
} from "@/lib/console/display-settings";

/**
 * Die geltende Darstellung der Console (2.55), gebunden an die Ansichten.
 *
 * Dieselbe Bauart wie `console-i18n`: Die Einstellungen liegen in einer
 * Modulvariablen, die `ConsoleApp` zu Beginn jedes Renderns setzt. Das ist
 * bewusst kein Context. Die Console besteht aus rund vierzig kleinen
 * Komponenten, die frueher jede fuer sich `new Intl.DateTimeFormat("de-CH")`
 * gebaut haben; ein Context haette jede davon zu einer Hook-Komponente
 * gemacht, und mehrere Formatierer stehen als Modulkonstante ausserhalb jeder
 * Komponente. React rendert einen Baum synchron von oben nach unten, also
 * sieht jede Ansicht die Einstellungen, die der Wurzel gerade uebergeben
 * wurden.
 *
 * Ansichten benutzen ausschliesslich diese Funktionen. Der Vertrag
 * `console-display-contract` liest jede Datei in `components/console` und
 * laesst dort weder `Intl.DateTimeFormat` noch `Intl.NumberFormat`, weder
 * `toLocale*` noch `toFixed` zu, damit die naechste Ansicht nicht wieder
 * abdriftet.
 */
let active: ConsoleDisplaySettings = CONSOLE_DISPLAY_DEFAULTS;

export function setConsoleDisplaySettings(settings: ConsoleDisplaySettings): void {
  active = settings;
}

export function consoleDisplaySettings(): ConsoleDisplaySettings {
  return active;
}

/** Ein Zeitpunkt in der gewaehlten Form, Sprache und Zone. */
export function formatMoment(value: string | number | Date, style: ConsoleMomentStyle = "dateTime"): string {
  return formatConsoleMoment(value, active, style);
}

/** Ein Kalendertag; er bleibt ISO, siehe `formatConsoleDay`. */
export function formatDay(value: string): string {
  return formatConsoleDay(value, active);
}

/** Eine ganze Zahl mit Tausendergruppierung. */
export function formatNumber(value: number | bigint): string {
  return formatConsoleNumber(value, active);
}

/** Eine Menge als Dezimalstring, BigInt-sicher. */
export function formatCount(value: string): string {
  return formatConsoleCount(value, active);
}

/** Eine Zahl mit fester Nachkommastelle, ohne Gruppierung. */
export function formatDecimal(value: number, fractionDigits: number): string {
  return formatConsoleDecimal(value, active, fractionDigits);
}

/** Ein Anteil als Prozentzahl; das Argument ist der Bruch. */
export function formatPercent(value: number, maximumFractionDigits = 1): string {
  return formatConsolePercent(value, active, maximumFractionDigits);
}

/** Die Zone, in der gerade gerechnet wird, mit Namen. */
export function activeTimeZoneName(): string {
  return resolvedConsoleTimeZone(active);
}
