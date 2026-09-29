/**
 * Die Texte von Auth → Auth-Hooks (2.77), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `auth-protection-texts` (2.53) und `auth-rate-limits-texts`
 * (2.56): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn ueber
 * ihren Katalog, und der Vertrag `console-i18n-contract` liest diese Tabellen
 * mit und verlangt fuer jeden Text en, fr und it. Ein eigenes Modul braucht es,
 * weil die Ansicht `t(variable)` aufruft und ein Text hinter einer Variablen
 * durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der Platzhalter, den diese Seite ersetzt, nannte drei Punkte: Anmeldung,
 * Token-Ausgabe, Mailversand. Gebaut sind zwei. Die Texte hier sagen das, und
 * sie sagen beim dritten, warum er nicht kommt.
 */

/* ------------------------------------------------------------------ *
 * Was diese Seite tut
 * ------------------------------------------------------------------ */

/** Was ein Hook ist, in einem Satz. */
export const AUTH_HOOKS_WHAT =
  "Ein Hook ist eine hinterlegte Function dieses Projekts, die QKERN an einem festen Punkt der Anmeldung aufruft. Was sie antwortet, wirkt: Sie kann eine Anmeldung abweisen oder Ansprüche in das Access Token schreiben.";

/** Warum es nur zwei Punkte gibt. */
export const AUTH_HOOKS_WHY_TWO =
  "Es gibt zwei Punkte. Ein Punkt, an dem das Ergebnis des Aufrufs verworfen würde, ist kein Hook, sondern eine Benachrichtigung, die aussieht wie eine Wirkung. Einen Punkt „nach der Anmeldung“ gibt es deshalb nicht: Sein Ergebnis käme zu spät, um noch etwas zu ändern.";

/** Der Satz, um den es bei diesem Slice wirklich geht. */
export const AUTH_HOOKS_FAILURE_MODE =
  "Antwortet ein Hook nicht innerhalb seiner Frist, dann scheitert die Anmeldung. Beide Punkte fallen geschlossen: keine Sitzung, kein Token. Anders als der Zähler der Rate Limits, der bei einem eigenen Fehler durchlässt, ist ein Hook die Tür selbst und keine Schicht davor.";

/** Und der Preis dafür, ausgeschrieben. */
export const AUTH_HOOKS_FAILURE_PRICE =
  "Das heisst auch: Ein Hook, der hängt, sperrt diese Projektumgebung aus. Deshalb liegt die Frist zwischen 100 und 5000 Millisekunden, deshalb ist ein Punkt ohne hinterlegte Function aus, und deshalb hinterlässt das Abschalten eines Hooks eine Zeile in der Audit-Kette.";

/** Die Frist gehört in die Definition. */
export const AUTH_HOOKS_TIMEOUT_IS_A_SETTING =
  "Die Frist steht in der Definition und nicht im Code von QKERN, weil sie eine Abwägung dieses Projekts ist: Wie lange darf eine Anmeldung auf eigenen Code warten, bevor sie scheitert? Sie gilt je Punkt und wird bei jedem Aufruf frisch gelesen.";

/** Was die Frist nicht kann. */
export const AUTH_HOOKS_TIMEOUT_IS_WAITING =
  "Die Frist beendet das Warten, nicht den Container. Läuft sie ab, scheitert die Anmeldung; der Container läuft bis zu seinem eigenen Timeout weiter und darf in dieser Zeit noch wirken. Wer will, dass ein Hook wirklich stirbt, setzt den Timeout der Function selbst entsprechend.";

/** Über welchen Weg gerufen wird. */
export const AUTH_HOOKS_SAME_INVOCATION_PATH =
  "Gerufen wird über denselben Aufrufdienst wie jede andere Function. Damit gelten die Kapazitätsgrenze je Function, das monatliche Kontingent, die Egress-Grenzen der Definition und das Aufrufprotokoll unter Functions → Aufrufe. Es gibt keinen zweiten Weg zu einem Container.";

/** Mit welcher Autorität. */
export const AUTH_HOOKS_AUTHORITY =
  "Der Aufruf läuft mit der Service-Rolle des Projekts und dem Aktor project_auth_hook, nicht mit der des Nutzers, der sich gerade anmeldet: Der hat in diesem Moment noch keine Sitzung und kein Token. Im Aufrufprotokoll ist dadurch ablesbar, dass ein Aufruf von der Anmeldung kam und von welchem Punkt.";

/** Dass jede Änderung eine Spur hinterlässt. */
export const AUTH_HOOKS_AUDIT =
  "Jede Änderung hier schreibt einen Eintrag in die Audit-Kette der Plattform: je Punkt der Name der Function, die Frist und die erklärten Ansprüche, dazu die ID des Console-Nutzers. Ein abgewiesener Aufruf schreibt einen zweiten Eintrag mit dem Punkt und dem Grund.";

/** Kein Testknopf. */
export const AUTH_HOOKS_NO_TEST_CALL =
  "Es gibt keinen Knopf, der einen Hook ausprobiert. Ein Testaufruf mit erfundener Nutzlast belegt, dass ein Container antwortet, und nicht, dass eine Anmeldung durchkommt. Was ein Hook wirklich getan hat, steht unter Functions → Aufrufe und, wenn er abgewiesen hat, unter Auth → Audit-Log.";

/* ------------------------------------------------------------------ *
 * Was ein Hook sieht
 * ------------------------------------------------------------------ */

/** Die Nutzlast, in einem Satz. */
export const AUTH_HOOKS_PAYLOAD =
  "Die Nutzlast trägt, was der Anmeldeversuch ist: den Punkt, das Projekt, die Umgebung, die ID des Nutzers, seine E-Mail-Adresse, ob diese bestätigt ist, den Weg der Anmeldung und den Zeitpunkt. Der Anspruchs-Hook bekommt statt des Weges den Grund der Ausgabe, also Anmeldung oder Erneuerung.";

/** Kein Passwort, nie. */
export const AUTH_HOOKS_NO_PASSWORD =
  "Kein Passwort, auch nicht gehasht. Ein Hash ist derselbe Wert in anderer Schreibweise: Wer ihn hat, kann damit raten, und wer ihn mitschreibt, hat ein Passwortleck angelegt. Es gibt keine Einstellung, die das erlaubt.";

/** Kein Token. */
export const AUTH_HOOKS_NO_TOKEN =
  "Kein Access Token, kein Refresh Token, kein Schein des zweiten Faktors. Ein Hook, der ein Token bekäme, wäre keine Regel über die Anmeldung mehr, sondern ein weiterer Anmelder.";

/** Keine IP-Adresse. */
export const AUTH_HOOKS_NO_ADDRESS =
  "Keine IP-Adresse und kein User Agent. Der Dienst sieht sie an dieser Stelle gar nicht, weil er für die Anmeldung nur einen undurchsichtigen Schlüssel für die Zählung bekommt und seine Grenzen nach Identität zählt. Sie weiterzugeben wäre ein neuer Datenfluss: Verkehrsdaten in eigenen Code, dessen Logzeilen QKERN nicht kennt. Wer nach Herkunft filtern will, tut das vor QKERN.";

/** Keine Metadaten. */
export const AUTH_HOOKS_NO_METADATA =
  "Kein user_metadata und kein app_metadata. Das sind die eigenen Daten dieses Projekts, und der Hook läuft im Projekt: Er kann sie lesen, wenn er sie braucht. Sie in jede Nutzlast zu legen hiesse, sie auch dann zu verschicken, wenn niemand sie braucht.";

/** Keine Sitzungs-ID beim Anspruchs-Hook. */
export const AUTH_HOOKS_NO_SESSION_ID =
  "Der Anspruchs-Hook bekommt keine Sitzungs-ID. Er soll Ansprüche liefern und keine Sitzung wiedererkennen; mit der ID könnte er nichts tun, was er tun darf, und sie stünde danach in fremden Logzeilen.";

/* ------------------------------------------------------------------ *
 * Was ein Hook ändern darf
 * ------------------------------------------------------------------ */

/** Die Antwort am Punkt Anmeldung. */
export const AUTH_HOOKS_SIGN_IN_CONTRACT =
  "Der Anmelde-Hook antwortet mit 2xx und einem Körper {\"decision\":\"allow\"} oder {\"decision\":\"deny\"}. Alles andere gilt als keine Antwort, auch ein leeres Objekt: Ein Container, dessen Code vorher abgebrochen ist, hat nichts entschieden.";

/** Die Antwort am Punkt Token. */
export const AUTH_HOOKS_CLAIMS_CONTRACT =
  "Der Anspruchs-Hook antwortet mit 2xx und einem Körper {\"claims\": { … }}. Erlaubt sind nur die Namen, die hier erklärt sind, mit Zeichenketten, Zahlen, Wahrheitswerten oder null als Wert, zusammen höchstens 512 Byte. Ein leeres claims ist erlaubt und heisst „diesem Nutzer nichts hinzufügen“.";

/** Reservierte Namen. */
export const AUTH_HOOKS_RESERVED =
  "Reservierte Namen kann ein Hook nicht setzen. Dazu gehören sub, iss, aud, exp, iat und role sowie die übrigen Ansprüche, die QKERN selbst ausgibt. Wer sub setzen könnte, wäre jemand anderes; wer exp setzen könnte, hätte ein Token ohne Ende; wer role setzen könnte, wäre in der Datenbank eine andere Rolle.";

/** Und dass ein Versuch nicht übergangen wird. */
export const AUTH_HOOKS_RESERVED_IS_LOUD =
  "Versucht ein Hook trotzdem einen reservierten Namen, fällt die ganze Ausgabe und der Versuch steht im Audit-Log. Der Anspruch wird nicht stillschweigend übergangen: Ein übergangener Anspruch wäre eine Meinungsverschiedenheit darüber, wer dieser Nutzer ist, die niemand bemerkt.";

/** Warum die Liste fest ist. */
export const AUTH_HOOKS_CLAIMS_ARE_DECLARED =
  "Die erlaubten Namen stehen in der Definition, höchstens acht. Liefert ein Hook einen Namen, der nicht darin steht, fällt die Ausgabe ebenfalls. Die Liste ist eine Zusage an sich selbst: Ein Hook, der sie überschreitet, hat sich geändert, ohne dass jemand diese Seite angefasst hat.";

/** Kein verschachtelter Wert. */
export const AUTH_HOOKS_SCALARS_ONLY =
  "Ein Anspruch trägt einen einzelnen Wert und kein Objekt und keine Liste. Struktur in einem Token ist ein Ort, an dem etwas unbemerkt wächst, und ein Access Token wandert bei jeder Anfrage mit. Was Struktur braucht, gehört in die Datenbank dieses Projekts.";

/* ------------------------------------------------------------------ *
 * Wo die Punkte greifen
 * ------------------------------------------------------------------ */

/** Wo der Anmelde-Hook steht. */
export const AUTH_HOOKS_SIGN_IN_WHERE =
  "Der Anmelde-Hook läuft an der einen Stelle, an der eine Sitzung aus einer Anmeldung entsteht, und damit auf jedem Weg: Passwort, Magic Link, Mailbestätigung, OIDC und die Bestätigung des zweiten Faktors. Er läuft vor dem Anlegen der Sitzung, sodass ein abgewiesener Versuch keine Zeile und kein Refresh Token hinterlässt.";

/** Was er nicht kann. */
export const AUTH_HOOKS_SIGN_IN_NOT_REFRESH =
  "Bei einer Erneuerung läuft er nicht, denn eine Erneuerung ist keine Anmeldung. Wer diesen Hook einschaltet oder seine Regel verschärft, ändert damit, wer sich das nächste Mal anmelden darf, und beendet keine laufende Sitzung. Laufende Sitzungen beendet man unter Auth → Sitzungen.";

/** Wo der Anspruchs-Hook steht. */
export const AUTH_HOOKS_CLAIMS_WHERE =
  "Der Anspruchs-Hook läuft bei jeder Ausgabe eines Access Token, also auch bei jeder Erneuerung. Ein Access Token lebt 15 Minuten; ein Hook, der nur bei der Anmeldung liefe, liesse die Ansprüche nach einer Viertelstunde verschwinden, und die Policies dahinter lesen diesen Unterschied nicht.";

/** Und was das bei einem Ausfall bedeutet. */
export const AUTH_HOOKS_CLAIMS_REFRESH_PRICE =
  "Fällt er aus, scheitert auch die Erneuerung. Die Sitzung bleibt dabei stehen und wird nicht widerrufen: Ein Container, der neu startet, soll keine Sitzung gekostet haben. Nach dem Ablauf des Access Token stehen die Nutzer trotzdem ohne Zugang da, bis der Hook wieder antwortet.";

/* ------------------------------------------------------------------ *
 * Was diese Seite nicht hält
 * ------------------------------------------------------------------ */

/** Kein Mail-Hook, und der Grund. */
export const AUTH_HOOKS_NO_MAIL_HOOK =
  "Kein Punkt beim Mailversand, obwohl der Platzhalter dieser Seite ihn nannte. Der Link einer Aktionsmail trägt das einmalige Token im Klartext, ein Mail-Hook bekäme es also zu sehen, und damit einen Anmeldeschein. Eigener Code, der einen Anmeldeschein bekommt, ist kein erweiterter Mailweg, sondern ein zweiter Weg zur Anmeldung. Der Mailweg bleibt unter Auth → SMTP und zeigt dort, was er tut.";

/** Kein Hook auf die Registrierung. */
export const AUTH_HOOKS_NO_SIGN_UP_HOOK =
  "Kein Punkt bei der Registrierung. Wer steuern will, wer ein Konto bekommt, hat mit dem Anmelde-Hook denselben Effekt eine Stufe später: Ein Konto ohne mögliche Anmeldung nützt niemandem. Ein eigener Punkt dort wäre eine zweite Regel mit derselben Aufgabe.";

/** Keine Ausnahme vom geschlossenen Fall. */
export const AUTH_HOOKS_NO_FAIL_OPEN_SWITCH =
  "Keinen Schalter „im Zweifel durchlassen“. Ein Gatter, das bei einem Ausfall öffnet, schützt genau dann nicht, wenn es darauf ankommt, und ein Token ohne die bestellten Ansprüche sagt etwas anderes als das Token, das dieses Projekt bestellt hat. Wer das offen will, trägt keinen Hook ein.";

/** Keine Einsicht in das, was der Hook getan hat. */
export const AUTH_HOOKS_NO_OUTPUT =
  "Kein Blick in die Ausgabe des Containers auf dieser Seite. Was die Function eines Punkts geschrieben hat, steht seit 2.67.0 unter Functions → Function-Logs, je Aufruf und mit harten Grenzen. Hier steht nur, welcher Punkt welche Function ruft.";

/** Der Hinweis, wenn es keinen Aufrufweg gibt. */
export const AUTH_HOOKS_NO_INVOCATION_PATH =
  "Ohne freigeschaltete Functions gibt es keinen Weg zu einem Container. Ein Punkt ohne hinterlegte Function merkt davon nichts. Ein Punkt mit hinterlegter Function scheitert dann bei jeder Anmeldung, denn ein Hook, den niemand rufen kann, hat nicht geantwortet.";

/* ------------------------------------------------------------------ *
 * Die Punkte
 * ------------------------------------------------------------------ */

/** Wie ein Punkt heisst. */
export const AUTH_HOOKS_POINT_TEXTS = {
  sign_in: "Anmeldung",
  access_token_claims: "Ausgabe des Access Token",
} as const;

/** Was ein Punkt darf, je ein Satz. */
export const AUTH_HOOKS_POINT_NOTES = {
  sign_in: "Darf die Anmeldung abweisen. Läuft nach der Prüfung der Anmeldedaten und vor dem Anlegen der Sitzung.",
  access_token_claims: "Darf Ansprüche aus der erklärten Liste setzen. Läuft bei jeder Ausgabe eines Access Token, auch bei einer Erneuerung.",
} as const;

export type AuthHookPointId = keyof typeof AUTH_HOOKS_POINT_TEXTS;

/** Was bei einem Ausfall gilt, je Punkt. Heute an beiden dasselbe. */
export const AUTH_HOOKS_FAILURE_TEXTS = {
  deny: "Antwortet der Hook nicht, scheitert die Anmeldung.",
} as const;

export type AuthHookFailureId = keyof typeof AUTH_HOOKS_FAILURE_TEXTS;

/* ------------------------------------------------------------------ *
 * Ablehnungen
 * ------------------------------------------------------------------ */

/** Warum eine eingegebene Definition abgelehnt wurde, je Grund ein Satz. */
export const AUTH_HOOKS_REJECTIONS = {
  not_an_object: "Der Körper trägt keine Definition.",
  unknown_field: "Dieses Feld gibt es nicht.",
  missing_point: "Beide Punkte müssen im Körper stehen.",
  function_not_a_name: "Der Name muss eine Zeichenkette sein oder leer bleiben.",
  function_name_invalid: "So heisst keine Function: klein, 3 bis 63 Zeichen, Buchstaben, Ziffern, Bindestrich und Unterstrich.",
  timeout_not_an_integer: "Die Frist muss eine ganze Zahl in Millisekunden sein.",
  timeout_out_of_range: "Die Frist liegt ausserhalb von 100 bis 5000 Millisekunden.",
  claims_not_an_array: "Die erlaubten Ansprüche müssen eine Liste sein.",
  too_many_claims: "Höchstens acht Ansprüche.",
  claim_not_a_string: "Ein Anspruchsname muss eine Zeichenkette sein.",
  claim_name_invalid: "So heisst kein Anspruch: klein, 2 bis 31 Zeichen, Buchstaben, Ziffern und Unterstrich.",
  claim_reserved: "Diesen Anspruch gibt QKERN selbst aus; er kann nicht überschrieben werden.",
  duplicate_claim: "Dieser Anspruch steht zweimal in der Liste.",
  claims_without_function: "Erlaubte Ansprüche ohne hinterlegte Function sind eine Erlaubnis für niemanden.",
  claims_required: "Eine hinterlegte Function ohne erlaubte Ansprüche wäre ein Hook, dessen Antwort ganz verworfen würde.",
} as const;

export type AuthHookRejectionId = keyof typeof AUTH_HOOKS_REJECTIONS;

/** Warum die Antwort eines Hooks nicht angenommen wurde, je Grund ein Satz. */
export const AUTH_HOOKS_REFUSALS = {
  no_answer: "Der Hook hat nicht oder nicht rechtzeitig geantwortet.",
  bad_status: "Der Hook hat mit einem anderen Status als 2xx geantwortet.",
  body_not_an_object: "Der Körper der Antwort war kein Objekt.",
  decision_unknown: "Die Antwort nannte keine Entscheidung, die es gibt.",
  denied: "Der Hook hat die Anmeldung abgewiesen.",
  claims_not_an_object: "Die Antwort trug kein claims-Objekt.",
  claim_reserved: "Der Hook wollte einen Anspruch setzen, den QKERN selbst ausgibt.",
  claim_not_declared: "Der Hook wollte einen Anspruch setzen, der hier nicht erklärt ist.",
  claim_value_not_scalar: "Ein Anspruch trug ein Objekt oder eine Liste als Wert.",
  claim_value_too_long: "Ein Anspruchswert war länger als 256 Zeichen.",
  claims_too_large: "Die Ansprüche waren zusammen grösser als 512 Byte.",
} as const;

export type AuthHookRefusalId = keyof typeof AUTH_HOOKS_REFUSALS;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authHookTexts(): string[] {
  return [
    AUTH_HOOKS_WHAT,
    AUTH_HOOKS_WHY_TWO,
    AUTH_HOOKS_FAILURE_MODE,
    AUTH_HOOKS_FAILURE_PRICE,
    AUTH_HOOKS_TIMEOUT_IS_A_SETTING,
    AUTH_HOOKS_TIMEOUT_IS_WAITING,
    AUTH_HOOKS_SAME_INVOCATION_PATH,
    AUTH_HOOKS_AUTHORITY,
    AUTH_HOOKS_AUDIT,
    AUTH_HOOKS_NO_TEST_CALL,
    AUTH_HOOKS_PAYLOAD,
    AUTH_HOOKS_NO_PASSWORD,
    AUTH_HOOKS_NO_TOKEN,
    AUTH_HOOKS_NO_ADDRESS,
    AUTH_HOOKS_NO_METADATA,
    AUTH_HOOKS_NO_SESSION_ID,
    AUTH_HOOKS_SIGN_IN_CONTRACT,
    AUTH_HOOKS_CLAIMS_CONTRACT,
    AUTH_HOOKS_RESERVED,
    AUTH_HOOKS_RESERVED_IS_LOUD,
    AUTH_HOOKS_CLAIMS_ARE_DECLARED,
    AUTH_HOOKS_SCALARS_ONLY,
    AUTH_HOOKS_SIGN_IN_WHERE,
    AUTH_HOOKS_SIGN_IN_NOT_REFRESH,
    AUTH_HOOKS_CLAIMS_WHERE,
    AUTH_HOOKS_CLAIMS_REFRESH_PRICE,
    AUTH_HOOKS_NO_MAIL_HOOK,
    AUTH_HOOKS_NO_SIGN_UP_HOOK,
    AUTH_HOOKS_NO_FAIL_OPEN_SWITCH,
    AUTH_HOOKS_NO_OUTPUT,
    AUTH_HOOKS_NO_INVOCATION_PATH,
    ...Object.values(AUTH_HOOKS_POINT_TEXTS),
    ...Object.values(AUTH_HOOKS_POINT_NOTES),
    ...Object.values(AUTH_HOOKS_FAILURE_TEXTS),
    ...Object.values(AUTH_HOOKS_REJECTIONS),
    ...Object.values(AUTH_HOOKS_REFUSALS),
  ];
}
