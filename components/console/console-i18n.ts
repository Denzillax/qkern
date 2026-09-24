import { CONSOLE_TRANSLATIONS } from "@/lib/i18n/console";
import type { Locale } from "@/lib/i18n/locales";

/**
 * Übersetzung der Console (2.3). Der Schlüssel ist der deutsche Text, wie
 * er im Code steht; Deutsch ist damit die Vorlage und kann nie fehlen.
 * Fehlt eine Übersetzung, bleibt der deutsche Text, und der Vertrag
 * `console-i18n-contract` schlägt an.
 *
 * Die aktive Sprache liegt in einer Modulvariablen, die `ConsoleApp` zu
 * Beginn jedes Renderns setzt. Das ist bewusst kein Context: Die Console
 * besteht aus rund dreissig kleinen Komponenten, die `t` direkt aufrufen,
 * und React rendert einen Baum synchron von oben nach unten, also sieht
 * jede von ihnen die Sprache, die der Wurzel gerade übergeben wurde.
 */
let active: Locale = "de";

export function setConsoleLocale(locale: Locale): void {
  active = locale;
}

export function consoleLocale(): Locale {
  return active;
}

export function t(key: string): string {
  if (active === "de") return key;
  return CONSOLE_TRANSLATIONS[active][key] ?? key;
}
