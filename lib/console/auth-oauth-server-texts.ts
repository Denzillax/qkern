/**
 * Die Texte von Auth → OAuth-Server (2.82), deutsch und an einer Stelle.
 *
 * Gleiche Bauart wie `auth-third-party-texts` (2.80): Der Schluessel ist der
 * deutsche Text, die Console uebersetzt ihn ueber ihren Katalog, und der Vertrag
 * `console-i18n-contract` liest diese Tabellen mit und verlangt fuer jeden Text
 * en, fr und it. Ein eigenes Modul braucht es, weil die Ansicht `t(variable)`
 * aufruft und ein Text hinter einer Variablen durch die Suche nach `t("...")`
 * faellt.
 *
 * Das Modul ist rein: keine Farbe, keine Datenbank, kein React.
 *
 * Der Platzhalter, den diese Seite ersetzt, sagte: "QKERN selbst als
 * OAuth-Anbieter für andere Apps. Für die AI Bridge vorgesehen, noch nicht
 * gebaut." Gebaut ist jetzt genau ein Ablauf, und die Texte hier sagen, welcher,
 * was er kostet und was daneben weiterhin fehlt.
 */

/* ------------------------------------------------------------------ *
 * Was diese Seite tut
 * ------------------------------------------------------------------ */

/** Was der OAuth-Server ist, in einem Satz. */
export const AUTH_OAUTH_WHAT =
  "Hier gibt QKERN eigene Token an fremde Anwendungen aus, im Namen eines Nutzers dieses Projekts. Eine Anwendung ist als Client hinterlegt, der Nutzer stimmt zu, und die Anwendung arbeitet danach als dieser Nutzer, begrenzt auf die Bereiche, denen er zugestimmt hat.";

/** Der Unterschied zu den fremden Anbietern, und er ist die Richtung. */
export const AUTH_OAUTH_VERSUS_THIRD_PARTY =
  "Das ist das Gegenstück zu Auth → Fremde Anbieter. Dort nimmt QKERN Token an, die ein anderer ausgegeben hat; hier gibt QKERN Token aus, die ein anderer benutzt. Die Richtung dreht die Frage: dort ging es darum, wem QKERN glaubt, hier darum, was QKERN zusagt.";

/** Genau ein Ablauf. */
export const AUTH_OAUTH_ONE_FLOW =
  "Gebaut ist genau ein Ablauf: Authorization Code mit PKCE. Kein impliziter Ablauf, kein Passwort-Ablauf, kein Client-Credentials-Ablauf, kein Refresh Token. Jede Auslassung steht unten mit ihrem Grund, und keine davon ist ein Versehen.";

/** Der 302, und warum es ihn nicht gibt. */
export const AUTH_OAUTH_NO_REDIRECT =
  "QKERN schickt selbst keinen 302 an ein Rücksprungziel. Die Zustimmung antwortet mit JSON: dem Code, dem Ziel und dem state. Die Anwendung baut ihre Adresse selbst. Dieselbe Grenze gilt seit 2.54 für die Rücksprungziele der Anmeldung, und sie gilt aus demselben Grund: Ein Ziel, das ein Dienst selbst anspringt, ist eine Fläche, auf der jede Lücke in der Prüfung sofort ein offener Umleiter ist.";

/** Und die Folge daraus für das Rücksprungziel. */
export const AUTH_OAUTH_TARGET_IS_A_BINDING =
  "Das Rücksprungziel ist deshalb hier keine Adresse, an die QKERN jemanden schickt, sondern eine Bindung des Codes. Es wird Zeichen für Zeichen mit dem verglichen, was die Anwendung beim Einlösen mitschickt. Abfrage und Fragment sind darin verboten: Zwei Schreibweisen derselben Abfrage wären zwei Werte für denselben Ort. Wer Zustand durchschleifen will, nimmt state.";

/** Es gibt keine Zustimmungsseite von QKERN. */
export const AUTH_OAUTH_NO_CONSENT_SCREEN =
  "Es gibt keine Zustimmungsseite von QKERN. Die Anwendung, in der der Nutzer angemeldet ist, zeigt ihm, was er erlaubt, und ruft danach die Route. Das ist eine Verlagerung, und sie wird hier gesagt statt verschwiegen: QKERN kann nicht beweisen, dass der Nutzer eine Liste gesehen hat. Eine eigene Seite dafür hiesse, einen Anmeldefluss im Browser zu bauen, und das ist ein eigener Schnitt.";

/** Und was stattdessen in der Datenbank steht. */
export const AUTH_OAUTH_CONSENT_IS_A_ROW =
  "Was stattdessen belegt ist: Eine Zustimmung ist eine Zeile. Die Anwendung erteilt sie über eine eigene Route, mit dem Access Token des Nutzers und den Bereichen ausdrücklich genannt, und erst danach gibt QKERN einen Code zu diesen Bereichen heraus. Belegt ist damit, dass ein Aufrufer mit dem gültigen Token dieses Nutzers genau diese Bereiche genannt hat, zu diesem Zeitpunkt, in einer Anfrage, die nichts anderes tut.";

/** Und die Grenze davon, noch einmal deutlich. */
export const AUTH_OAUTH_CONSENT_PROVES_NOT =
  "Nicht belegt ist, dass ein Mensch eine Liste gelesen hat. Zwischen der Anwendung und dem Nutzer steht weiterhin nur die Anwendung. Der Unterschied zu vorher ist trotzdem gross: Die Zustimmung ist jetzt eine Tatsache in der Datenbank mit Zeitpunkt und Bereichen statt einer Behauptung, die mit dem Token abläuft.";

/** Was passiert, wenn die Zustimmung fehlt. */
export const AUTH_OAUTH_CONSENT_REQUIRED =
  "Ohne Zustimmung gibt es keinen Code. Verlangt eine Anwendung Bereiche, zu denen dieser Nutzer nichts erteilt hat, wird der Anlauf abgewiesen, und zwar mit eigenem Grund und nicht als allgemeine Ablehnung.";

/** Warum genau diese Bereiche und nicht mindestens diese. */
export const AUTH_OAUTH_CONSENT_EXACT_SCOPES =
  "Verglichen wird auf genau diese Bereiche und nicht auf mindestens diese. Eine Zustimmung über Lesen und Schreiben deckt einen Anlauf über Lesen allein also nicht. Der Grund ist der Widerruf: Würden mehrere Zeilen passen, entschiede die Reihenfolge der Zeilen, an welcher der Code hängt, und wer widerruft, wüsste nicht, ob er das Token getroffen hat.";

/** Zweimal dasselbe ist einmal. */
export const AUTH_OAUTH_CONSENT_SAME_TWICE =
  "Dieselben Bereiche für denselben Client sind keine zweite Zustimmung, sondern dieselbe, und sie behält ihren ursprünglichen Zeitpunkt. Andere Bereiche sind etwas anderes und werden eine zweite Zeile; die erste bleibt stehen und gilt weiter. Sie stillschweigend mit zu widerrufen wäre ein Widerruf, den niemand verlangt hat.";

/* ------------------------------------------------------------------ *
 * Der Client
 * ------------------------------------------------------------------ */

/** Kein Geheimnis. */
export const AUTH_OAUTH_PUBLIC_CLIENT =
  "Ein Client hier ist ein öffentlicher Client und hat kein Geheimnis. Es gibt keins anzulegen, keins zu zeigen und keins zu drehen.";

/** Und warum das keine Lücke ist. */
export const AUTH_OAUTH_WHY_NO_SECRET =
  "Ein Client ist eine Anwendung, die der Nutzer installiert oder im Browser lädt. Ein Geheimnis darin ist keins: Es liegt im Programmpaket oder im JavaScript und ist mit einem Editor zu lesen. PKCE ist genau dafür da. Der Prüftext entsteht bei jedem Anlauf neu, er verlässt die Anwendung nie, und nur seine Prüfsumme geht durch den Browser. Ein abgefangener Code ohne Prüftext ist wertlos.";

/** Der Name ist die Kennung. */
export const AUTH_OAUTH_NAME_IS_CLIENT_ID =
  "Der Name ist gleichzeitig die client_id, die die Anwendung mitschickt. Eine zweite, zufällige Kennung daneben wäre ein zweiter Bezeichner für dieselbe Sache, und die Console müsste erklären, welchen der Entwickler in seine Anwendung schreibt.";

/** Kein Bearbeiten. */
export const AUTH_OAUTH_NO_EDIT =
  "Ein Client wird angelegt und entfernt, nicht bearbeitet. Ein Ändern der Rücksprungziele oder der Bereiche würde die Zusage ändern, unter der ein Nutzer zugestimmt hat, ohne dass Name, Alter oder Audit-Zeile sich ändern. Die Datenbank hat auf dieser Tabelle darum gar kein Recht zum Ändern.";

/* ------------------------------------------------------------------ *
 * Die Bereiche
 * ------------------------------------------------------------------ */

/** Was ein Bereich ist. */
export const AUTH_OAUTH_SCOPES_WHAT =
  "Ein Bereich ist, was der Nutzer der Anwendung erlaubt. Am Client steht, was sie höchstens verlangen darf; am Token steht, was er wirklich zugestimmt hat. Weniger ist der häufige Fall und in Ordnung.";

/** Warum kein Bereich je Tabelle. */
export const AUTH_OAUTH_NO_TABLE_SCOPES =
  "Es gibt keinen Bereich je Tabelle, und das ist Absicht: Die Zeilensicherheit beantwortet die Frage schon, und zwar feiner. Eine Policy entscheidet je Zeile; ein Bereich je Tabelle könnte nur die Tabelle sperren. Zwei Systeme für dieselbe Frage hätten zwei Antworten, und diese Seite müsste erklären, welche gilt.";

/** Kein stilles Kürzen. */
export const AUTH_OAUTH_NO_SILENT_NARROWING =
  "Verlangt eine Anwendung mehr, als ihr Client darf, wird der Anlauf abgewiesen und nicht still gekürzt. Ein stilles Kürzen sähe für die Anwendung wie ein Erfolg aus, und sie baute danach auf einem Recht, das sie nicht hat.";

/** Die Bedeutung je Bereich, für die Ansicht. */
export const AUTH_OAUTH_SCOPE_TEXTS = {
  "identity:read":
    "Wer hat zugestimmt: Kennung und E-Mail-Adresse dieses Nutzers, abrufbar unter /auth/oauth/userinfo. Keine Metadaten, kein Sitzungsstand, keine Angabe über einen zweiten Faktor.",
  "data:read":
    "Lesen durch die Data API, unter der Zeilensicherheit, als dieser Nutzer. Eine Policy entscheidet weiterhin je Zeile.",
  "data:write":
    "Schreiben durch die Data API, unter derselben Zeilensicherheit. Getrennt vom Lesen, weil das der Unterschied ist, den ein Nutzer wirklich versteht: Eine Anwendung, die nur anzeigt, soll nicht löschen können.",
} as const;

export type AuthOAuthScopeId = keyof typeof AUTH_OAUTH_SCOPE_TEXTS;

/* ------------------------------------------------------------------ *
 * Der Code
 * ------------------------------------------------------------------ */

/** Was der Code ist. */
export const AUTH_OAUTH_CODE_WHAT =
  "Der Code ist kurzlebig und einmalig. Er gilt 60 Sekunden, und das reicht für einen Rücksprung und einen Netzwerkumlauf. Gespeichert ist nur seine Prüfsumme; wer die Tabelle liest, kann damit nichts einlösen.";

/** Die vier Bindungen. */
export const AUTH_OAUTH_CODE_BINDINGS =
  "Er ist an vier Dinge gebunden, und jede Bindung schliesst einen Angriff: an den Client, damit ein Code für eine andere Anwendung hier nichts wert ist; an das Rücksprungziel, damit ein Einlösen an einem anderen Ziel fällt; an die Prüfsumme des Prüftexts, damit ein abgefangener Code ohne den Prüftext wertlos ist; und an den Nutzer, der zugestimmt hat.";

/** Der Verbrauch, und die Reihenfolge. */
export const AUTH_OAUTH_CODE_CONSUMED_FIRST =
  "Beim Einlösen wird der Code verbraucht, bevor irgendetwas anderes geprüft wird, und zwar in derselben Anweisung, die ihn findet. Ein Code, der einmal vorgezeigt wurde, ist weg, gleich wie es weitergeht. Wer ihn erst nach erfolgreicher Prüfung verbrauchte, liesse einem Angreifer beliebig viele Versuche mit dem Prüftext.";

/** Das zweite Einlösen. */
export const AUTH_OAUTH_REPLAY_REFUSED =
  "Ein zweites Einlösen desselben Codes ist ein Wiedereinspielangriff und wird abgewiesen, auch dann, wenn beide Anfragen gleichzeitig kommen. Zwei Türen halten das: der Verbrauchsvermerk am Code und die Bedingung, dass aus einem Code genau ein Token entstehen darf.";

/** PKCE, und nur S256. */
export const AUTH_OAUTH_S256_ONLY =
  "Als Verfahren für die Prüfsumme gilt nur S256. plain heisst in PKCE: Die Prüfsumme ist der Prüftext. Dann ist ein abgefangener Anlauf ein abgefangener Prüftext, und PKCE tut nichts mehr. Die Datenbank lässt in der Spalte für das Verfahren gar keinen anderen Wert zu.";

/** Der Vergleich in fester Zeit. */
export const AUTH_OAUTH_CONSTANT_TIME =
  "Der Prüftext wird in fester Zeit gegen die gespeicherte Prüfsumme verglichen. Ein Vergleich, der beim ersten abweichenden Zeichen aufhört, verrät über die Dauer, wie viele Zeichen gestimmt haben, und das ist der Weg, eine Prüfsumme Zeichen für Zeichen zu erraten.";

/** Kein Grund in der Antwort. */
export const AUTH_OAUTH_NO_REASON_ON_EXCHANGE =
  "Ein abgewiesenes Einlösen bekommt keinen Grund, sondern nur eine Ablehnung. Die Tür steht offen, und was sie sagt, sagt sie jedem; wer erfährt, ob sein Ziel oder sein Prüftext nicht gepasst hat, bekommt ein Werkzeug zum Probieren. Der Betreiber liest den Grund unter Auth → Audit-Log.";

/* ------------------------------------------------------------------ *
 * Das Token
 * ------------------------------------------------------------------ */

/** Nicht dasselbe wie ein Sitzungstoken. */
export const AUTH_OAUTH_NOT_A_SESSION_TOKEN =
  "Das ausgegebene Token ist nicht dasselbe wie das Token der Projekt-Anmeldung. Jenes ist ein signiertes JWT und gilt, weil eine Unterschrift stimmt. Dieses ist ein Zufallswert und gilt, weil eine Zeile existiert.";

/** Und warum. */
export const AUTH_OAUTH_WHY_OPAQUE =
  "Der Grund ist der Widerruf. Ein signiertes Token gilt bis zu seinem Ende, und wer es vorher stoppen will, braucht eine Liste der gestoppten, also dieselbe Tabelle, nur umgekehrt. Ein Token für eine fremde Anwendung muss stoppbar sein: Der Nutzer hat einer Anwendung zugestimmt, nicht einer Frist.";

/** Der Preis. */
export const AUTH_OAUTH_OPAQUE_COST =
  "Der Preis steht dazu: Jede Anfrage mit einem solchen Token kostet eine Datenbankabfrage. Ein signiertes Token kostet keine. Das ist der Handel, und er geht hier zugunsten des Widerrufs aus.";

/** Die Laufzeit. */
export const AUTH_OAUTH_TOKEN_LIFETIME =
  "Ein Token gilt eine Stunde. Es gibt kein Refresh Token, also ist das die Zeit, die eine Anwendung ohne neue Zustimmung arbeitet. Kürzer wäre eine Zustimmung alle paar Minuten, und die klickt irgendwann jeder weg, ohne sie zu lesen.";

/** Die Sitzung, die es nicht gibt. */
export const AUTH_OAUTH_NO_SESSION =
  "Das Token hängt an keiner Sitzung. Es überlebt die Abmeldung des Nutzers in der eigenen Anwendung des Projekts, und unter Auth → Sitzungen ist es nicht zu beenden. Wer es beenden will, entfernt den Client.";

/** Der gesperrte Nutzer. */
export const AUTH_OAUTH_DISABLED_USER =
  "Ein gesperrter oder gelöschter Nutzer lässt sein Token sofort fallen, bei der nächsten Anfrage. Ohne das wäre eine Sperrung unter Auth → Nutzer eine Sperrung nur für die eigene Anwendung, und ein fremder Client arbeitete weiter im Namen eines Menschen, dem das Projekt den Zugang genommen hat.";

/* ------------------------------------------------------------------ *
 * Die Rolle und die Zeilensicherheit
 * ------------------------------------------------------------------ */

/** Die Entscheidung. */
export const AUTH_OAUTH_ROLE_CEILING =
  "Ein Token dieses Ablaufs bekommt immer die Rolle authenticated. Nie service_role, und auch nie anon.";

/** Und warum. */
export const AUTH_OAUTH_ROLE_WHY =
  "service_role umgeht in der Data API jede Policy. Ein fremder Client mit dieser Rolle läse jede Zeile jeder Tabelle, ganz gleich, welcher Nutzer zugestimmt hat. Das ist keine Einstellung mit Warnhinweis, das ist eine Tür.";

/** Wo die Grenze steht. */
export const AUTH_OAUTH_ROLE_WHERE =
  "Die Grenze steht nicht als Prüfung, sondern als Abwesenheit: Es gibt am Client und am Token keine Spalte für eine Rolle, also keinen Wert, den jemand verstellen könnte. Die Rolle wird beim Prüfen gesetzt und nicht gelesen. Die Data API weist zusätzlich ab, was sie nicht annehmen darf.";

/** Der Ausweg. */
export const AUTH_OAUTH_ROLE_ALTERNATIVE =
  "Wer eine Anfrage ohne Policies braucht, nimmt einen Service Key dieser Projektumgebung unter Einstellungen → API-Keys. Den gibt QKERN aus, er ist widerrufbar, und seine Ausgabe steht in der Audit-Kette.";

/** Derselbe Weg wie beim eigenen Token. */
export const AUTH_OAUTH_SAME_RLS_PATH =
  "Die Ansprüche gehen genau denselben Weg wie die eines Tokens der eigenen Anmeldung: request.jwt.claims mit allen Ansprüchen als JSON, request.jwt.claim.role und request.jwt.claim.sub, je nur für diese eine Transaktion. Es gibt keine Abkürzung daneben; eine zweite Stelle wären zwei Wahrheiten.";

/** Und wie eine Policy den Unterschied sieht. */
export const AUTH_OAUTH_CLAIMS_FOR_POLICIES =
  "Was dazukommt, sind drei Ansprüche: token_use mit dem Wert oauth, client_id mit dem Namen des Clients und scope mit den zugestimmten Bereichen. Eine Policy kann damit einem fremden Client weniger erlauben als der eigenen Anwendung, obwohl beide denselben Nutzer nennen. Ohne sie wären die beiden Fälle nicht auseinanderzuhalten.";

/** Der Projekt-Key bleibt nötig. */
export const AUTH_OAUTH_KEY_STILL_REQUIRED =
  "Ein OAuth-Token allein öffnet die Data API nicht. Jede Anfrage bringt weiterhin den Public Key dieser Projektumgebung mit. Das Token sagt, wer der Aufrufer ist; der Key ist die Zusage dieses Projekts, dass diese Anwendung hier anklopfen darf, und er ist widerrufbar.";

/** Nur die Data API. */
export const AUTH_OAUTH_DATA_API_ONLY =
  "Ein OAuth-Token öffnet nur die Data API. Queues, Functions und Storage nehmen es nicht an, und das ist keine Vergesslichkeit: Es gibt heute keinen Bereich, der eine Queue oder eine Function beschreibt, und ein Token, das dort mitliefe, hätte eine Erlaubnis, die niemand hinschreiben kann. Neue Türen sind darum voreingestellt geschlossen.";

/* ------------------------------------------------------------------ *
 * Der Widerruf
 * ------------------------------------------------------------------ */

/** Der grobe Widerruf. */
export const AUTH_OAUTH_REVOCATION =
  "Der grobe Widerruf geht über den Client. Wer ihn entfernt, lässt seine Codes, alle seine Token und alle seine Zustimmungen fallen, von allen Nutzern, sofort.";

/** Der feine Widerruf, je Zustimmung. */
export const AUTH_OAUTH_REVOCATION_PER_CONSENT =
  "Der feine Widerruf geht über die einzelne Zustimmung. Er wirkt sofort: Ein Token gilt, weil eine Zeile existiert, und nur, solange seine Zustimmung gilt. Es braucht keinen Lauf, der Token einsammelt, und keine Frist.";

/** Und was der Widerruf mit der Zeile macht. */
export const AUTH_OAUTH_REVOCATION_KEEPS_THE_ROW =
  "Die widerrufene Zustimmung bleibt stehen, mit ihrem Zeitpunkt und dem des Widerrufs. Widerrufen ist nicht löschen: Wer widerruft, will die Spur behalten, und die Datenbank gibt für diese Tabelle gar kein Recht zum Löschen. Entfernt jemand dagegen den Client, verschwinden seine Zustimmungen wirklich, und das ist der Unterschied zwischen den beiden Knöpfen auf dieser Seite.";

/** Was der Nutzer selbst nicht kann. */
export const AUTH_OAUTH_NO_SELF_SERVICE_REVOCATION =
  "Ein Nutzer kann seine eigene Zustimmung hier nicht selbst zurücknehmen. Es gibt nur diesen Weg über den Betreiber. Eine Seite, auf der ein Nutzer seine Erlaubnisse verwaltet, wäre wieder eine Seite im Browser, und die gehört zu demselben Schnitt wie die fehlende Zustimmungsseite.";

/* ------------------------------------------------------------------ *
 * Was nicht gebaut ist
 * ------------------------------------------------------------------ */

/** Die vier Auslassungen, je mit Grund. */
export const AUTH_OAUTH_OMISSION_TEXTS = {
  implicit:
    "Impliziter Ablauf: Er gibt das Token selbst an das Rücksprungziel zurück, also durch den Browser, in dessen Adresszeile und in dessen Verlauf. Es gibt hier keinen Weg, der ein Token an ein Rücksprungziel schreibt.",
  password:
    "Passwort-Ablauf: Er verlangt, dass die fremde Anwendung das Passwort des Nutzers sieht und weiterschickt. Genau das soll ein OAuth-Ablauf verhindern. Wer sich mit Passwort anmelden will, nimmt die eigene Anmeldung dieses Projekts.",
  client_credentials:
    "Client-Credentials-Ablauf: Ein Token ohne Nutzer, also ein Schlüssel für eine Maschine. Den gibt QKERN schon aus, er heisst Service Key, er ist widerrufbar, und seine Ausgabe steht im Audit. Ein zweiter Weg zum selben Ziel wäre eine zweite Stelle, an der Rechte entstehen.",
  refresh_token:
    "Refresh Token: Ein Dauerzugang für eine fremde Anwendung ist eine eigene Entscheidung mit eigener Widerrufsfläche. Läuft ein Token ab, geht die Anwendung denselben Weg noch einmal, und der Nutzer sieht dabei wieder, wem er was erlaubt.",
} as const;

export type AuthOAuthOmissionId = keyof typeof AUTH_OAUTH_OMISSION_TEXTS;

/** Kein Verzeichnisdokument. */
export const AUTH_OAUTH_NO_DISCOVERY =
  "Es gibt kein Dokument unter .well-known/oauth-authorization-server. Eine Anwendung, die diesen Server benutzt, kennt ihn ohnehin, und ein Verzeichnis, das Verfahren aufzählt, die es nicht gibt, wäre eine Zusage ohne Deckung.";

/** Die Liste je Client, und was sie nicht zeigt. */
export const AUTH_OAUTH_GRANT_LIST =
  "Je Client steht hier die Zahl seiner Zustimmungen. Wer zugestimmt hat, zu welchen Bereichen, seit wann und ob die Zustimmung noch gilt, steht unter Auth → Zustimmungen. Was eine Anwendung mit ihrem Zugang wirklich getan hat, steht unter Auth → Audit-Log.";

/** Wo die ganze Liste steht (2.93). */
export const AUTH_OAUTH_CONSENTS_OWN_PAGE =
  "Die vollständige Liste steht unter Auth → Zustimmungen, nach Nutzer geordnet und mit den Token, die auf einer Zustimmung ausgegeben wurden. Dort wird auch eine einzelne Zustimmung zurückgenommen und ein einzelnes Token.";

/** Und der Rand der Liste. */
export const AUTH_OAUTH_GRANT_LIST_TRUNCATED =
  "Es gibt mehr Zustimmungen, als diese Seite zeigt. Die Liste ist abgeschnitten, und das steht hier, weil eine Liste, die stillschweigend endet, die unehrlichste Form von Vollständigkeit wäre.";

/** Kein Aufräumer. */
export const AUTH_OAUTH_NO_CLEANUP =
  "Abgelaufene Codes und Token werden nicht aufgeräumt. Sie gelten nicht mehr, denn die Prüfung sieht auf die Uhr, aber die Zeilen bleiben stehen und die Tabellen wachsen. Das steht hier, weil es ehrlicher ist als ein Auftrag, der nicht läuft.";

/** Kein eigenes Rate Limit. */
export const AUTH_OAUTH_NO_RATE_LIMIT =
  "Für das Einlösen gibt es kein eigenes Rate Limit. Ein Code ist ein Zufallswert mit 256 Bit, er gilt 60 Sekunden, und er ist nach dem ersten Vorzeigen weg; es gibt hier nichts zu erraten, wofür ein Zähler die richtige Antwort wäre.";

/** Kein vertraulicher Client. */
export const AUTH_OAUTH_NO_CONFIDENTIAL_CLIENT =
  "Es gibt keinen vertraulichen Client, also keine Anwendung, die sich mit einem hinterlegten Geheimnis ausweist. Eine Spalte dafür, die heute leer ist, würde morgen behaupten, dieser Client sei geprüft. Sie kommt, wenn der vertrauliche Client kommt.";

/* ------------------------------------------------------------------ *
 * Die Ablehnungen
 * ------------------------------------------------------------------ */

/** Warum ein Client nicht angelegt werden konnte. Die Schluessel kommen aus der Route. */
export const AUTH_OAUTH_REJECTIONS = {
  not_an_object: "Die Eingabe ist kein Client.",
  name_invalid: "Der Name muss klein geschrieben sein, mit Buchstaben beginnen und darf Ziffern, Bindestrich und Unterstrich enthalten.",
  redirect_uris_empty: "Mindestens ein Rücksprungziel ist nötig.",
  too_many_redirect_uris: "Mehr Rücksprungziele, als ein Client führen darf.",
  redirect_uri_too_long: "Ein Rücksprungziel ist zu lang.",
  redirect_uri_not_a_url: "Ein Rücksprungziel ist keine vollständige Adresse.",
  redirect_uri_insecure_scheme: "Ein Rücksprungziel ist weder https noch ein lokaler Entwicklungshost.",
  redirect_uri_carries_credentials: "Ein Rücksprungziel trägt Anmeldedaten im Bezeichner.",
  redirect_uri_wildcard: "Ein Rücksprungziel enthält einen Stern. Platzhalter gibt es an keiner Stelle dieses Produkts.",
  redirect_uri_carries_query: "Ein Rücksprungziel trägt eine Abfrage. Wer Zustand durchschleifen will, nimmt state.",
  redirect_uri_carries_fragment: "Ein Rücksprungziel trägt ein Fragment. Der Browser schickt es gar nicht mit.",
  redirect_uri_duplicate: "Ein Rücksprungziel steht zweimal in der Liste.",
  scopes_empty: "Mindestens ein Bereich ist nötig.",
  scope_unknown: "Ein Bereich ist keiner der drei, die es gibt.",
  scope_duplicate: "Ein Bereich steht zweimal in der Liste.",
  too_many_clients: "Diese Umgebung führt schon so viele Clients, wie erlaubt sind.",
  duplicate: "Ein Client mit diesem Namen steht in dieser Umgebung schon.",
  response_type_unsupported: "Dieser Server kennt nur response_type=code.",
  client_unknown: "Zu diesem Namen ist in dieser Umgebung kein Client hinterlegt.",
  redirect_uri_unknown: "Dieses Rücksprungziel ist keines der hinterlegten.",
  scope_not_granted: "Der Anlauf verlangt einen Bereich, den dieser Client nicht führt.",
  consent_missing: "Zu genau diesen Bereichen gibt es keine geltende Zustimmung dieses Nutzers für diesen Client.",
  challenge_invalid: "Die Prüfsumme des Prüftexts hat nicht die Form eines SHA-256 in base64url.",
  challenge_method_unsupported: "Dieser Server kennt nur S256 als Verfahren für die Prüfsumme.",
  state_invalid: "Der state ist zu lang oder enthält Zeichen, die hier nicht vorkommen dürfen.",
  grant_type_unsupported: "Dieser Server kennt nur grant_type=authorization_code.",
  code_invalid: "Der Code hat nicht die Form eines Codes dieses Servers.",
  verifier_invalid: "Der Prüftext ist kürzer als 43 Zeichen oder enthält Zeichen, die dort nicht vorkommen dürfen.",
} as const;

export type AuthOAuthRejectionId = keyof typeof AUTH_OAUTH_REJECTIONS;

/** Jeder Text dieses Moduls, fuer den Uebersetzungsvertrag. */
export function authOAuthServerTexts(): string[] {
  return [
    AUTH_OAUTH_WHAT,
    AUTH_OAUTH_VERSUS_THIRD_PARTY,
    AUTH_OAUTH_ONE_FLOW,
    AUTH_OAUTH_NO_REDIRECT,
    AUTH_OAUTH_TARGET_IS_A_BINDING,
    AUTH_OAUTH_NO_CONSENT_SCREEN,
    AUTH_OAUTH_CONSENT_IS_A_ROW,
    AUTH_OAUTH_CONSENT_PROVES_NOT,
    AUTH_OAUTH_CONSENT_REQUIRED,
    AUTH_OAUTH_CONSENT_EXACT_SCOPES,
    AUTH_OAUTH_CONSENT_SAME_TWICE,
    AUTH_OAUTH_REVOCATION_PER_CONSENT,
    AUTH_OAUTH_REVOCATION_KEEPS_THE_ROW,
    AUTH_OAUTH_NO_SELF_SERVICE_REVOCATION,
    AUTH_OAUTH_GRANT_LIST,
    AUTH_OAUTH_CONSENTS_OWN_PAGE,
    AUTH_OAUTH_GRANT_LIST_TRUNCATED,
    AUTH_OAUTH_PUBLIC_CLIENT,
    AUTH_OAUTH_WHY_NO_SECRET,
    AUTH_OAUTH_NAME_IS_CLIENT_ID,
    AUTH_OAUTH_NO_EDIT,
    AUTH_OAUTH_SCOPES_WHAT,
    AUTH_OAUTH_NO_TABLE_SCOPES,
    AUTH_OAUTH_NO_SILENT_NARROWING,
    AUTH_OAUTH_CODE_WHAT,
    AUTH_OAUTH_CODE_BINDINGS,
    AUTH_OAUTH_CODE_CONSUMED_FIRST,
    AUTH_OAUTH_REPLAY_REFUSED,
    AUTH_OAUTH_S256_ONLY,
    AUTH_OAUTH_CONSTANT_TIME,
    AUTH_OAUTH_NO_REASON_ON_EXCHANGE,
    AUTH_OAUTH_NOT_A_SESSION_TOKEN,
    AUTH_OAUTH_WHY_OPAQUE,
    AUTH_OAUTH_OPAQUE_COST,
    AUTH_OAUTH_TOKEN_LIFETIME,
    AUTH_OAUTH_NO_SESSION,
    AUTH_OAUTH_DISABLED_USER,
    AUTH_OAUTH_ROLE_CEILING,
    AUTH_OAUTH_ROLE_WHY,
    AUTH_OAUTH_ROLE_WHERE,
    AUTH_OAUTH_ROLE_ALTERNATIVE,
    AUTH_OAUTH_SAME_RLS_PATH,
    AUTH_OAUTH_CLAIMS_FOR_POLICIES,
    AUTH_OAUTH_KEY_STILL_REQUIRED,
    AUTH_OAUTH_DATA_API_ONLY,
    AUTH_OAUTH_REVOCATION,
    AUTH_OAUTH_NO_DISCOVERY,
    AUTH_OAUTH_NO_CLEANUP,
    AUTH_OAUTH_NO_RATE_LIMIT,
    AUTH_OAUTH_NO_CONFIDENTIAL_CLIENT,
    ...Object.values(AUTH_OAUTH_SCOPE_TEXTS),
    ...Object.values(AUTH_OAUTH_OMISSION_TEXTS),
    ...Object.values(AUTH_OAUTH_REJECTIONS),
  ];
}
