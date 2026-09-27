import { describe, expect, it } from "vitest";
import {
  CONSOLE_DISPLAY_DEFAULTS,
  CONSOLE_DISPLAY_INHERIT,
  CONSOLE_FORMAT_LOCALES,
  ConsoleDisplayError,
  formatConsoleCount,
  formatConsoleDay,
  formatConsoleDecimal,
  formatConsoleMoment,
  formatConsoleNumber,
  formatConsolePercent,
  resolvedConsoleLanguage,
  resolvedConsoleTimeZone,
  validateConsoleDisplaySettings,
  type ConsoleDisplaySettings,
} from "@/lib/console/display-settings";
import { formatMoneyMicros, formatUnitPriceMicros } from "@/lib/console/money";

/**
 * Die eine Stelle, an der die Console formatiert (2.55).
 *
 * Der wichtigste Fall dieser Datei ist der letzte: Mit den Vorgaben muss
 * jede Funktion Zeichen fuer Zeichen dasselbe liefern wie der Ausdruck, der
 * vor 2.55 an der jeweiligen Stelle stand. Verglichen wird darum nicht gegen
 * einen abgetippten String, sondern gegen genau diesen Ausdruck: `de-CH`,
 * dieselben Optionen, keine Zone. Ein Testwert, der die ICU-Daten der
 * Laufzeit abschreibt, wuerde beim naechsten Node-Update falsch werden und
 * dabei nichts ueber das Produkt aussagen.
 */
const MOMENT = "2026-09-24T22:30:15.000Z";

const settings = (over: Partial<ConsoleDisplaySettings> = {}): ConsoleDisplaySettings =>
  ({ ...CONSOLE_DISPLAY_DEFAULTS, ...over });

describe("console display settings", () => {
  it("builds a complete setting from a partial body and keeps the defaults", () => {
    expect(validateConsoleDisplaySettings({})).toEqual(CONSOLE_DISPLAY_DEFAULTS);
    expect(validateConsoleDisplaySettings({ timeZone: "Asia/Singapore" })).toEqual({
      ...CONSOLE_DISPLAY_DEFAULTS, timeZone: "Asia/Singapore",
    });
    expect(validateConsoleDisplaySettings({
      language: "fr", formatLocale: "fr-CH", timeZone: "UTC", startView: "logs", theme: "dark",
    })).toEqual({ language: "fr", formatLocale: "fr-CH", timeZone: "UTC", startView: "logs", theme: "dark" });
  });

  it("refuses a value it cannot display instead of replacing it silently", () => {
    for (const body of [
      null, "de", [], { language: "es" }, { formatLocale: "de-AT" }, { timeZone: "Mars/Olympus" },
      { timeZone: "" }, { startView: "set-webhooks" }, { startView: "does-not-exist" }, { theme: "sepia" },
    ]) {
      expect(() => validateConsoleDisplaySettings(body), JSON.stringify(body)).toThrow(ConsoleDisplayError);
    }
    // Ein Platzhalter ist keine Startseite: Er zeigt keine Daten.
    expect(() => validateConsoleDisplaySettings({ startView: "branches" })).toThrow(ConsoleDisplayError);
  });

  it("formats a moment in every offered locale exactly as Intl does there", () => {
    for (const formatLocale of CONSOLE_FORMAT_LOCALES) {
      const chosen = settings({ formatLocale, timeZone: "Europe/Zurich" });
      const expected = new Intl.DateTimeFormat(formatLocale, {
        dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Zurich",
      }).format(new Date(MOMENT));
      expect(formatConsoleMoment(MOMENT, chosen, "dateTimeSeconds"), formatLocale).toBe(expected);
    }
  });

  it("formats a number in every offered locale exactly as Intl does there", () => {
    for (const formatLocale of CONSOLE_FORMAT_LOCALES) {
      const chosen = settings({ formatLocale });
      expect(formatConsoleNumber(1_234_567, chosen), formatLocale)
        .toBe(new Intl.NumberFormat(formatLocale).format(1_234_567));
      expect(formatConsolePercent(0.1234, chosen), formatLocale)
        .toBe(new Intl.NumberFormat(formatLocale, { style: "percent", maximumFractionDigits: 1 }).format(0.1234));
    }
  });

  it("uses the chosen time zone and not the one of the machine", () => {
    // Die Maschine des Laufs ist unbekannt; verglichen wird darum gegen zwei
    // Zonen, die sich in der Stunde unterscheiden, und gegen die Aussage,
    // dass die gewaehlte Zone wirklich gewaehlt wurde.
    const zurich = formatConsoleMoment(MOMENT, settings({ timeZone: "Europe/Zurich" }), "hourMinute");
    const singapore = formatConsoleMoment(MOMENT, settings({ timeZone: "Asia/Singapore" }), "hourMinute");
    const utc = formatConsoleMoment(MOMENT, settings({ timeZone: "UTC" }), "hourMinute");
    expect(zurich).toBe("00:30");
    expect(singapore).toBe("06:30");
    expect(utc).toBe("22:30");
    expect(new Set([zurich, singapore, utc]).size).toBe(3);
  });

  it("puts a moment at a day boundary on the day the chosen zone is on", () => {
    // 22:30 UTC am 24. ist in Zuerich schon der 25., in New York noch der 24.
    // Genau diese Zeile stand vor 2.55 in jedem Log, und welcher Tag sie
    // trug, entschied der Browser des Betrachters.
    const day = (timeZone: string) =>
      formatConsoleMoment(MOMENT, settings({ timeZone }), "dateShort");
    expect(day("Europe/Zurich")).toBe("25.09.26");
    expect(day("UTC")).toBe("24.09.26");
    expect(day("America/New_York")).toBe("24.09.26");
    expect(day("Australia/Sydney")).toBe("25.09.26");
    // Und mit dem Format einer anderen Sprache derselbe Tag, andere Schreibweise.
    expect(formatConsoleMoment(MOMENT, settings({ formatLocale: "en-US", timeZone: "Europe/Zurich" }), "dateShort"))
      .toBe("9/25/26");
  });

  it("keeps a calendar day as it is, because it carries no time zone", () => {
    for (const timeZone of ["Europe/Zurich", "UTC", "Australia/Sydney", CONSOLE_DISPLAY_INHERIT]) {
      expect(formatConsoleDay("2026-09-24", settings({ timeZone }))).toBe("2026-09-24");
    }
    expect(formatConsoleDay("2026-09-24T22:30:15.000Z", settings())).toBe("2026-09-24");
    expect(formatConsoleDay("irgendetwas", settings())).toBe("irgendetwas");
  });

  it("groups a decimal string as BigInt and leaves anything else alone", () => {
    expect(formatConsoleCount("1234567", settings())).toBe(new Intl.NumberFormat("de-CH").format(1_234_567n));
    expect(formatConsoleCount("123456789012345678901234567890", settings()))
      .toBe(new Intl.NumberFormat("de-CH").format(123456789012345678901234567890n));
    expect(formatConsoleCount("nicht-zaehlbar", settings())).toBe("nicht-zaehlbar");
  });

  it("names the zone it is calculating in", () => {
    expect(resolvedConsoleTimeZone(settings({ timeZone: "Asia/Singapore" }))).toBe("Asia/Singapore");
    expect(resolvedConsoleTimeZone(settings()))
      .toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("follows the locale cookie until a language is chosen", () => {
    expect(resolvedConsoleLanguage(settings(), "fr")).toBe("fr");
    expect(resolvedConsoleLanguage(settings({ language: "it" }), "fr")).toBe("it");
  });

  it("leaves the money rules of 2.37 untouched whatever the display says", () => {
    // Geld haengt am Ledger, nicht am Betrachter. Die Regel steht in
    // `lib/console/money` und wird von diesem Slice nicht angefasst; dieser
    // Fall ist die Gegenprobe dazu.
    const group = (value: bigint) => new Intl.NumberFormat("de-CH").format(value);
    expect(formatMoneyMicros("12349999", "CHF")).toBe("CHF 12.34");
    expect(formatMoneyMicros("-12999999", "CHF")).toBe("CHF -12.99");
    expect(formatMoneyMicros("1234567890000", "CHF")).toBe(`CHF ${group(1_234_567n)}.89`);
    expect(formatUnitPriceMicros("250", "CHF")).toBe("CHF 0.00025");
    expect(formatMoneyMicros("0.025000", "CHF")).toBe("CHF –");
  });

  it("reproduces the output of every place that formatted before 2.55", () => {
    const now = CONSOLE_DISPLAY_DEFAULTS;
    const date = new Date(MOMENT);

    // api-keys-view, console-app (Nutzerliste, API-Keys): Intl ohne Optionen.
    expect(formatConsoleMoment(MOMENT, now, "date"))
      .toBe(new Intl.DateTimeFormat("de-CH").format(date));
    // auth-series-view, usage-series-view: nur das kurze Datum.
    expect(formatConsoleMoment(MOMENT, now, "dateShort"))
      .toBe(new Intl.DateTimeFormat("de-CH", { dateStyle: "short" }).format(date));
    // Die grosse Mehrheit: kurzes Datum, kurze Uhrzeit.
    expect(formatConsoleMoment(MOMENT, now, "dateTime"))
      .toBe(new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "short" }).format(date));
    // Die Protokolle und die Berater: mit Sekunden.
    expect(formatConsoleMoment(MOMENT, now, "dateTimeSeconds"))
      .toBe(new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "medium" }).format(date));
    // realtime-inspector-view: nur die Uhrzeit.
    expect(formatConsoleMoment(MOMENT, now, "time"))
      .toBe(new Intl.DateTimeFormat("de-CH", { timeStyle: "medium" }).format(date));
    // console-app formatTime: Stunde und Minute.
    expect(formatConsoleMoment(MOMENT, now, "hourMinute"))
      .toBe(new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(date));

    // Jede gruppierte Zahl.
    for (const value of [0, 7, 1024, 1_234_567, 987_654_321]) {
      expect(formatConsoleNumber(value, now)).toBe(new Intl.NumberFormat("de-CH").format(value));
    }
    // console-app: toLocaleString("de-CH").
    expect(formatConsoleNumber(1_234_567, now)).toBe((1_234_567).toLocaleString("de-CH"));
    // database-report-view: der Prozentsatz.
    expect(formatConsolePercent(0.9876, now))
      .toBe(new Intl.NumberFormat("de-CH", { style: "percent", maximumFractionDigits: 1 }).format(0.9876));

    // Die drei Byte-Formatierer riefen `toFixed`; ihr Wert liegt immer unter
    // 1024, darum faellt die fehlende Gruppierung nicht auf.
    for (const value of [1, 1.5, 9.99, 10, 512.125, 1023.9]) {
      expect(formatConsoleDecimal(value, now, 1), String(value)).toBe(value.toFixed(1));
      expect(formatConsoleDecimal(value, now, 2), String(value)).toBe(value.toFixed(2));
    }
    // Die Vorgabe setzt keine Zone, rechnet also wie vor 2.55 in der der Laufzeit.
    expect(now.timeZone).toBe(CONSOLE_DISPLAY_INHERIT);
    expect(formatConsoleMoment(MOMENT, now, "dateTimeSeconds"))
      .toBe(new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "medium" }).format(date));
  });
});
