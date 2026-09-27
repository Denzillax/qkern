/**
 * Die Texte von Auth → Rate Limits (2.56), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `auth-mfa-texts` (2.52) und `auth-settings-texts`
 * (2.54): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn
 * ueber ihren Katalog, und der Vertrag `console-i18n-contract` liest diese
 * Tabellen mit und verlangt fuer jeden Text en, fr und it. Ein eigenes Modul
 * braucht es, weil die Ansicht `t(variable)` aufruft und ein Text hinter
 * einer Variablen durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Die Haelfte dieser Texte sagt, was eine Grenze **nicht** kann. Das ist
 * Absicht. Eine Seite, die nur "Schutz vor Missbrauch" sagt, laesst einen
 * Betreiber in dem Glauben, er sei gegen einen verteilten Angriff geschuetzt;
 * er ist es nicht, und er soll es hier lesen.
 */

/* ------------------------------------------------------------------ *
 * Was eine Grenze ist
 * ------------------------------------------------------------------ */

/** Was hier eingestellt wird, in einem Satz. */
export const AUTH_RATE_LIMITS_WHAT =
  "Eine Grenze besteht aus zwei Zahlen: wie viele Versuche ein Zeitfenster trägt und wie lang dieses Fenster ist. Beides gilt für diese Projektumgebung, und beides wird in der Datenbank gezählt, nicht im Speicher einer Instanz.";

/** Wonach gezählt wird — der wichtigste Satz dieser Seite. */
export const AUTH_RATE_LIMITS_KEY =
  "Gezählt wird nach der Identität, also nach der Adresse, mit der jemand sich anmeldet oder eine Mail anfordert, und bei der Token-Erneuerung nach der Sitzungsfamilie. Nicht nach IP-Adresse: Eine IP wechselt der Angreifer, und ein ganzes Büro teilt sich eine.";

/** Dass der Schlüssel gehasht in die Datenbank geht. */
export const AUTH_RATE_LIMITS_HASHED =
  "In der Zähltabelle steht nie eine Adresse und nie eine IP, sondern nur ein SHA-256 über Umgebung, Art und Schlüssel. Das ist ein Pseudonym, keine Anonymisierung: Wer eine Adresse vermutet, kann sie nachrechnen — mehr braucht ein Zähler nicht, und mehr steht dort auch nicht.";

/** Warum in der Datenbank gezählt wird. */
export const AUTH_RATE_LIMITS_WHERE =
  "Vor 2.56 zählte ein Zähler im Speicher des Prozesses. Bei einer Instanz war er richtig, bei zweien galt in Wahrheit das Doppelte der eingestellten Grenze, und ein Neustart setzte alles auf null. Seit 2.56 zählt PostgreSQL, und damit gilt dieselbe Grenze über alle Instanzen und über jeden Neustart hinweg.";

/** Wie das Fenster gerechnet wird. */
export const AUTH_RATE_LIMITS_WINDOW =
  "Das Fenster ist ein festes Raster, kein gleitendes Fenster: Es beginnt immer auf einem Vielfachen seiner Länge. Deshalb rechnen zwei Instanzen ohne jede Absprache denselben Fensteranfang aus und zählen in dieselbe Zeile. Wechselt das Fenster, beginnt die Zählung bei null.";

/** Was genau an der Grenze passiert. */
export const AUTH_RATE_LIMITS_BOUNDARY =
  "Die eingestellte Zahl sagt, wie viele Versuche ein Fenster trägt. Steht sie auf zehn, sind der neunte und der zehnte Versuch erlaubt und der elfte nicht. Abgewiesen wird mit 429 und einem Retry-After, das auf das Ende des laufenden Fensters zeigt.";

/** Was die Antwort verrät — nämlich nichts. */
export const AUTH_RATE_LIMITS_TELLS_NOTHING =
  "Die Antwort ist dieselbe für eine bekannte und eine unbekannte Adresse, weil gezählt wird, bevor irgendetwas nachgeschlagen wird. Aus einer Abweisung lässt sich deshalb nicht lesen, ob es das Konto gibt — nur, dass zu oft gefragt wurde.";

/** Fail closed auf der Grenze, fail open beim Zählerfehler. */
export const AUTH_RATE_LIMITS_FAILURE_MODE =
  "Auf der Grenze wird geschlossen, auf einem Fehler des Zählers geöffnet. Wer die Grenze erreicht, wird abgewiesen, ohne Ausnahme. Lässt sich der Zähler selbst nicht lesen oder schreiben, läuft der Versuch weiter zur Passwortprüfung: Der Zähler ist eine Schutzschicht, nicht die Tür, und ein Fehler in ihm soll nicht die ganze Anmeldung der Umgebung ausfallen lassen.";

/* ------------------------------------------------------------------ *
 * Was eine Grenze nicht kann
 * ------------------------------------------------------------------ */

/** Der ehrlichste Satz der Seite: verteilter Angriff. */
export const AUTH_RATE_LIMITS_NOT_DISTRIBUTED =
  "Eine Grenze je Identität schützt nicht gegen einen verteilten Angriff über viele Konten. Wer ein Passwort gegen zehntausend verschiedene Adressen probiert, bleibt bei jeder einzelnen unter der Grenze und wird von dieser Seite nicht aufgehalten. Dagegen hilft die Prüfung gegen bekannte Lecks unter Auth → Passwortschutz, und darüber hinaus ein Captcha oder eine Bot-Abwehr — zwei Dinge, die QKERN nicht hat.";

/** Was eine Grenze sonst noch nicht ist. */
export const AUTH_RATE_LIMITS_NOT_A_LOCKOUT =
  "Eine Grenze ist keine Kontosperre. Sie hält niemanden dauerhaft draussen, sondern nur bis zum nächsten Fenster; ein gesperrtes Konto stellt man unter Auth → Nutzer auf „deaktiviert“. Eine Grenze ist auch keine Zustellsperre: Sie begrenzt, wie oft eine Aktionsmail angefordert werden darf, nicht wie viele Mails der Mailweg verträgt.";

/** Wovor die Refresh-Grenze schützt und wovor nicht. */
export const AUTH_RATE_LIMITS_REFRESH_SCOPE =
  "Die Grenze für Token-Erneuerungen zählt je Sitzungsfamilie und greift erst, wenn ein Refresh Token zu einer echten Familie gehört. Ein zufällig geratenes Token wird schon davor abgelehnt und kommt beim Zähler gar nicht an; gegen das Raten von Refresh Tokens schützt ihre Länge, nicht diese Zahl.";

/** Die Warnung vor dem Speichern. */
export const AUTH_RATE_LIMITS_WARNING =
  "Speichern setzt alle drei Grenzen auf einmal und wirkt sofort für diese Umgebung. Eine zu kleine Zahl trifft zuerst die echten Nutzer: Wer sein Passwort dreimal falsch tippt, kommt bei einer Grenze von drei bis zum Ende des Fensters nicht mehr hinein, auch mit dem richtigen Passwort nicht.";

/** Dass jede Änderung eine Spur hinterlässt. */
export const AUTH_RATE_LIMITS_AUDIT =
  "Jede Änderung ist ein Schreibzugriff und hinterlässt einen Eintrag in der Audit-Kette der Plattform, mit den sechs Zahlen danach und der ID des Console-Nutzers, nie mit seiner Adresse. Greift eine Grenze, entsteht ein zweiter Eintrag — mit der Art, der Grenze und dem Fenster, ohne Schlüssel und ohne Adresse.";

/* ------------------------------------------------------------------ *
 * Die drei Arten
 * ------------------------------------------------------------------ */

/** Wie eine Art heisst. */
export const AUTH_RATE_LIMIT_KIND_TEXTS = {
  sign_in: "Anmeldeversuche",
  mail: "Mails an eine Adresse",
  refresh: "Token-Erneuerungen",
} as const;

/** Was eine Art zählt, je ein Satz. */
export const AUTH_RATE_LIMIT_KIND_NOTES = {
  sign_in: "Jeder Versuch, sich mit Adresse und Passwort anzumelden, gezählt je Adresse — auch der Versuch mit einer Adresse, die es nicht gibt.",
  mail: "Jede angeforderte Aktionsmail, gezählt je Adresse: Registrierung, Magic Link und Passwort zurücksetzen teilen sich diese eine Zahl.",
  refresh: "Jede Erneuerung eines Access Tokens, gezählt je Sitzungsfamilie, also je Anmeldung und nicht je Nutzer.",
} as const;

export type AuthRateLimitKindId = keyof typeof AUTH_RATE_LIMIT_KIND_TEXTS;

/** Warum eine eingegebene Grenze abgelehnt wurde, je Grund ein Satz. */
export const AUTH_RATE_LIMIT_REJECTIONS = {
  not_an_object: "Der Körper trägt keine Grenzen.",
  unknown_kind: "Diese Art von Grenze gibt es nicht.",
  missing_kind: "Diese Art fehlt; es müssen immer alle drei gesetzt werden.",
  max_not_an_integer: "Die Anzahl der Versuche muss eine ganze Zahl sein.",
  max_out_of_range: "Die Anzahl der Versuche liegt ausserhalb von eins bis zehntausend.",
  window_not_an_integer: "Die Länge des Fensters muss eine ganze Zahl in Sekunden sein.",
  window_out_of_range: "Die Länge des Fensters liegt ausserhalb von einer Minute bis einem Tag.",
} as const;

export type AuthRateLimitRejectionId = keyof typeof AUTH_RATE_LIMIT_REJECTIONS;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authRateLimitTexts(): string[] {
  return [
    AUTH_RATE_LIMITS_WHAT,
    AUTH_RATE_LIMITS_KEY,
    AUTH_RATE_LIMITS_HASHED,
    AUTH_RATE_LIMITS_WHERE,
    AUTH_RATE_LIMITS_WINDOW,
    AUTH_RATE_LIMITS_BOUNDARY,
    AUTH_RATE_LIMITS_TELLS_NOTHING,
    AUTH_RATE_LIMITS_FAILURE_MODE,
    AUTH_RATE_LIMITS_NOT_DISTRIBUTED,
    AUTH_RATE_LIMITS_NOT_A_LOCKOUT,
    AUTH_RATE_LIMITS_REFRESH_SCOPE,
    AUTH_RATE_LIMITS_WARNING,
    AUTH_RATE_LIMITS_AUDIT,
    ...Object.values(AUTH_RATE_LIMIT_KIND_TEXTS),
    ...Object.values(AUTH_RATE_LIMIT_KIND_NOTES),
    ...Object.values(AUTH_RATE_LIMIT_REJECTIONS),
  ];
}
