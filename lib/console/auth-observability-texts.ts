/**
 * Die Texte der beiden Auth-Berichte (2.47), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `usage-series-texts` (2.45) und `health-advisor-texts`
 * (2.44): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn
 * ueber ihren Katalog, und der Vertrag `console-i18n-contract` liest diese
 * Tabellen mit und verlangt fuer jeden Text en, fr und it. Das eigene Modul
 * braucht es, weil beide Ansichten `t(variable)` aufrufen und ein Text hinter
 * einer Variablen durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Die beiden Ehrlichkeitssaetze sind der wichtigste Teil. Die Platzhalter
 * dieser Seiten versprachen bis 2.47 "ausgegebene Token ueber die Zeit" und
 * ein Log mit "Magic Links". Beides steht so nirgends. Das Audit kennt
 * Handlung, Ausgang und eine Referenz ohne Adresse; mehr sagen die Seiten
 * darum auch nicht.
 */

/**
 * Die Handlungen, die `ProjectAuthService` wirklich schreibt, aus dem Code
 * gelesen, nicht erfunden. Ein Refresh wird nicht protokolliert, das waere zu
 * viel Rauschen.
 *
 * Die Liste steht hier und nicht im Dienst, aus demselben Grund wie
 * `HEALTH_SUBSYSTEM_IDS` in `health-advisor-texts`: Der Server liest sie mit,
 * die Console braucht sie fuer die Beschriftung, und ein Eintrag ohne Text
 * faellt dann beim Typpruefen auf und nicht erst in der Ansicht.
 */
export const PROJECT_AUTH_AUDIT_ACTIONS = [
  "project_auth.signup.succeeded",
  "project_auth.login.succeeded",
  "project_auth.login.failed",
  "project_auth.logout",
  "project_auth.mfa.enrolled",
  "project_auth.mfa.verified",
  "project_auth.user.updated",
  "project_auth.session.revoked",
  "project_auth.sessions.revoked_all",
] as const;

export type ProjectAuthAuditAction = (typeof PROJECT_AUTH_AUDIT_ACTIONS)[number];

/**
 * `other` ist kein Versehen: In der Kette kann eine `project_auth.*`-Handlung
 * stehen, die diese Fassung noch nicht kennt: aus einer neueren Version oder
 * aus einem laengst geloeschten Zweig. Sie verschwinden zu lassen hiesse, die
 * Summe zu faelschen; sie stehen darum als eigene Gruppe da.
 */
export const PROJECT_AUTH_AUDIT_ACTION_IDS = [...PROJECT_AUTH_AUDIT_ACTIONS, "other"] as const;
export type ProjectAuthAuditActionId = (typeof PROJECT_AUTH_AUDIT_ACTION_IDS)[number];

/**
 * Die Beschriftung jeder Handlung. Dieselben deutschen Woerter wie im
 * Audit-Log unter Auth → Audit-Log (2.35), damit dieselbe Handlung in der
 * Console nicht zweimal verschieden heisst.
 */
export const AUTH_AUDIT_ACTION_TEXTS: Record<ProjectAuthAuditActionId, string> = {
  "project_auth.signup.succeeded": "Registrierung",
  "project_auth.login.succeeded": "Anmeldung",
  "project_auth.login.failed": "Fehlgeschlagene Anmeldung",
  "project_auth.logout": "Abmeldung",
  "project_auth.mfa.enrolled": "Zweiter Faktor eingerichtet",
  "project_auth.mfa.verified": "Zweiter Faktor bestätigt",
  "project_auth.user.updated": "Nutzer geändert",
  "project_auth.session.revoked": "Sitzung beendet",
  "project_auth.sessions.revoked_all": "Alle Sitzungen beendet",
  other: "Andere Handlung",
};

/** Was der Akteur einer Zeile ist, ohne je zu sagen, wer er ist. */
export const AUTH_LOG_ACTOR_TEXTS = {
  app_user: "App-Nutzer",
  admin: "Admin",
  system: "System",
  anonymous: "Unbekannt",
} as const;

export type AuthLogActorId = keyof typeof AUTH_LOG_ACTOR_TEXTS;

/** Der Satz ueber der Reihe unter Berichte → Auth. */
export const AUTH_SERIES_HONESTY =
  "Gezählt wird, was der Anmeldedienst protokolliert hat. Wer sich angemeldet hat, steht hier nicht.";

/** Der Satz ueber dem Protokoll unter Logs → Auth. */
export const AUTH_LOG_HONESTY =
  "Der Eintrag nennt die Handlung und ihren Ausgang. Adressen, Token und Schlüssel schreibt QKERN nie ins Protokoll.";

/**
 * Was diese Seiten ausdruecklich **nicht** zeigen koennen. Beide Platzhalter
 * versprachen mehr, als im Audit steht.
 */
export const AUTH_SERIES_CANNOT_SHOW =
  "Wie viele Token ausgegeben wurden, steht in keinem Audit-Eintrag: Eine Token-Ausgabe wird nicht protokolliert, ein Refresh ebenfalls nicht. Gezählt werden Registrierungen, Anmeldungen, Abmeldungen, Faktoren und Fehlversuche.";

export const AUTH_LOG_CANNOT_SHOW =
  "Ein Magic Link, eine E-Mail-Adresse oder ein TOTP-Code steht in keinem Eintrag. Ein per Magic Link bestätigter Zugang erscheint als Registrierung oder Anmeldung, nicht als Link.";

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authObservabilityTexts(): string[] {
  return [
    ...PROJECT_AUTH_AUDIT_ACTION_IDS.map((id) => AUTH_AUDIT_ACTION_TEXTS[id]),
    ...Object.values(AUTH_LOG_ACTOR_TEXTS),
    AUTH_SERIES_HONESTY,
    AUTH_LOG_HONESTY,
    AUTH_SERIES_CANNOT_SHOW,
    AUTH_LOG_CANNOT_SHOW,
  ];
}
