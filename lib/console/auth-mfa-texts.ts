/**
 * Die Texte von Auth → Mehrfaktor (2.52), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `auth-observability-texts` (2.47) und
 * `realtime-texts` (2.48): Der Schluessel ist der deutsche Text, die Console
 * uebersetzt ihn ueber ihren Katalog, und der Vertrag `console-i18n-contract`
 * liest diese Tabellen mit und verlangt fuer jeden Text en, fr und it. Ein
 * eigenes Modul braucht es, weil die Ansicht `t(variable)` aufruft und ein
 * Text hinter einer Variablen durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der wichtigste Teil sind die drei Ehrlichkeitssaetze. Der Platzhalter
 * versprach bis 2.52 "Erzwingen je Projekt und weitere Faktoren fehlen".
 * Erzwingen gibt es jetzt; weitere Faktoren gibt es weiterhin nicht, und
 * genau das sagt die Seite auch.
 */

/** Was das Erzwingen wirklich tut, und an welchen Stellen es greift. */
export const AUTH_MFA_ENFORCEMENT_HONESTY =
  "Ist der Schalter an, ergibt eine Anmeldung ohne zweiten Faktor keine brauchbare Sitzung. Geprüft wird an drei Stellen: bei der Anmeldung selbst, beim Erneuern eines Refresh Tokens und bei jeder Prüfung eines Access Tokens.";

/** Was mit einem Nutzer geschieht, der noch keinen Faktor hat. */
export const AUTH_MFA_WITHOUT_FACTOR =
  "Wer noch keinen bestätigten Faktor hat, bekommt bei der Anmeldung keine Sitzung, sondern einen Einrichtungsschein. Der gilt 15 Minuten und öffnet einzig die Einrichtung des zweiten Faktors. Ohne diesen Weg würde das Einschalten jeden aussperren, der noch keinen Faktor hat.";

/** Was es an Faktoren gibt, und was es nicht gibt. */
export const AUTH_MFA_ONLY_TOTP =
  "Als zweiter Faktor gibt es heute genau einen: TOTP aus einer Authenticator-App, mit einmaligen Recovery-Codes. WebAuthn, Passkeys, SMS und E-Mail-Codes gibt es nicht, und dieser Schalter bringt sie nicht mit.";

/** Die Warnung vor dem Einschalten, vollständig und ohne Beschönigung. */
export const AUTH_MFA_ENABLE_WARNING =
  "Einschalten wirkt sofort und für jeden App-Nutzer dieser Umgebung. Bestehende Sitzungen ohne zweiten Faktor hören auf zu gelten, sobald ihr Access Token geprüft wird; ihre ganze Refresh-Familie wird beim nächsten Erneuern widerrufen. Eine laufende Anwendung sieht das als abgelaufene Anmeldung.";

/** Was das Ausschalten bedeutet. */
export const AUTH_MFA_DISABLE_WARNING =
  "Ausschalten nimmt die Pflicht weg, nicht die Faktoren. Wer einen bestätigten Faktor hat, wird weiterhin danach gefragt; wer keinen hat, kommt wieder ohne hinein.";

/** Was diese Seite ausdrücklich nicht kann. */
export const AUTH_MFA_CANNOT_DO =
  "Diese Seite richtet keinen Faktor ein und setzt keinen zurück. Ein Geheimnis und die Recovery-Codes sieht nur der Nutzer selbst, einmal, in seiner eigenen Anwendung; die Console bekommt sie nie zu sehen.";

/** Der Zustand des Schalters, als Wort. */
export const AUTH_MFA_STATE_TEXTS = {
  required: "Zweiter Faktor wird verlangt",
  optional: "Zweiter Faktor ist freiwillig",
} as const;

export type AuthMfaStateId = keyof typeof AUTH_MFA_STATE_TEXTS;

/** Die Faktoren, die es gibt. Heute genau einer. */
export const AUTH_MFA_FACTOR_TEXTS = {
  totp: "TOTP aus einer Authenticator-App",
} as const;

export type AuthMfaFactorId = keyof typeof AUTH_MFA_FACTOR_TEXTS;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authMfaTexts(): string[] {
  return [
    AUTH_MFA_ENFORCEMENT_HONESTY,
    AUTH_MFA_WITHOUT_FACTOR,
    AUTH_MFA_ONLY_TOTP,
    AUTH_MFA_ENABLE_WARNING,
    AUTH_MFA_DISABLE_WARNING,
    AUTH_MFA_CANNOT_DO,
    ...Object.values(AUTH_MFA_STATE_TEXTS),
    ...Object.values(AUTH_MFA_FACTOR_TEXTS),
  ];
}
