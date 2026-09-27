/**
 * Die Texte der Seite Auth → Auth-Leistung (2.71), deutsch und an einer
 * Stelle.
 *
 * Gleiche Bauart wie `auth-observability-texts` (2.47): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabelle mit und verlangt fuer
 * jeden Text en, fr und it. Das eigene Modul braucht es, weil die Ansicht
 * `t(variable)` aufruft und ein Text hinter einer Variablen durch die Suche
 * nach `t("...")` faellt.
 *
 * Der wichtigste Teil sind die drei Saetze unten. Der Platzhalter dieser Seite
 * versprach bis 2.71 "Antwortzeiten und Fehlerraten der Anmeldung". Die
 * Fehlerrate gibt es wirklich; die Antwortzeit gibt es nicht, und zwar nicht
 * aus Nachlaessigkeit: Die Audit-Kette haelt je Handlung einen Zeitpunkt, eine
 * Art, einen Ausgang und eine Referenz. Eine Dauer braeuchte zwei Zeitpunkte
 * derselben Handlung, und der zweite wird nirgends geschrieben.
 */

/** Warum auf dieser Seite keine Millisekunde steht. */
export const AUTH_PERFORMANCE_NO_DURATION =
  "QKERN misst keine Antwortzeiten der Anmeldung. Ein Audit-Eintrag hält den Zeitpunkt einer Handlung fest, ihre Art, ihren Ausgang und eine Referenz, aber keine Dauer. Diese Seite zeigt darum keine Millisekunden, auch keine geschätzten.";

/** Was die Seite stattdessen zeigt, und woher es kommt. */
export const AUTH_PERFORMANCE_SOURCE =
  "Gezeigt wird, was der Anmeldedienst protokolliert hat: wie viele Handlungen je Abschnitt, je Art, und wie viele davon gescheitert sind. Dieselbe Reihe liegt unter Berichte → Auth, dort nach Zeit, hier nach Fehlschlag.";

/** Der Satz gegen den Kurzschluss "Fehlversuch heisst Angriff". */
export const AUTH_PERFORMANCE_NOT_AN_ATTACK =
  "Eine gescheiterte Anmeldung ist kein Angriff. Ein vertipptes Passwort, ein abgelaufener Code, eine Uhr, die falsch geht, oder eine App, die es nach dem Abmelden noch einmal versucht: All das steht hier als Fehlschlag, genau wie der Versuch, der wirklich einer war.";

/** Was die Seite ueber die Ursache ausdruecklich nicht sagen kann. */
export const AUTH_PERFORMANCE_CANNOT_SHOW =
  "Warum eine Handlung gescheitert ist, steht in keinem Eintrag: kein Grund, kein Fehlercode, keine Adresse, kein Gerät, kein Ort. Die Seite sagt, dass etwas gescheitert ist, wie oft und seit wann. Wer scheiterte und woran, sagt sie nicht, und sie kann es auch nicht nachträglich erfahren.";

/** Der Hinweis am Rand des Fensters. */
export const AUTH_PERFORMANCE_WINDOW_EDGE =
  "Fällt ein „seit“ auf den ersten Abschnitt des Fensters, kann es früher angefangen haben. Weiter zurück als das Fenster liest diese Seite nicht.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authPerformanceTexts(): string[] {
  return [
    AUTH_PERFORMANCE_NO_DURATION,
    AUTH_PERFORMANCE_SOURCE,
    AUTH_PERFORMANCE_NOT_AN_ATTACK,
    AUTH_PERFORMANCE_CANNOT_SHOW,
    AUTH_PERFORMANCE_WINDOW_EDGE,
  ];
}
