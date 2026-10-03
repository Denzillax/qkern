import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { INTERFACE_MODES, REAL_VIEWS, type InterfaceMode, type RealViewId } from "@/components/console/navigation";

/**
 * Die eigene Darstellung der Console (2.55), an einer Stelle.
 *
 * Bis hierher formatierte jede Ansicht selbst: rund vierzig Stellen mit
 * `new Intl.DateTimeFormat("de-CH", ...)`, `new Intl.NumberFormat("de-CH")`,
 * `toFixed` oder einem abgeschnittenen ISO-Tag. Die Sprache der Console war
 * uebersetzt, die Zahlen und Zeitpunkte waren es nicht, und die Zeitzone war
 * stillschweigend die des Browsers -- ein Betreiber in Zuerich und einer in
 * Singapur sahen zu derselben Zeile verschiedene Uhrzeiten, ohne dass die
 * Seite je gesagt haette, in welcher Zone sie rechnet.
 *
 * Dieses Modul ist die einzige Quelle beider Formate. Es ist rein: kein React,
 * keine Datenbank, kein Zugriff auf `document`. Jede Funktion nimmt die
 * Einstellungen der Person als Argument, damit sie sich ohne Browser pruefen
 * laesst; die Console bindet sie in `components/console/console-display.ts` an
 * die gerade geltenden Einstellungen.
 *
 * ## Die Vorgaben aendern nichts
 *
 * `CONSOLE_DISPLAY_DEFAULTS` bildet das Verhalten vor 2.55 exakt ab:
 *
 * - `language: "browser"` -- die Sprache kommt weiter aus dem Locale-Cookie
 *   beziehungsweise dem Accept-Language-Header (2.2).
 * - `formatLocale: "de-CH"` -- genau das Format, das seit 2.37 fuer Geld und
 *   seit je fuer jede andere Zahl und jeden Zeitpunkt galt.
 * - `timeZone: "browser"` -- es wird keine Zone gesetzt, also rechnet
 *   `Intl` wie bisher in der Zone der Laufzeit.
 * - `startView: "overview"` -- die Console oeffnet auf der Uebersicht.
 * - `theme: "system"` -- der Umschalter oben rechts und die Vorliebe des
 *   Betriebssystems entscheiden wie bisher.
 *
 * Niemandes Console sieht nach 2.55 anders aus, solange er nichts einstellt.
 *
 * ## Was hier bewusst nicht steht
 *
 * Geldbetraege bleiben in `lib/console/money`. Release 2.37 hat sie auf
 * BigInt und auf die Rundungsregel des Rechnungslaufs festgelegt, und ihre
 * Tausendergruppierung ist Teil dieser Regel. Sie liegt darum weiter fest bei
 * `de-CH` und nicht am Formatgebietsschema der Person: Was die Console als
 * Betrag zeigt, muss der Rechnung gleichen, und eine Rechnung wird in der
 * Waehrung und im Format des Ledgers gestellt, nicht in dem des Betrachters.
 */

/** Das Formatgebietsschema, aus dem Datum, Uhrzeit und Zahlformat folgen. */
export const CONSOLE_FORMAT_LOCALES = [
  "de-CH", "de-DE", "en-GB", "en-US", "fr-CH", "fr-FR", "it-CH", "it-IT",
] as const;
export type ConsoleFormatLocale = (typeof CONSOLE_FORMAT_LOCALES)[number];

/** Die Modi des hellen und dunklen Aussehens. */
export const CONSOLE_THEMES = ["system", "light", "dark"] as const;
export type ConsoleTheme = (typeof CONSOLE_THEMES)[number];

/**
 * Der Wert, der "nicht festgelegt" heisst. Er steht sowohl fuer die Sprache
 * als auch fuer die Zeitzone und bedeutet beide Male dasselbe: Die Console
 * entscheidet wie vor 2.55, also ueber Cookie beziehungsweise ueber die Zone
 * der Laufzeit. Ein eigener Wert statt `null`, weil er ueber JSON, ueber eine
 * Textspalte und durch ein Auswahlfeld muss.
 */
export const CONSOLE_DISPLAY_INHERIT = "browser";

export type ConsoleDisplaySettings = {
  /** Die Sprache der Console, oder `"browser"` fuer das Locale-Cookie. */
  language: Locale | typeof CONSOLE_DISPLAY_INHERIT;
  /** Das Gebietsschema, aus dem Datums-, Zeit- und Zahlformat folgen. */
  formatLocale: ConsoleFormatLocale;
  /** Eine IANA-Zone, oder `"browser"` fuer die Zone der Laufzeit. */
  timeZone: string;
  /** Die Ansicht, auf der die Console oeffnet. */
  startView: RealViewId;
  theme: ConsoleTheme;
  /**
   * Der Oberflaechenmodus (2.134), `easy` oder `advanced`.
   *
   * Das ist die einzige Einstellung dieses Moduls, deren Vorgabe das Verhalten
   * aendert: Vor 2.134 gab es nur die vollstaendige Navigation, und die Vorgabe
   * ist jetzt die einfache. Das ist gewollt, denn wer die Console zum ersten
   * Mal oeffnet, soll nicht mit zwanzig Gruppen beginnen. Erreichbar bleibt in
   * beiden Modi dasselbe; umgestellt wird oben in der Kopfzeile oder hier.
   */
  interfaceMode: InterfaceMode;
};

export const CONSOLE_DISPLAY_DEFAULTS: ConsoleDisplaySettings = {
  language: CONSOLE_DISPLAY_INHERIT,
  formatLocale: "de-CH",
  timeZone: CONSOLE_DISPLAY_INHERIT,
  startView: "overview",
  theme: "system",
  interfaceMode: "easy",
};

/**
 * Eine kurze Liste zur Auswahl. Sie ist keine Grenze: `validateTimeZone`
 * nimmt jede Zone, die die Laufzeit kennt. Die Liste steht nur da, damit die
 * Ansicht nicht mit mehreren hundert Eintraegen beginnt.
 */
export const CONSOLE_SUGGESTED_TIME_ZONES = [
  "Europe/Zurich", "Europe/Berlin", "Europe/Paris", "Europe/Rome", "Europe/London",
  "UTC", "America/New_York", "America/Sao_Paulo", "Asia/Singapore", "Australia/Sydney",
] as const;

/** Der Grund einer Ablehnung, in Worten, uebersetzbar wie jeder andere Text. */
export class ConsoleDisplayError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ConsoleDisplayError";
  }
}

export const CONSOLE_DISPLAY_REASONS = {
  language: "Diese Sprache gibt es in der Console nicht.",
  formatLocale: "Dieses Zahlen- und Datumsformat steht nicht zur Auswahl.",
  timeZone: "Diese Zeitzone kennt die Laufzeit nicht.",
  startView: "Diese Startseite gibt es nicht oder sie ist noch nicht verbunden.",
  theme: "Dieses Aussehen gibt es nicht.",
  interfaceMode: "Diesen Oberflächenmodus gibt es nicht.",
  shape: "Aus dieser Eingabe lässt sich keine Darstellung bauen.",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Prueft eine Zone, indem sie benutzt wird. Eine eigene Liste waere in dem
 * Moment falsch, in dem die IANA-Datenbank der Laufzeit sich aendert; `Intl`
 * wirft bei einer unbekannten Zone einen RangeError, und genau das ist die
 * Antwort auf die Frage.
 */
export function isConsoleTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  if (value === CONSOLE_DISPLAY_INHERIT) return true;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Baut aus einer fremden Eingabe genau eine Einstellung oder wirft. Fehlende
 * Felder nehmen die Vorgabe; ein vorhandenes, aber falsches Feld wird nie
 * stillschweigend ersetzt, sondern abgelehnt. Der Unterschied ist der Punkt:
 * Ein Tippfehler in der Zeitzone soll auffallen und nicht dazu fuehren, dass
 * die Console heimlich weiter in der Browserzone rechnet.
 */
export function validateConsoleDisplaySettings(input: unknown): ConsoleDisplaySettings {
  if (!isRecord(input)) throw new ConsoleDisplayError(CONSOLE_DISPLAY_REASONS.shape);

  const language = input.language ?? CONSOLE_DISPLAY_DEFAULTS.language;
  if (language !== CONSOLE_DISPLAY_INHERIT && !(LOCALES as readonly unknown[]).includes(language)) {
    throw new ConsoleDisplayError(CONSOLE_DISPLAY_REASONS.language);
  }

  const formatLocale = input.formatLocale ?? CONSOLE_DISPLAY_DEFAULTS.formatLocale;
  if (!(CONSOLE_FORMAT_LOCALES as readonly unknown[]).includes(formatLocale)) {
    throw new ConsoleDisplayError(CONSOLE_DISPLAY_REASONS.formatLocale);
  }

  const timeZone = input.timeZone ?? CONSOLE_DISPLAY_DEFAULTS.timeZone;
  if (!isConsoleTimeZone(timeZone)) throw new ConsoleDisplayError(CONSOLE_DISPLAY_REASONS.timeZone);

  const startView = input.startView ?? CONSOLE_DISPLAY_DEFAULTS.startView;
  if (!(REAL_VIEWS as readonly unknown[]).includes(startView)) {
    throw new ConsoleDisplayError(CONSOLE_DISPLAY_REASONS.startView);
  }

  const theme = input.theme ?? CONSOLE_DISPLAY_DEFAULTS.theme;
  if (!(CONSOLE_THEMES as readonly unknown[]).includes(theme)) {
    throw new ConsoleDisplayError(CONSOLE_DISPLAY_REASONS.theme);
  }

  const interfaceMode = input.interfaceMode ?? CONSOLE_DISPLAY_DEFAULTS.interfaceMode;
  if (!(INTERFACE_MODES as readonly unknown[]).includes(interfaceMode)) {
    throw new ConsoleDisplayError(CONSOLE_DISPLAY_REASONS.interfaceMode);
  }

  return {
    language: language as ConsoleDisplaySettings["language"],
    formatLocale: formatLocale as ConsoleFormatLocale,
    timeZone: timeZone as string,
    startView: startView as RealViewId,
    theme: theme as ConsoleTheme,
    interfaceMode: interfaceMode as InterfaceMode,
  };
}

/**
 * Die Formen, in denen die Console einen Zeitpunkt zeigt. Jede entspricht
 * genau einer Stelle, die es vor 2.55 schon gab, damit die Vorgaben dieselbe
 * Ausgabe erzeugen wie zuvor.
 *
 * - `date` -- `Intl.DateTimeFormat(locale)` ohne Optionen, also "25.9.2026".
 * - `dateShort` -- `dateStyle: "short"`, also "25.09.26".
 * - `dateTime` -- kurzes Datum und kurze Uhrzeit.
 * - `dateTimeSeconds` -- kurzes Datum und Uhrzeit mit Sekunden.
 * - `time` -- nur die Uhrzeit mit Sekunden.
 * - `hourMinute` -- nur Stunde und Minute, zweistellig.
 */
export const CONSOLE_MOMENT_STYLES = [
  "date", "dateShort", "dateTime", "dateTimeSeconds", "time", "hourMinute",
] as const;
export type ConsoleMomentStyle = (typeof CONSOLE_MOMENT_STYLES)[number];

const MOMENT_OPTIONS: Record<ConsoleMomentStyle, Intl.DateTimeFormatOptions> = {
  date: {},
  dateShort: { dateStyle: "short" },
  dateTime: { dateStyle: "short", timeStyle: "short" },
  dateTimeSeconds: { dateStyle: "short", timeStyle: "medium" },
  time: { timeStyle: "medium" },
  hourMinute: { hour: "2-digit", minute: "2-digit" },
};

/**
 * Formatierer werden gecacht. Vor 2.55 lagen sie als Modulkonstanten in den
 * Ansichten, wurden also einmal gebaut; ohne Cache baute jede Zeile einer
 * Logliste einen neuen, und `Intl.DateTimeFormat` ist teuer.
 */
const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();

function dateTimeFormat(settings: ConsoleDisplaySettings, style: ConsoleMomentStyle): Intl.DateTimeFormat {
  const key = `${settings.formatLocale}|${settings.timeZone}|${style}`;
  const cached = dateTimeCache.get(key);
  if (cached) return cached;
  const options: Intl.DateTimeFormatOptions = { ...MOMENT_OPTIONS[style] };
  // Keine Zone setzen heisst: die Zone der Laufzeit, genau wie vor 2.55.
  if (settings.timeZone !== CONSOLE_DISPLAY_INHERIT) options.timeZone = settings.timeZone;
  const built = new Intl.DateTimeFormat(settings.formatLocale, options);
  dateTimeCache.set(key, built);
  return built;
}

function numberFormat(settings: ConsoleDisplaySettings, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${settings.formatLocale}|${JSON.stringify(options)}`;
  const cached = numberCache.get(key);
  if (cached) return cached;
  const built = new Intl.NumberFormat(settings.formatLocale, options);
  numberCache.set(key, built);
  return built;
}

/**
 * Ein Zeitpunkt in der gewaehlten Form, Sprache und Zone. Ein Wert, der kein
 * Zeitpunkt ist, wird unveraendert zurueckgegeben statt als "Invalid Date"
 * angezeigt; mehrere Ansichten machten das vor 2.55 schon selbst, und die
 * anderen zeigten den Unsinn.
 */
export function formatConsoleMoment(
  value: string | number | Date,
  settings: ConsoleDisplaySettings,
  style: ConsoleMomentStyle = "dateTime",
): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return dateTimeFormat(settings, style).format(parsed);
}

/**
 * Ein Kalendertag, wie ihn PostgreSQL als `date` liefert und wie ihn eine
 * Rechnungsperiode traegt: "2026-09-24".
 *
 * Er wird bewusst **nicht** in die Zeitzone der Person gerechnet und bleibt
 * ISO. Ein Kalendertag ist kein Zeitpunkt; er hat keine Uhrzeit, in die sich
 * eine Zone umrechnen liesse. Wuerde er als Zeitpunkt gelesen und in eine
 * andere Zone geschoben, waere "gueltig bis 2026-09-24" in Sydney ploetzlich
 * der 25. -- eine Aussage, die niemand getroffen hat. Er laeuft trotzdem durch
 * dieses Modul, damit keine Ansicht mehr selbst an einem Datumsstring
 * schneidet und der Vertrag die Stelle sieht.
 */
export function formatConsoleDay(value: string, _settings: ConsoleDisplaySettings): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : value;
}

/** Eine ganze Zahl mit Tausendergruppierung. BigInt gruppiert verlustfrei. */
export function formatConsoleNumber(
  value: number | bigint,
  settings: ConsoleDisplaySettings,
): string {
  return numberFormat(settings, {}).format(value);
}

/**
 * Eine Menge als Dezimalstring, wie sie die Nutzungs- und Logrouten liefern.
 * Sie kann ueber `Number.MAX_SAFE_INTEGER` hinausgehen, darum BigInt; was
 * keine Ganzzahl ist, bleibt wie es ist.
 */
export function formatConsoleCount(value: string, settings: ConsoleDisplaySettings): string {
  return /^-?\d{1,30}$/.test(value) ? formatConsoleNumber(BigInt(value), settings) : value;
}

/**
 * Eine Zahl mit fester Nachkommastelle und ohne Gruppierung, also das, was
 * `toFixed` vor 2.55 tat -- nur mit dem Dezimalzeichen der gewaehlten Sprache.
 * Die Aufrufer sind die drei Byte-Formatierer; ihr Wert liegt immer unter
 * 1024, darum faellt das Weglassen der Gruppierung nicht auf und die Vorgabe
 * ergibt Zeichen fuer Zeichen dasselbe wie `toFixed`.
 */
export function formatConsoleDecimal(
  value: number,
  settings: ConsoleDisplaySettings,
  fractionDigits: number,
): string {
  return numberFormat(settings, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: false,
  }).format(value);
}

/** Ein Anteil als Prozentzahl; das Argument ist der Bruch, nicht die Prozentzahl. */
export function formatConsolePercent(
  value: number,
  settings: ConsoleDisplaySettings,
  maximumFractionDigits = 1,
): string {
  return numberFormat(settings, { style: "percent", maximumFractionDigits }).format(value);
}

/**
 * Die Zeitzone, in der die Console gerade rechnet, mit Namen. Die Ansicht
 * schreibt sie hin, damit eine Uhrzeit nicht ohne Zone dasteht.
 */
export function resolvedConsoleTimeZone(settings: ConsoleDisplaySettings): string {
  if (settings.timeZone !== CONSOLE_DISPLAY_INHERIT) return settings.timeZone;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** Die Sprache, in der die Console spricht, wenn die Vorgabe das Cookie ist. */
export function resolvedConsoleLanguage(
  settings: ConsoleDisplaySettings,
  cookieLocale: Locale,
): Locale {
  return settings.language === CONSOLE_DISPLAY_INHERIT ? cookieLocale : settings.language;
}
