/**
 * Die Texte von Auth → Zustimmungen (2.93), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `auth-oauth-server-texts` (2.82): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der
 * Vertrag `console-i18n-contract` liest diese Tabelle mit und verlangt fuer
 * jeden Text en, fr und it.
 *
 * Was hier steht und was nicht: Die Saetze ueber die Zustimmung selbst stehen
 * weiterhin in `auth-oauth-server-texts` und werden von dort geholt. Diese
 * Datei traegt nur, was diese Seite hinzufuegt, also die Liste je Nutzer, die
 * ausgegebenen Token und den Unterschied zwischen den drei Widerrufen.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 */

/* ------------------------------------------------------------------ *
 * Was diese Seite ist
 * ------------------------------------------------------------------ */

/** Wozu die Seite da ist. */
export const AUTH_CONSENTS_WHAT =
  "Diese Seite zeigt je Nutzer, welcher Anwendung er was erlaubt hat und was mit dieser Erlaubnis gerade offen ist. Die Zustimmungen stehen als Zeilen in der Datenbank, die ausgegebenen Token daneben, und beides lässt sich hier einzeln zurücknehmen.";

/** Wessen Seite das ist, und wessen nicht. */
export const AUTH_CONSENTS_OPERATOR_VIEW =
  "Diese Seite liest der Betreiber. Ein Nutzer sieht seine eigenen Erlaubnisse in QKERN nirgends, denn dafür bräuchte es eine Seite hinter seiner eigenen Anmeldung im Browser, und die gibt es nicht. Wer seinen Nutzern eine solche Übersicht schuldet, baut sie in seiner Anwendung über die Route, die diese Zeilen liefert.";

/** Wie die Liste geordnet ist. */
export const AUTH_CONSENTS_GROUPED_BY_USER =
  "Geordnet ist die Liste nach Nutzer, weil die Frage fast immer von einem Nutzer ausgeht: Was hat dieser Mensch erlaubt? Auf der Seite des OAuth-Servers steht dieselbe Menge nach Client geordnet, und beide lesen dieselbe Antwort derselben Route.";

/* ------------------------------------------------------------------ *
 * Die drei Widerrufe
 * ------------------------------------------------------------------ */

/** Drei Knoepfe nehmen drei verschiedene Dinge zurueck. */
export const AUTH_CONSENTS_THREE_REVOCATIONS =
  "Drei Knöpfe nehmen hier und auf der Seite des OAuth-Servers etwas zurück, und sie treffen drei verschiedene Mengen. Ein Token trifft genau diesen einen Zugang. Eine Zustimmung trifft alle Token dieser Erlaubnis und verbietet neue. Das Entfernen des Clients trifft alles, was diese Anwendung je bekommen hat, von jedem Nutzer.";

/* ------------------------------------------------------------------ *
 * Die ausgegebenen Token
 * ------------------------------------------------------------------ */

/** Was in der Tokenliste steht. */
export const AUTH_CONSENTS_TOKENS_WHAT =
  "Unter jeder Zustimmung stehen die Token, die auf ihr ausgegeben wurden: wann, bis wann, und zu welchen Bereichen. Das Token selbst steht nicht dabei und auch nicht seine Prüfsumme. Aus dieser Liste lässt sich keine Anfrage bauen.";

/** Warum abgelaufene Zeilen mitstehen. */
export const AUTH_CONSENTS_TOKENS_EXPIRED_SHOWN =
  "Abgelaufene Token stehen mit da und sind an ihrem Ablauf zu erkennen. Sie gelten nicht mehr, denn die Prüfung sieht auf die Uhr, aber ihre Zeilen sind bis zum Aufräumer wirklich noch vorhanden. Sie wegzulassen hiesse, eine Liste zu zeigen, die weniger enthält als die Tabelle.";

/** Was der Widerruf eines Tokens tut. */
export const AUTH_CONSENTS_TOKEN_REVOKE_IS_A_DELETE =
  "Der Widerruf eines Tokens löscht seine Zeile, und das ist der Unterschied zum Widerruf einer Zustimmung. Ein Token gilt, weil eine Zeile existiert; fällt die Zeile, gilt es ab der nächsten Anfrage nicht mehr. Eine Spalte für den Widerruf wäre eine zusätzliche Bedingung im heissen Weg, die jemand vergessen kann.";

/** Und was er ausdruecklich nicht tut. */
export const AUTH_CONSENTS_TOKEN_REVOKE_KEEPS_CONSENT =
  "Die Zustimmung bleibt dabei gültig. Wer ein Token zurückzieht, sagt, dass dieses Geheimnis nichts mehr taugt, und die Anwendung darf sich mit derselben Erlaubnis ein neues holen. Wer das verhindern will, widerruft die Zustimmung.";

/** Die Spur, die ein Widerruf hinterlaesst. */
export const AUTH_CONSENTS_TOKEN_REVOKE_TRACE =
  "Weg ist danach nur der Zugang. Die Zustimmung steht weiter da, mit Nutzer, Bereichen und Zeitpunkt, und der Widerruf schreibt eine Zeile ins Audit-Log mit dem Betreiber, der ihn ausgelöst hat.";

/** Der Rand der Tokenliste. */
export const AUTH_CONSENTS_TOKENS_TRUNCATED =
  "Es gibt mehr ausgegebene Token, als diese Seite zeigt. Die Liste ist abgeschnitten, und das steht hier, weil eine Liste, die stillschweigend endet, die unehrlichste Form von Vollständigkeit wäre.";

/** Was diese Seite ueber die Benutzung eines Tokens nicht sagt. */
export const AUTH_CONSENTS_NO_USAGE =
  "Wann ein Token zuletzt benutzt wurde, steht hier nicht. Die Prüfung schreibt den Zeitpunkt nirgends hin, also gibt es diese Angabe nicht.";

/** Der Weg auf die Seite des OAuth-Servers. */
export const AUTH_CONSENTS_SEE_OAUTH_SERVER =
  "Die Clients, die Bereiche, der Ablauf und seine Grenzen stehen unter Auth → OAuth-Server. Dort wird eine Anwendung hinterlegt und dort wird sie entfernt.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authOAuthConsentsTexts(): string[] {
  return [
    AUTH_CONSENTS_WHAT,
    AUTH_CONSENTS_OPERATOR_VIEW,
    AUTH_CONSENTS_GROUPED_BY_USER,
    AUTH_CONSENTS_THREE_REVOCATIONS,
    AUTH_CONSENTS_TOKENS_WHAT,
    AUTH_CONSENTS_TOKENS_EXPIRED_SHOWN,
    AUTH_CONSENTS_TOKEN_REVOKE_IS_A_DELETE,
    AUTH_CONSENTS_TOKEN_REVOKE_KEEPS_CONSENT,
    AUTH_CONSENTS_TOKEN_REVOKE_TRACE,
    AUTH_CONSENTS_TOKENS_TRUNCATED,
    AUTH_CONSENTS_NO_USAGE,
    AUTH_CONSENTS_SEE_OAUTH_SERVER,
  ];
}
