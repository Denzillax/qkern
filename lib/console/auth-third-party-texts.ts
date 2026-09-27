/**
 * Die Texte von Auth → Fremde Anbieter (2.80), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `auth-hooks-texts` (2.77) und `auth-rate-limits-texts`
 * (2.56): Der Schluessel ist der deutsche Text, die Console uebersetzt ihn ueber
 * ihren Katalog, und der Vertrag `console-i18n-contract` liest diese Tabellen
 * mit und verlangt fuer jeden Text en, fr und it. Ein eigenes Modul braucht es,
 * weil die Ansicht `t(variable)` aufruft und ein Text hinter einer Variablen
 * durch die Suche nach `t("...")` faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der Platzhalter, den diese Seite ersetzt, sagte: "Token fremder
 * Identitaetsdienste akzeptieren, ohne eigene Nutzerkonten." Genau das ist
 * gebaut. Die Texte hier sagen dazu, was dieser Satz mitbringt und was er
 * kostet.
 */

/* ------------------------------------------------------------------ *
 * Was diese Seite tut
 * ------------------------------------------------------------------ */

/** Was ein fremder Anbieter ist, in einem Satz. */
export const AUTH_THIRD_PARTY_WHAT =
  "Ein fremder Anbieter ist ein Identitätsdienst, den QKERN nicht kontrolliert und dessen Token die Data API direkt annimmt. Die Anwendung schickt das Token, das sie von diesem Dienst schon hat; QKERN prüft es und arbeitet damit.";

/** Der Unterschied zum OIDC-Weg, und er ist der wichtigste Satz dieser Seite. */
export const AUTH_THIRD_PARTY_VERSUS_OIDC =
  "Das ist etwas anderes als ein Anmeldeverfahren unter Auth → Anmeldeverfahren. Beim OIDC-Login ist das fremde Token eine Zwischenstation: QKERN prüft es, legt daraufhin ein eigenes Nutzerkonto an und gibt ein eigenes Token aus, mit eigener Unterschrift und widerrufbarer Sitzung. Hier gibt es keine Zwischenstation und kein Konto.";

/** Und was damit nicht entsteht. */
export const AUTH_THIRD_PARTY_NO_ACCOUNT =
  "Es entsteht kein Nutzer in diesem Projekt, keine Sitzung und kein Refresh Token. Unter Auth → Nutzer steht niemand, der so hereinkommt, und unter Auth → Sitzungen ist nichts zu beenden. Wer diese Menschen zählen will, zählt sie beim Anbieter.";

/** Der Preis, ausgeschrieben. */
export const AUTH_THIRD_PARTY_NO_REVOCATION =
  "QKERN kann ein Token nicht zurückziehen, das es nicht ausgegeben hat. Gilt es bis zu seinem exp, dann gilt es bis dahin. Der einzige Widerruf hier ist grob: Wer den Anbieter entfernt, lässt jedes Token dieses Dienstes fallen, auch die noch gültigen.";

/** Warum der Projekt-Key trotzdem dabei sein muss. */
export const AUTH_THIRD_PARTY_KEY_STILL_REQUIRED =
  "Ein fremdes Token allein öffnet die Data API nicht. Jede Anfrage bringt weiterhin den Public Key dieser Projektumgebung mit, wie jede andere Anfrage der Data API auch. Das Token sagt, wer der Aufrufer ist; der Key ist die Zusage dieses Projekts, dass diese Anwendung hier anklopfen darf, und er ist widerrufbar.";

/** Die Reihenfolge der Prüfungen. */
export const AUTH_THIRD_PARTY_OWN_TOKEN_FIRST =
  "Ein vorgelegtes Token wird immer zuerst als eigenes geprüft. Erst wenn das scheitert, kommt dieser Weg. Dadurch kann kein hinterlegter Anbieter einem Token von QKERN eine andere Bedeutung geben, auch dann nicht, wenn er denselben Aussteller nennt.";

/* ------------------------------------------------------------------ *
 * Was geprüft wird
 * ------------------------------------------------------------------ */

/** Die Liste der Prüfungen. */
export const AUTH_THIRD_PARTY_CHECKS =
  "Geprüft werden fünf Dinge, und alle fünf müssen stimmen: die Unterschrift gegen den Schlüsselsatz des Ausstellers, der Aussteller gegen den hinterlegten Wert, das Publikum gegen die erwarteten Werte, die Laufzeit gegen die Uhr, und das Signaturverfahren gegen eine feste Positivliste.";

/** Und dass das Verfahren nicht aus dem Token kommt. */
export const AUTH_THIRD_PARTY_ALGORITHM_FROM_LIST =
  "Das Verfahren kommt aus der Positivliste und aus dem Schlüssel, nicht aus dem Token. Der Header eines Tokens darf sagen, welchen Eintrag der Liste er meint; er darf nicht sagen, wie gerechnet wird.";

/** Das erste alte Loch. */
export const AUTH_THIRD_PARTY_HOLE_NONE =
  "Damit ist das erste alte Loch zu: ein Token mit alg none, also ohne Unterschrift, das ein Prüfer annimmt, weil der Header behauptet, es gebe keine zu prüfen. Es fällt, weil none in der Liste nicht vorkommt.";

/** Das zweite. */
export const AUTH_THIRD_PARTY_HOLE_SYMMETRIC =
  "Und das zweite: Ein Angreifer nimmt den frei abrufbaren öffentlichen Schlüssel des Ausstellers, rechnet damit ein HMAC und schreibt alg HS256 in den Header. Ein Prüfer, der dem Header folgt, benutzt dasselbe öffentliche Material als Geheimnis und bestätigt die Fälschung. Das fällt hier zweimal: HS256 steht nicht in der Liste, und jeder Eintrag der Liste verlangt einen Schlüsseltyp, zu dem kein symmetrischer Schlüssel passt.";

/** Die Uhrentoleranz. */
export const AUTH_THIRD_PARTY_CLOCK_SKEW =
  "Für die Laufzeit gilt eine Toleranz von 30 Sekunden in beide Richtungen. Bei einem eigenen Token sind es 5, und dort ist das richtig: Der Aussteller ist derselbe Prozess. Hier ist er eine fremde Maschine mit fremder Zeitquelle, und 5 Sekunden würden bei jedem gesunden Aussteller gelegentlich ein frisches Token abweisen.";

/** Ein Token ohne Ende. */
export const AUTH_THIRD_PARTY_EXPIRY_REQUIRED =
  "Ein Token ohne exp wird abgewiesen. Es gibt hier keinen Widerruf, also ist exp die einzige Zusage, dass dieser Zugang irgendwann aufhört. Ein fehlendes exp als „gilt immer“ zu lesen wäre die falsche Richtung.";

/** Wie lange ein Token gelten darf. */
export const AUTH_THIRD_PARTY_NO_LIFETIME_CAP =
  "Wie lange ein Token gilt, entscheidet der Aussteller und nicht QKERN. Es gibt hier keine Obergrenze für die Laufzeit, und das ist ehrlich gesagt eine Lücke: Ein Anbieter, der Token für ein Jahr ausgibt, gibt Zugang für ein Jahr. Wer das nicht will, wählt einen Anbieter, der kurz ausgibt, oder nimmt den OIDC-Weg, bei dem QKERN die Laufzeit selbst setzt.";

/* ------------------------------------------------------------------ *
 * Die Rolle
 * ------------------------------------------------------------------ */

/** Die Entscheidung. */
export const AUTH_THIRD_PARTY_ROLE_CEILING =
  "Ein fremdes Token bekommt höchstens die Rolle authenticated. Nie service_role.";

/** Und warum. */
export const AUTH_THIRD_PARTY_ROLE_WHY =
  "service_role umgeht in der Data API jede Policy. Wer diese Rolle einem Aussteller gibt, den QKERN nicht kontrolliert, hat die Zeilensicherheit dieses Projekts an die Registrierungsseite dieses Ausstellers delegiert: Wer dort ein Konto anlegen kann, liest danach jede Zeile jeder Tabelle. Das ist keine Einstellung mit Warnhinweis, das ist eine Tür.";

/** Wo die Grenze steht. */
export const AUTH_THIRD_PARTY_ROLE_WHERE =
  "Die Grenze steht an drei Stellen: im Prüfmodul, als CHECK in der Datenbank und noch einmal in der Data API, die ein fremdes Token mit dieser Rolle abweist. Dreimal geschrieben und einmal gemeint, weil jeder der drei Wege einzeln richtig sein soll.";

/** Wer eine Anfrage ohne Policies braucht. */
export const AUTH_THIRD_PARTY_ROLE_ALTERNATIVE =
  "Wer eine Anfrage ohne Policies braucht, nimmt einen Service Key dieser Projektumgebung unter Einstellungen → API-Keys. Den gibt QKERN aus, er ist widerrufbar, und seine Ausgabe steht in der Audit-Kette.";

/** Wie aus Ansprüchen eine Rolle wird. */
export const AUTH_THIRD_PARTY_ROLE_MAPPING =
  "Ohne Rollenanspruch bekommt jedes Token dieses Anbieters die eingetragene Rolle. Mit Rollenanspruch gilt der Wert aus dem Token, und er muss anon oder authenticated sein. Fehlt der Anspruch im Token, gilt wieder die eingetragene Rolle: Ein Token ohne Rollenangabe verlangt nichts Besonderes.";

/** Kein stilles Herunterstufen. */
export const AUTH_THIRD_PARTY_NO_SILENT_DOWNGRADE =
  "Sagt der Rollenanspruch etwas anderes, etwa service_role, wird das Token abgewiesen und nicht heruntergestuft. Ein Herunterstufen sähe für den Aufrufer wie ein Erfolg aus, und er baute danach eine Anwendung auf einer Rolle, die er nicht hat.";

/* ------------------------------------------------------------------ *
 * Die Zeilensicherheit
 * ------------------------------------------------------------------ */

/** Derselbe Weg wie beim eigenen Token. */
export const AUTH_THIRD_PARTY_SAME_RLS_PATH =
  "Die Ansprüche gehen genau denselben Weg wie die eines eigenen Tokens: request.jwt.claims mit allen Ansprüchen als JSON, request.jwt.claim.role und request.jwt.claim.sub, je nur für diese eine Transaktion. Es gibt keine Abkürzung daneben; eine zweite Stelle wären zwei Wahrheiten.";

/** Und wie eine Policy den Unterschied sieht. */
export const AUTH_THIRD_PARTY_ISS_IN_CLAIMS =
  "Was dazukommt, ist der Anspruch iss mit dem Aussteller. Nur ein fremdes Token trägt ihn. Eine Policy kann damit prüfen, dass eine Zeile einem Konto bei diesem Anbieter gehört und nicht einem eigenen Nutzer; ohne diesen Anspruch wären die beiden Fälle nicht auseinanderzuhalten.";

/** Welche Ansprüche mitwandern. */
export const AUTH_THIRD_PARTY_EXTERNAL_CLAIMS =
  "Von den übrigen Ansprüchen des Ausstellers wandern höchstens 16 mit, zusammen höchstens 2048 Byte, und nur einzelne Werte: Zeichenkette, Zahl, Wahrheitswert oder null. Ein verschachtelter Anspruch wird übergangen und nicht abgewiesen, denn ein fremdes Token trägt oft ein ganzes Profil, und daran das Lesen einer Tabelle scheitern zu lassen wäre Willkür.";

/** Was QKERN selbst setzt. */
export const AUTH_THIRD_PARTY_OWN_CLAIMS_WIN =
  "Ansprüche, die QKERN selbst setzt, werden nicht übernommen. Sie werden dabei still übergangen und nicht zum Fehler: Jedes JWT trägt iss, aud und exp, und daraus eine Ablehnung zu machen hiesse, jedes Token abzuweisen. Bei gleichem Namen gewinnt QKERN, und zwar durch die Stellung im Aufbau und nicht durch eine zweite Prüfung, die jemand vergessen kann.";

/** Was nicht erfunden wird. */
export const AUTH_THIRD_PARTY_NO_INVENTED_CLAIMS =
  "Kein aal, kein session_id, kein email_verified. Alle drei sind Zusagen über eine Sitzung und ein Konto von QKERN. Sie hier hinzuschreiben wäre erfunden: QKERN weiss nicht, wie sich dieser Mensch beim fremden Dienst angemeldet hat.";

/* ------------------------------------------------------------------ *
 * Der Schlüsselsatz
 * ------------------------------------------------------------------ */

/** Wann geholt wird. */
export const AUTH_THIRD_PARTY_JWKS_WHEN =
  "Der Schlüsselsatz wird geholt, wenn er gebraucht wird, und fünf Minuten im Prozessspeicher gehalten. Er steht nicht in der Datenbank: Eine gespeicherte Kopie wäre ein zweiter Wahrheitsort, und ein zurückgezogener Schlüssel bliebe darin gültig.";

/** Die Grenzen beim Holen. */
export const AUTH_THIRD_PARTY_JWKS_LIMITS =
  "Beim Holen gelten eine Frist von 5 Sekunden, eine Höchstgrösse von 128 KiB und höchstens 20 Schlüssel. Eine Umleitung wird nicht verfolgt: Sie führte an ein Ziel, das die Adressprüfung nie gesehen hat, und die Wahl des Ziels darf ein fremder Dienst nicht haben.";

/** Wo die Adressprüfung sitzt. */
export const AUTH_THIRD_PARTY_JWKS_EGRESS =
  "Geholt wird über dieselbe Adressprüfung, die die Ausgangsverbindungen einer Function nehmen: Der Name wird aufgelöst, jede aufgelöste Adresse muss öffentlich erreichbar sein, und verbunden wird genau zu der geprüften. Es gibt keine zweite Adressprüfung für diesen Weg, weil eine zweite Regel eine zweite Regel wäre, die hinterherhinkt.";

/** Was ein Ausfall kostet. */
export const AUTH_THIRD_PARTY_JWKS_FAILURE =
  "Ist der Schlüsselsatz nicht zu holen, werden die Token dieses Anbieters abgewiesen. Ungeprüft annehmen ist keine Betriebsart. Das heisst auch: Ein Ausfall beim Anbieter sperrt dessen Nutzer aus, und QKERN kann daran nichts ändern.";

/** Der gedrehte Schlüssel. */
export const AUTH_THIRD_PARTY_JWKS_ROTATION =
  "Findet die Prüfung im gehaltenen Satz keinen passenden Schlüssel, wird einmal ein frischer geholt. Damit das kein Hebel wird, gilt dafür ein Mindestabstand von 30 Sekunden: Wer mit einer erfundenen Schlüssel-ID anklopft, löst höchstens alle 30 Sekunden ein Holen aus und nicht eines je Anfrage.";

/* ------------------------------------------------------------------ *
 * Was diese Seite nicht hält
 * ------------------------------------------------------------------ */

/** Kein Bearbeiten. */
export const AUTH_THIRD_PARTY_NO_EDIT =
  "Ein Anbieter wird angelegt und entfernt, nicht bearbeitet. Ein geänderter Aussteller oder Schlüsselsatz machte aus dem Eintrag eine andere Vertrauensbeziehung, ohne dass Name, Alter oder Audit-Zeile sich ändern. Die Datenbank hat auf dieser Tabelle darum gar kein Recht zum Ändern.";

/** Kein Testknopf. */
export const AUTH_THIRD_PARTY_NO_TEST_CALL =
  "Es gibt keinen Knopf, der die Verbindung zum Anbieter ausprobiert. Ein Holen beim Eintragen belegt, dass eine Adresse jetzt antwortet, und nicht, dass eine Anfrage in einer Stunde durchkommt. Geholt wird beim ersten echten Token, und was dabei geschah, steht unter Logs → Data API.";

/** Keine Discovery. */
export const AUTH_THIRD_PARTY_NO_DISCOVERY =
  "Die Adresse des Schlüsselsatzes wird nicht aus dem Aussteller errechnet. Der Well-Known-Pfad ist eine Konvention und kein Gesetz; wer ihn errechnet, holt bei einem Dienst, der ihn anders legt, still eine 404 und weist danach jedes Token ab.";

/** Kein zweiter Faktor, keine Sperrung. */
export const AUTH_THIRD_PARTY_NO_ACCOUNT_FEATURES =
  "Kein zweiter Faktor, keine Sperrung eines Nutzers, keine Passwortregel, keine Rate Limits je Identität. Alle vier sind Zusagen über Konten, und Konten gibt es hier nicht. Was das Projekt vor Missbrauch schützt, sind die Policies und die Grenzen der Data API.";

/** Keine Nutzerliste. */
export const AUTH_THIRD_PARTY_NO_LIST =
  "Keine Liste, wer über einen fremden Anbieter schon zugegriffen hat. QKERN legt dafür keine Zeile an, und eine aus dem Data-API-Log zusammengerechnete Liste wäre eine Vermutung mit Aussehen einer Nutzerverwaltung.";

/* ------------------------------------------------------------------ *
 * Rollen und Verfahren
 * ------------------------------------------------------------------ */

/** Was eine Rolle in der Zeilensicherheit bedeutet, je ein Satz. */
export const AUTH_THIRD_PARTY_ROLE_TEXTS = {
  anon: "Wie ein Public Key: Es gelten nur die Policies, die für jeden gelten.",
  authenticated: "Wie ein angemeldeter Nutzer dieses Projekts: Policies für authenticated greifen, und sub trägt das Subjekt beim Anbieter.",
  service_role: "Umgeht jede Policy. Für ein fremdes Token nicht zu haben.",
} as const;

export type AuthThirdPartyRoleId = keyof typeof AUTH_THIRD_PARTY_ROLE_TEXTS;

/* ------------------------------------------------------------------ *
 * Ablehnungen
 * ------------------------------------------------------------------ */

/** Warum ein eingegebener Anbieter abgelehnt wurde, je Grund ein Satz. */
export const AUTH_THIRD_PARTY_REJECTIONS = {
  not_an_object: "Der Körper trägt keinen Anbieter.",
  unknown_field: "Dieses Feld gibt es nicht.",
  name_invalid: "So heisst kein Anbieter: klein, 2 bis 63 Zeichen, Buchstaben, Ziffern, Bindestrich und Unterstrich.",
  issuer_not_https: "Der Aussteller muss eine https-Adresse ohne Anmeldedaten und ohne Fragment sein, und kein localhost und keine nackte IP-Adresse.",
  issuer_trailing_slash: "Der Aussteller darf nicht auf einen Schrägstrich enden: Der Anspruch iss wird Zeichen für Zeichen verglichen.",
  jwks_not_https: "Die Adresse des Schlüsselsatzes muss eine https-Adresse ohne Anmeldedaten und ohne Fragment sein, und kein localhost und keine nackte IP-Adresse.",
  audiences_not_an_array: "Das erwartete Publikum muss eine Liste sein.",
  audiences_out_of_range: "Ein bis fünf Werte für das Publikum.",
  audience_invalid: "Ein Wert für das Publikum trägt ein Komma, ein Leerzeichen oder ist zu lang.",
  duplicate_audience: "Dieser Wert steht zweimal im Publikum.",
  subject_claim_invalid: "So heisst kein Anspruch: Buchstabe am Anfang, dann Buchstaben, Ziffern, Unterstrich, Punkt, Doppelpunkt, Schrägstrich oder Bindestrich.",
  role_claim_invalid: "So heisst kein Anspruch: Buchstabe am Anfang, dann Buchstaben, Ziffern, Unterstrich, Punkt, Doppelpunkt, Schrägstrich oder Bindestrich.",
  role_not_allowed: "Diese Rolle gibt es hier nicht: anon oder authenticated.",
  role_forbidden: "Diese Rolle bekommt ein fremdes Token nie. service_role umgeht jede Policy, und der Aussteller gehört nicht QKERN.",
  too_many_providers: "Diese Umgebung hat schon zehn fremde Anbieter.",
  duplicate: "Dieser Name oder dieser Aussteller steht in dieser Umgebung schon.",
} as const;

export type AuthThirdPartyRejectionId = keyof typeof AUTH_THIRD_PARTY_REJECTIONS;

/**
 * Warum ein fremdes Token abgewiesen wurde, je Grund ein Satz.
 *
 * Diese Gruende bekommt der Aufrufer **nicht**. Die Data API antwortet mit 401
 * und sonst nichts: Wer erfaehrt, ob sein Publikum oder seine Unterschrift nicht
 * gepasst hat, bekommt ein Werkzeug zum Probieren. Die Liste steht hier, damit
 * die Seite erklaeren kann, wonach geprueft wird.
 */
export const AUTH_THIRD_PARTY_REFUSALS = {
  token_too_long: "Das Token ist länger als 16 KiB.",
  not_three_parts: "Das Token hat nicht die drei Teile eines JWT.",
  header_not_an_object: "Der Header des Tokens ist kein Objekt.",
  claims_not_an_object: "Die Ansprüche des Tokens sind kein Objekt.",
  algorithm_not_allowed: "Das Signaturverfahren steht nicht auf der Positivliste. Hierhin fallen alg none und jedes symmetrische Verfahren.",
  no_matching_key: "Im Schlüsselsatz des Ausstellers ist kein Schlüssel mit dieser Kennung.",
  key_type_mismatch: "Der Schlüssel passt nicht zum Verfahren. Hierhin fällt ein symmetrischer Schlüssel im Schlüsselsatz.",
  key_unusable: "Der Schlüssel im Schlüsselsatz ist nicht lesbar.",
  signature_invalid: "Die Unterschrift stimmt nicht.",
  issuer_mismatch: "Der Aussteller im Token ist nicht der hinterlegte.",
  audience_mismatch: "Das Publikum im Token ist keines der erwarteten.",
  expired: "Das Token ist abgelaufen.",
  not_yet_valid: "Das Token gilt noch nicht.",
  issued_in_the_future: "Das Token ist in der Zukunft ausgegeben.",
  no_expiry: "Das Token nennt kein Ende.",
  subject_missing: "Der Anspruch für die Identität fehlt oder ist leer.",
  subject_too_long: "Die Identität ist länger als 320 Zeichen.",
  role_claim_not_allowed: "Der Rollenanspruch nennt eine Rolle, die ein fremdes Token nicht bekommt.",
  no_provider: "Zu diesem Aussteller ist in dieser Umgebung kein Anbieter hinterlegt.",
  no_key_set: "Der Schlüsselsatz des Ausstellers war nicht zu holen.",
} as const;

export type AuthThirdPartyRefusalId = keyof typeof AUTH_THIRD_PARTY_REFUSALS;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authThirdPartyTexts(): string[] {
  return [
    AUTH_THIRD_PARTY_WHAT,
    AUTH_THIRD_PARTY_VERSUS_OIDC,
    AUTH_THIRD_PARTY_NO_ACCOUNT,
    AUTH_THIRD_PARTY_NO_REVOCATION,
    AUTH_THIRD_PARTY_KEY_STILL_REQUIRED,
    AUTH_THIRD_PARTY_OWN_TOKEN_FIRST,
    AUTH_THIRD_PARTY_CHECKS,
    AUTH_THIRD_PARTY_ALGORITHM_FROM_LIST,
    AUTH_THIRD_PARTY_HOLE_NONE,
    AUTH_THIRD_PARTY_HOLE_SYMMETRIC,
    AUTH_THIRD_PARTY_CLOCK_SKEW,
    AUTH_THIRD_PARTY_EXPIRY_REQUIRED,
    AUTH_THIRD_PARTY_NO_LIFETIME_CAP,
    AUTH_THIRD_PARTY_ROLE_CEILING,
    AUTH_THIRD_PARTY_ROLE_WHY,
    AUTH_THIRD_PARTY_ROLE_WHERE,
    AUTH_THIRD_PARTY_ROLE_ALTERNATIVE,
    AUTH_THIRD_PARTY_ROLE_MAPPING,
    AUTH_THIRD_PARTY_NO_SILENT_DOWNGRADE,
    AUTH_THIRD_PARTY_SAME_RLS_PATH,
    AUTH_THIRD_PARTY_ISS_IN_CLAIMS,
    AUTH_THIRD_PARTY_EXTERNAL_CLAIMS,
    AUTH_THIRD_PARTY_OWN_CLAIMS_WIN,
    AUTH_THIRD_PARTY_NO_INVENTED_CLAIMS,
    AUTH_THIRD_PARTY_JWKS_WHEN,
    AUTH_THIRD_PARTY_JWKS_LIMITS,
    AUTH_THIRD_PARTY_JWKS_EGRESS,
    AUTH_THIRD_PARTY_JWKS_FAILURE,
    AUTH_THIRD_PARTY_JWKS_ROTATION,
    AUTH_THIRD_PARTY_NO_EDIT,
    AUTH_THIRD_PARTY_NO_TEST_CALL,
    AUTH_THIRD_PARTY_NO_DISCOVERY,
    AUTH_THIRD_PARTY_NO_ACCOUNT_FEATURES,
    AUTH_THIRD_PARTY_NO_LIST,
    ...Object.values(AUTH_THIRD_PARTY_ROLE_TEXTS),
    ...Object.values(AUTH_THIRD_PARTY_REJECTIONS),
    ...Object.values(AUTH_THIRD_PARTY_REFUSALS),
  ];
}
