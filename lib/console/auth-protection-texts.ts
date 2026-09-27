/**
 * Die Texte von Auth → Passwortschutz (2.53), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `auth-rate-limits-texts` (2.56) und `auth-mfa-texts`
 * (2.52): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn
 * ueber ihren Katalog, und der Vertrag `console-i18n-contract` liest diese
 * Tabellen mit und verlangt fuer jeden Text en, fr und it. Ein eigenes Modul
 * braucht es, weil die Ansicht `t(variable)` aufruft und ein Text hinter einer
 * Variablen durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der Platzhalter, den diese Seite ersetzt, nannte drei Dinge: Captcha,
 * Passwortpruefung gegen bekannte Lecks, Bot-Abwehr. Gebaut ist eines davon.
 * Die Texte hier sagen das, und sie sagen auch, warum die anderen zwei nicht
 * hier stehen — nicht als Versprechen fuer spaeter, sondern als Beschreibung
 * dessen, was sie brauchen wuerden.
 */

/* ------------------------------------------------------------------ *
 * Was diese Seite tut
 * ------------------------------------------------------------------ */

/** Was hier eingestellt wird, in einem Satz. */
export const AUTH_PROTECTION_WHAT =
  "Diese Seite prüft neu gewählte Passwörter gegen eine Liste bekannter, aus Lecks stammender Passwörter und legt fest, ab welcher Länge ein Passwort überhaupt angenommen wird. Beides gilt für diese Projektumgebung und wird im Dienst durchgesetzt, nicht in der Console.";

/** Der Satz, um den es bei diesem Slice wirklich geht. */
export const AUTH_PROTECTION_NO_THIRD_PARTY =
  "Geprüft wird ausschliesslich lokal. QKERN schickt weder das Passwort noch ein Präfix seines Hashes an einen fremden Dienst, auch nicht an Have I Been Pwned: Das wäre technisch anständig gelöst, hiesse aber, dass jede Registrierung jedes Kunden dieser Installation samt Zeitpunkt an einen fremden Host geht. Diese Entscheidung darf ein Backend nicht für seine Nutzer treffen.";

/** Wo die Regel greift. */
export const AUTH_PROTECTION_WHERE =
  "Durchgesetzt wird an den beiden Stellen, an denen ein Passwort gesetzt wird: bei der Registrierung und beim Zurücksetzen über einen Mail-Link. Nicht in dieser Console und nicht in der Route, denn es gibt mehr als eine Tür zu diesen Stellen, und eine Regel, die an einer Tür hängt, ist keine Regel.";

/** Was verglichen wird. */
export const AUTH_PROTECTION_DIGESTS =
  "Verglichen wird nie das Passwort, sondern sein SHA-1- oder SHA-256-Digest gegen die Einträge der Liste. Eine Liste trägt vollständige Digests oder Präfixe davon; ein Treffer auf einem Präfix ist streng genommen ein möglicher Treffer, bei 16 Hexzeichen mit einer Kollisionswahrscheinlichkeit von 2^-64 je Eintrag.";

/** Was eine Ablehnung verrät. */
export const AUTH_PROTECTION_REVEALS =
  "Eine Ablehnung sagt, dass dieses Passwort aus bekannten Lecks stammt, und sonst nichts. Nicht, wie oft es vorkommt, nicht, aus welchem Leck, nicht, welcher Eintrag getroffen hat. Die ersten zwei Angaben kennt die Prüfung selbst nicht: In der Liste steht ein Digest und kein Zähler.";

/** Warum die Ablehnung überhaupt etwas sagen darf. */
export const AUTH_PROTECTION_WHY_NAMED =
  "Dass der Grund genannt werden darf, ist kein Versehen: Wer das Passwort gerade eingetippt hat, kennt es schon, und die Auskunft ist handelbar — er kann ein anderes wählen. Wem das zu viel ist, stellt den Wortlaut auf „nur die Regeln nennen“; die Ablehnung sagt dann lediglich, dass das Passwort den Regeln dieses Projekts nicht genügt.";

/** Dass das Passwort nirgends auftaucht. */
export const AUTH_PROTECTION_NEVER_LOGGED =
  "Das Passwort erscheint in keiner Logzeile, in keinem Fehlertext und in keinem Audit-Eintrag. Der Audit-Eintrag nennt den Grund, die Herkunft der Liste und ihre Grösse; der typisierte Fehler trägt einen Code und sonst nichts.";

/** Fail closed, und warum hier anders als beim Zähler. */
export const AUTH_PROTECTION_FAILURE_MODE =
  "Anders als der Zähler der Rate Limits öffnet diese Prüfung bei einem Fehler nicht. Der Zähler ist eine Schicht vor der Tür und darf im Zweifel durchlassen; hier wird entschieden, welches Passwort ein Konto bekommt, und ein Lesefehler auf den Einstellungen ist keine Erlaubnis.";

/** Dass jede Änderung eine Spur hinterlässt. */
export const AUTH_PROTECTION_AUDIT =
  "Jede Änderung ist ein Schreibzugriff und hinterlässt einen Eintrag in der Audit-Kette der Plattform: der Schalter, die Mindestlänge, der Wortlaut sowie Herkunft und Grösse der geltenden Liste, dazu die ID des Console-Nutzers, nie seine Adresse.";

/* ------------------------------------------------------------------ *
 * Die Liste
 * ------------------------------------------------------------------ */

/** Wie eine Installation eine echte Liste hinterlegt. */
export const AUTH_PROTECTION_LIST_FILE =
  "Eine Installation zeigt mit QKERN_PROJECT_AUTH_LEAKED_PASSWORD_FILE auf eine Textdatei: je Zeile ein Digest oder ein Präfix davon, in Hex, wahlweise gefolgt von einem Doppelpunkt und einer Zahl, die verworfen wird — das Format, in dem die bekannten Listen ausgeliefert werden. Leerzeilen und Zeilen mit einer Raute gelten als Kommentar, alle Einträge müssen dieselbe Länge haben, höchstens eine Million und höchstens 16 MiB.";

/** Was passiert, wenn die Datei fehlt oder kaputt ist. */
export const AUTH_PROTECTION_LIST_FAILURE =
  "Eine hinterlegte Datei gilt ganz oder gar nicht: Fehlt sie, ist sie zu gross oder trägt sie eine Zeile, die kein Präfix ist, startet Project Auth nicht. Still auf die eingebaute Liste zurückzufallen hiesse, eine eingeschaltete Prüfung weiterlaufen zu lassen, die nichts mehr prüft.";

/** Die eingebaute Liste, samt der unbequemen Hälfte. */
export const AUTH_PROTECTION_BUILT_IN =
  "Ohne Datei gilt die eingebaute Liste: 25 Einträge, nämlich die Ränge 1 bis 25 der jährlich veröffentlichten Liste „Worst Passwords of the Year 2019“ von SplashData. Keine erfundenen Einträge und keine behauptete Quelle. Eine echte Leckliste ist hunderte Megabyte gross und veraltet ab dem Tag des Commits; sie gehört nicht in dieses Repository.";

/** Und die Wahrheit darüber, was die eingebaute Liste bewirkt. */
export const AUTH_PROTECTION_BUILT_IN_HONESTY =
  "Alle 25 eingebauten Einträge sind kürzer als die zwölf Zeichen, die QKERN ohnehin verlangt. Ohne hinterlegte Datei lehnt die Prüfung deshalb nichts ab, was die Längenregel nicht schon ablehnt: Die eingebaute Liste gibt dem Schalter ein definiertes Verhalten, keinen Schutz. Wer wirklich gegen Lecks prüfen will, hinterlegt eine Datei.";

/** Was die Mindestlänge ist und was nicht. */
export const AUTH_PROTECTION_MIN_LENGTH =
  "Die Mindestlänge liegt zwischen 12 und 128 Zeichen. Nach unten ist bei 12 Schluss, weil der Dienst jedes kürzere Passwort seit jeher abweist; eine Einstellung, die diese Zusage unterlaufen könnte, wäre eine Verschlechterung, die wie eine Einstellung aussieht.";

/** Die Warnung vor dem Speichern. */
export const AUTH_PROTECTION_WARNING =
  "Speichern wirkt sofort für diese Umgebung und betrifft nur neu gesetzte Passwörter. Bestehende Konten werden nicht geprüft und nicht gesperrt: QKERN speichert Passwörter als Argon2id-Hash und kann sie nicht lesen, also auch nicht nachträglich gegen eine Liste halten.";

/* ------------------------------------------------------------------ *
 * Was dieser Slice nicht baut
 * ------------------------------------------------------------------ */

/** Kein Captcha, und warum nicht. */
export const AUTH_PROTECTION_NO_CAPTCHA =
  "Kein Captcha. Ein Captcha braucht zwei Dinge, die QKERN hier nicht hat: einen fremden Dienst, der die Aufgabe stellt und das Ergebnis bestätigt, und eine Browser-Herausforderung im Frontend des Kunden. Ein Schalter in dieser Console, hinter dem nichts steht, wäre schlimmer als ein ehrlich leerer Platz.";

/** Keine Bot-Abwehr über die Rate Limits hinaus. */
export const AUTH_PROTECTION_NO_BOT_DEFENCE =
  "Keine Bot-Abwehr über die Grenzen je Zeitfenster hinaus, die seit 2.52 unter Auth → Rate Limits stehen. Die zählen je Identität in der Datenbank und greifen über alle Instanzen; was darüber hinausgehen würde — Fingerprinting, Reputationslisten, Verhaltensmodelle — braucht Daten über den Anfragenden, die QKERN bewusst nicht sammelt.";

/** Wogegen der Passwortschutz nicht hilft. */
export const AUTH_PROTECTION_NOT_DISTRIBUTED =
  "Eine Leckprüfung hält keinen verteilten Angriff auf. Wer ein bekanntes Passwort gegen zehntausend Adressen probiert, wird hier nicht aufgehalten — hier wird geprüft, was ein Nutzer sich aussucht, nicht, was ein Angreifer rät. Gegen das Raten helfen die Rate Limits, und gegen ein erratenes Passwort der zweite Faktor unter Auth → Mehrfaktor.";

/* ------------------------------------------------------------------ *
 * Der Wortlaut einer Ablehnung
 * ------------------------------------------------------------------ */

/** Wie ein Wortlaut heisst. */
export const AUTH_PROTECTION_NOTICE_TEXTS = {
  named: "Das Leck beim Namen nennen",
  generic: "Nur die Regeln nennen",
} as const;

/** Was ein Wortlaut bedeutet, je ein Satz. */
export const AUTH_PROTECTION_NOTICE_NOTES = {
  named: "Die Ablehnung sagt, dass dieses Passwort aus bekannten Lecks stammt. Handelbar und kein Geheimnis: Wer es eingegeben hat, kennt es.",
  generic: "Die Ablehnung sagt nur, dass das Passwort den Regeln dieses Projekts nicht genügt. Der Nutzer weiss dann nicht, woran er ist.",
} as const;

export type AuthProtectionNoticeId = keyof typeof AUTH_PROTECTION_NOTICE_TEXTS;

/** Woher die geltende Liste stammt. */
export const AUTH_PROTECTION_LIST_SOURCE_TEXTS = {
  built_in: "Eingebaute Liste",
  file: "Hinterlegte Datei",
} as const;

export type AuthProtectionListSourceId = keyof typeof AUTH_PROTECTION_LIST_SOURCE_TEXTS;

/** Warum eine eingegebene Einstellung abgelehnt wurde, je Grund ein Satz. */
export const AUTH_PROTECTION_REJECTIONS = {
  not_an_object: "Der Körper trägt keine Einstellung.",
  unknown_field: "Dieses Feld gibt es nicht.",
  check_not_a_boolean: "Der Schalter muss wahr oder falsch sein.",
  min_length_not_an_integer: "Die Mindestlänge muss eine ganze Zahl sein.",
  min_length_out_of_range: "Die Mindestlänge liegt ausserhalb von 12 bis 128 Zeichen.",
  unknown_notice: "Diesen Wortlaut einer Ablehnung gibt es nicht.",
} as const;

export type AuthProtectionRejectionId = keyof typeof AUTH_PROTECTION_REJECTIONS;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authProtectionTexts(): string[] {
  return [
    AUTH_PROTECTION_WHAT,
    AUTH_PROTECTION_NO_THIRD_PARTY,
    AUTH_PROTECTION_WHERE,
    AUTH_PROTECTION_DIGESTS,
    AUTH_PROTECTION_REVEALS,
    AUTH_PROTECTION_WHY_NAMED,
    AUTH_PROTECTION_NEVER_LOGGED,
    AUTH_PROTECTION_FAILURE_MODE,
    AUTH_PROTECTION_AUDIT,
    AUTH_PROTECTION_LIST_FILE,
    AUTH_PROTECTION_LIST_FAILURE,
    AUTH_PROTECTION_BUILT_IN,
    AUTH_PROTECTION_BUILT_IN_HONESTY,
    AUTH_PROTECTION_MIN_LENGTH,
    AUTH_PROTECTION_WARNING,
    AUTH_PROTECTION_NO_CAPTCHA,
    AUTH_PROTECTION_NO_BOT_DEFENCE,
    AUTH_PROTECTION_NOT_DISTRIBUTED,
    ...Object.values(AUTH_PROTECTION_NOTICE_TEXTS),
    ...Object.values(AUTH_PROTECTION_NOTICE_NOTES),
    ...Object.values(AUTH_PROTECTION_LIST_SOURCE_TEXTS),
    ...Object.values(AUTH_PROTECTION_REJECTIONS),
  ];
}
