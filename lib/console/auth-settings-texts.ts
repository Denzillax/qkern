/**
 * Die Texte der drei Auth-Seiten rund um die Anmeldung (2.54), deutsch und an
 * einer Stelle: URL-Konfiguration, SMTP und E-Mail-Vorlagen.
 *
 * Gleiche Bauart wie `auth-mfa-texts` (2.52): Der Schluessel ist der deutsche
 * Text, die Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden
 * Text en, fr und it. Ein eigenes Modul braucht es, weil die Ansichten
 * `t(variable)` aufrufen und ein Text hinter einer Variablen durch die Suche
 * nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Drei Platzhalter verschwinden hier, und zwei davon werden nicht zu einer
 * Einstellung, sondern zu einer ehrlichen Auskunft. Das ist Absicht: Ein
 * Formular, das ins Leere schriebe, waere schlimmer als die Wahrheit.
 */

/* ------------------------------------------------------------------ *
 * Ruecksprungziele (auth-url)
 * ------------------------------------------------------------------ */

/** Was ein Ruecksprungziel ueberhaupt ist und wo es greift. */
export const AUTH_RETURN_TARGETS_WHAT =
  "Ein Rücksprungziel ist der Ort, an den ein Magic Link, eine Bestätigungsmail oder ein OIDC-Flow den Nutzer zurückschickt. Die Liste gilt für diese Projektumgebung; jeder Eintrag ist eine exakte Herkunft aus Schema, Host und Port, ohne Pfad und ohne Platzhalter.";

/** Die Richtung: verengen, nie weiten. Der wichtigste Satz dieser Seite. */
export const AUTH_RETURN_TARGETS_NARROWING =
  "Diese Liste kann die äussere Grenze des Betriebs nur verengen, nie weiten. Die äussere Grenze steht in der Umgebung des Prozesses und ist aus der Console nicht erreichbar; ein Eintrag ausserhalb wird abgelehnt und nicht etwa still weggelassen.";

/** Was eine leere Liste bedeutet. */
export const AUTH_RETURN_TARGETS_EMPTY =
  "Eine leere Liste verengt nichts: Dann gilt genau die äussere Grenze. Das ist der Zustand, in dem jede Umgebung startet, und er ist nicht schwächer als vorher — er ist genau das bisherige Verhalten.";

/** Die Form, die ein Eintrag haben muss. */
export const AUTH_RETURN_TARGETS_FORM =
  "Erlaubt ist HTTPS, dazu HTTP nur auf einem lokalen Entwicklungshost. Zugangsdaten in der Adresse, ein Pfad, eine Abfrage, ein Fragment und jeder Stern werden abgelehnt. Doppelte Einträge fallen weg.";

/** Wo die Prüfung wirklich passiert, und was QKERN nicht tut. */
export const AUTH_RETURN_TARGETS_WHERE =
  "Geprüft wird im Anmeldedienst, bevor ein Ziel gespeichert oder versendet wird. QKERN leitet selbst nie auf ein Rücksprungziel um; der Wert wandert als Parameter in den Link der Aktionsmail und in den verschlüsselten OIDC-Zustand, und beide Wege führen durch dieselbe Prüfung.";

/** Dass das Ändern der Liste ein Schreibzugriff mit Spur ist. */
export const AUTH_RETURN_TARGETS_AUDIT =
  "Jede Änderung dieser Liste ist ein Schreibzugriff und hinterlässt einen Eintrag in der Audit-Kette der Plattform, mit der Anzahl der Ziele danach und der ID des Console-Nutzers, nie mit seiner Adresse.";

/** Die Warnung vor dem Speichern. */
export const AUTH_RETURN_TARGETS_WARNING =
  "Speichern ersetzt die Liste ganz und wirkt sofort für diese Umgebung. Wer eine Herkunft entfernt, an die eine laufende Anwendung zurückspringt, bekommt dort ab sofort eine abgelehnte Anfrage statt einer Anmeldung.";

/** Warum ein Eintrag abgelehnt wurde, je Grund ein Satz. */
export const AUTH_RETURN_TARGET_REJECTIONS = {
  not_a_string: "Das ist kein Text.",
  empty: "Der Eintrag ist leer.",
  too_long: "Der Eintrag ist länger als 255 Zeichen.",
  wildcard: "Ein Stern ist kein Rücksprungziel; Platzhalter gibt es hier nicht.",
  not_a_url: "Das ist keine gültige Adresse.",
  not_an_origin: "Das ist keine reine Herkunft; ein Pfad, eine Abfrage, ein Fragment oder ein Schrägstrich am Ende gehört nicht dazu.",
  insecure_scheme: "Nur HTTPS ist erlaubt, ausser auf einem lokalen Entwicklungshost.",
  carries_credentials: "Die Adresse trägt Zugangsdaten.",
  outside_outer_bound: "Diese Herkunft liegt ausserhalb der äusseren Grenze des Betriebs. Die Liste kann nur verengen.",
  too_many: "Mehr als zwanzig Ziele sind nicht erlaubt.",
} as const;

export type AuthReturnTargetRejectionId = keyof typeof AUTH_RETURN_TARGET_REJECTIONS;

/* ------------------------------------------------------------------ *
 * SMTP (auth-smtp)
 * ------------------------------------------------------------------ */

/** Der Kernsatz: die Einstellung liegt nicht hier. */
export const AUTH_SMTP_HONESTY =
  "Diese Seite liest nur. Der Mailweg von Project Auth steht in der Umgebung des Prozesses, nicht in der Datenbank und nicht je Projekt; der Dienst liest die Werte beim Start und baut daraus seinen Adapter. Ein Formular hier hätte nichts, wohin es schreiben könnte.";

/** Was die Seite ausdrücklich nicht zeigt. */
export const AUTH_SMTP_NO_SECRET =
  "Das Passwort des Mailkontos verlässt den Server nie, auch nicht gekürzt, und es gibt keine zusammengesetzte Verbindungszeichenkette. Gezeigt wird nur, ob sich der Dienst überhaupt anmeldet.";

/** Wie man es ändert. */
export const AUTH_SMTP_HOW_TO_CHANGE =
  "Geändert wird über die Umgebungsvariablen mit dem Präfix QKERN_PROJECT_AUTH_SMTP und die Aktionsadresse QKERN_PROJECT_AUTH_ACTION_BASE_URL. Die Werte greifen beim nächsten Start des Dienstes, nicht sofort.";

/** Was zertifiziert ist. */
export const AUTH_SMTP_CERTIFIED =
  "Der SMTP-Weg ist gegen einen echten Mailserver zertifiziert: Im Zertifizierungsstack nimmt Mailpit die Nachricht entgegen, und der Test holt das Aktionstoken ausschliesslich aus der wirklich zugestellten Nachricht.";

/** Die drei Betriebsarten, als Wort. */
export const AUTH_SMTP_MODE_TEXTS = {
  smtp: "Mails gehen über einen konfigurierten Mailserver hinaus",
  development_noop: "Mails gehen nirgendwohin; die Entwicklungs-Abkürzung gibt das Token direkt zurück",
  disabled: "Kein Mailweg eingerichtet; der Dienst gibt gar kein Aktionstoken aus",
} as const;

export type AuthSmtpModeId = keyof typeof AUTH_SMTP_MODE_TEXTS;

/** Woher ein Wert stammt. */
export const AUTH_SMTP_ORIGIN_TEXTS = {
  environment: "aus der Umgebung",
  default: "Vorgabe des Dienstes",
  unset: "nicht gesetzt",
} as const;

export type AuthSmtpOriginId = keyof typeof AUTH_SMTP_ORIGIN_TEXTS;

/** Die Zeilen der Lesetabelle. Kein Passwort, keine Verbindungszeichenkette. */
export const AUTH_SMTP_FIELD_TEXTS = {
  host: "Mailserver",
  port: "Port",
  security: "Transportsicherheit",
  sender: "Absender",
  actionBaseUrl: "Aktionsadresse",
} as const;

export type AuthSmtpFieldId = keyof typeof AUTH_SMTP_FIELD_TEXTS;

/* ------------------------------------------------------------------ *
 * Vorlagen (auth-templates)
 * ------------------------------------------------------------------ */

/** Der Kernsatz: es gibt keine Vorlagen zum Bearbeiten. */
export const AUTH_TEMPLATES_HONESTY =
  "Es gibt heute keine bearbeitbaren Vorlagen. Die drei Aktionsmails haben einen festen Text im Quelltext; diese Seite zeigt ihn, damit man weiss, was hinausgeht, und sie zeigt ihn aus derselben Funktion, die ihn versendet.";

/** Wie man ihn ändert. */
export const AUTH_TEMPLATES_HOW_TO_CHANGE =
  "Ändern heisst heute: Quelltext ändern und ausliefern. Ein Editor an dieser Stelle würde in nichts schreiben, und ein gespeicherter Text hätte keine Wirkung auf eine einzige Mail.";

/** Dass es nur eine Sprache gibt. */
export const AUTH_TEMPLATES_ONE_LANGUAGE =
  "Es gibt genau eine Sprachfassung, Englisch. Sprachvarianten je Nutzer oder je Projekt gibt es nicht; die Console spricht vier Sprachen, die Aktionsmails nicht.";

/** Was am Link wirklich variabel ist. */
export const AUTH_TEMPLATES_WHAT_VARIES =
  "Veränderlich sind allein die Aktionsadresse, das einmalige Token, die Art der Aktion, das Rücksprungziel und der Zeitpunkt des Ablaufs. Der gezeigte Link ist ein Beispiel; ein echtes Token steht hier nie.";

/** Der Zweck einer Mail, als Wort. */
export const AUTH_TEMPLATE_PURPOSE_TEXTS = {
  email_verification: "Adresse bestätigen",
  magic_link: "Magic Link",
  password_reset: "Passwort zurücksetzen",
} as const;

export type AuthTemplatePurposeId = keyof typeof AUTH_TEMPLATE_PURPOSE_TEXTS;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authSettingsTexts(): string[] {
  return [
    AUTH_RETURN_TARGETS_WHAT,
    AUTH_RETURN_TARGETS_NARROWING,
    AUTH_RETURN_TARGETS_EMPTY,
    AUTH_RETURN_TARGETS_FORM,
    AUTH_RETURN_TARGETS_WHERE,
    AUTH_RETURN_TARGETS_AUDIT,
    AUTH_RETURN_TARGETS_WARNING,
    AUTH_SMTP_HONESTY,
    AUTH_SMTP_NO_SECRET,
    AUTH_SMTP_HOW_TO_CHANGE,
    AUTH_SMTP_CERTIFIED,
    AUTH_TEMPLATES_HONESTY,
    AUTH_TEMPLATES_HOW_TO_CHANGE,
    AUTH_TEMPLATES_ONE_LANGUAGE,
    AUTH_TEMPLATES_WHAT_VARIES,
    ...Object.values(AUTH_RETURN_TARGET_REJECTIONS),
    ...Object.values(AUTH_SMTP_MODE_TEXTS),
    ...Object.values(AUTH_SMTP_ORIGIN_TEXTS),
    ...Object.values(AUTH_SMTP_FIELD_TEXTS),
    ...Object.values(AUTH_TEMPLATE_PURPOSE_TEXTS),
  ];
}
