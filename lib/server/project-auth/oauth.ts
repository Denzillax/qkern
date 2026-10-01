import { createHash, timingSafeEqual } from "node:crypto";

/**
 * QKERN als OAuth-Anbieter (2.82): Authorization Code mit PKCE, und nur das.
 *
 * Dieses Modul ist der Teil mit Sicherheitsgewicht, und darum ist es rein:
 * keine Datenbank, keine Zeit ausser der, die hereingegeben wird, kein React,
 * keine Farbe. Was hier entschieden wird, ist einzeln pruefbar.
 *
 * ## Das Gegenstueck zu 2.80, und der Unterschied in einem Satz
 *
 * Bei den fremden Anbietern (2.80) **nimmt** QKERN Token an, die ein anderer
 * ausgegeben hat. Hier **gibt** QKERN Token aus, die ein anderer benutzt. Die
 * Richtung dreht die Frage: Dort ging es darum, wem QKERN glaubt; hier geht es
 * darum, was QKERN zusagt.
 *
 * ## Genau ein Ablauf, und warum die anderen drei fehlen
 *
 * 1. **Impliziter Ablauf** (`response_type=token`): Er gibt das Token selbst an
 *    das Ruecksprungziel zurueck, also durch den Browser, in dessen Adresszeile
 *    und in dessen Verlauf. Es gibt hier keinen `response_type` mit diesem Wert
 *    und keinen Weg, der ein Token an ein Ruecksprungziel schreibt.
 * 2. **Passwort-Ablauf** (`grant_type=password`): Er verlangt, dass die fremde
 *    Anwendung das Passwort des Nutzers sieht und weiterschickt. Genau das soll
 *    ein OAuth-Ablauf verhindern. Wer ihn daneben anbietet, hat den Zweck
 *    weggelassen und die Flaeche behalten. Wer sich mit Passwort anmelden will,
 *    nimmt `POST /auth/token` dieses Projekts; das ist die eigene Anmeldung und
 *    kein OAuth.
 * 3. **Client-Credentials-Ablauf** (`grant_type=client_credentials`): Ein Token
 *    ohne Nutzer, also ein Schluessel fuer eine Maschine. Den gibt QKERN schon
 *    aus, er heisst Service Key, er ist widerrufbar, und seine Ausgabe steht im
 *    Audit. Ein zweiter Weg zum selben Ziel waere eine zweite Stelle, an der
 *    Rechte entstehen, und zwei Stellen sind schwerer richtig zu halten als
 *    eine.
 * 4. **Refresh Token** (`grant_type=refresh_token`): Ein Dauerzugang fuer eine
 *    fremde Anwendung ist eine eigene Entscheidung mit eigener
 *    Widerrufsflaeche. Laeuft ein Token ab, geht die Anwendung denselben Weg
 *    noch einmal, und der Nutzer sieht dabei wieder, wem er was erlaubt.
 *
 * `PROJECT_AUTH_OAUTH_UNSUPPORTED_GRANTS` fuehrt die drei nicht gebauten
 * Verfahren als Werte, damit Route, Console und Test sie nennen koennen, ohne
 * sie zu erfinden, und damit ein Aufrufer, der eines von ihnen versucht, eine
 * Ablehnung mit Namen bekommt statt "ungueltige Anfrage".
 *
 * ## Warum der Client kein Geheimnis hat
 *
 * Ein Client ist eine Anwendung, die der Nutzer installiert oder im Browser
 * laedt. Ein Geheimnis darin liegt im Programmpaket oder im JavaScript und ist
 * mit einem Editor zu lesen. PKCE ist genau dafuer da: Der Prueftext entsteht
 * bei jedem Anlauf neu, er verlaesst die Anwendung nie, und nur seine
 * Pruefsumme geht durch den Browser. Darum gibt es in diesem Modul keinen
 * Begriff `clientSecret` und in Migration 0062 keine Spalte dafuer.
 *
 * ## Die Zustimmung ist eine Zeile (2.92)
 *
 * Bis 2.82 war die Zustimmung ein Vorgang ohne Spur: Wer zugestimmt hatte,
 * stand am Code und am Token, also an zwei kurzlebigen Dingen, und nach einer
 * Stunde war nichts mehr davon zu sehen. Seit 2.92 ist sie eine eigene Zeile
 * (Migration 0064) mit Nutzer, Client, Bereichen, Zeitpunkt und Widerruf, und
 * `authorizeOAuth` gibt keinen Code mehr aus, zu dem es keine gibt.
 *
 * **Was das belegt und was nicht.** QKERN hat weiterhin keine eigene
 * Zustimmungsseite; eine zu bauen hiesse, einen Anmeldefluss im Browser zu
 * bauen, und das ist ein eigener Schnitt. Belegt ist darum nicht, dass ein
 * Mensch eine Liste gelesen hat. Belegt ist, dass ein Aufrufer mit dem
 * gueltigen Access Token dieses Nutzers genau diese Bereiche ausdruecklich
 * genannt hat, zu diesem Zeitpunkt, in einer Anfrage, die nichts anderes tut.
 * Das ist schmaler als eine Zustimmungsseite und dafuer eine Tatsache in der
 * Datenbank statt einer Behauptung der Anwendung.
 *
 * ## Und der Satz, der die Grenze dieses Produkts haelt
 *
 * QKERN schickt selbst keinen 302 an ein Ruecksprungziel. Die Zustimmung
 * antwortet mit JSON: dem Code, dem Ziel und dem `state`. Die Anwendung baut
 * ihre Adresse selbst. Dieselbe Grenze zieht 2.54 bei den Ruecksprungzielen der
 * Anmeldung, und sie steht dort mit demselben Grund: Ein Weiterleitungsziel,
 * das ein Dienst selbst anspringt, ist eine Flaeche, auf der jede Luecke in der
 * Pruefung sofort ein offener Umleiter ist. Ein Wert, der nur verglichen und
 * zurueckgegeben wird, ist keine.
 */

/* ------------------------------------------------------------------ *
 * Die Bereiche
 * ------------------------------------------------------------------ */

/**
 * Die Bereiche, die es gibt. Die Liste ist geschlossen und steht noch einmal als
 * CHECK in Migration 0062, seit Migration 0073 in ihrer neuen Fassung.
 *
 * * `identity:read`: Wer hat zugestimmt. Kennung und E-Mail-Adresse dieses
 *   Nutzers, und sonst nichts. Keine Metadaten, kein Sitzungsstand, keine
 *   Angabe ueber einen zweiten Faktor: Das alles sind Zusagen ueber eine
 *   Anmeldung bei QKERN, und die gehoert nicht der fremden Anwendung.
 * * `data:read`: Lesen durch die Data API, unter der Zeilensicherheit, als
 *   dieser Nutzer.
 * * `data:write`: Schreiben durch die Data API, unter derselben
 *   Zeilensicherheit.
 *
 * Warum es keinen Bereich je Tabelle gibt: Die Zeilensicherheit beantwortet die
 * Frage schon, und zwar feiner. Eine Policy entscheidet je Zeile; ein Bereich je
 * Tabelle koennte nur die Tabelle sperren. Zwei Systeme fuer dieselbe Frage
 * haetten zwei Antworten, und die Console muesste erklaeren, welche gilt.
 *
 * ## Die sechs Bereiche neben der Data API (Migration 0073)
 *
 * Bis hierher beschrieb jeder Bereich eine Anfrage durch die Data API, und alles
 * andere hatte darum keinen. Die Folge war trotzdem eine Luecke und keine
 * Sperre: Der entfernte MCP-Server meldete zwoelf Werkzeuge fuer eine
 * OAuth-Sitzung gar nicht erst an, weil es keinen Satz gab, der sie beschreibt.
 * Ein Werkzeug ohne Bereich ist nicht sicher, es ist unerreichbar, und
 * `docs/PARITAET.md` hat das als Luecke gefuehrt und nicht als Zusage.
 *
 * Diese sechs sagen, was sie oeffnen, und nicht mehr:
 *
 * * `project:read`: Die Gestalt **dieser** Projektumgebung aus der Control
 *   Plane, ohne Zugangsdaten: der Eintrag der Umgebung und die geltende
 *   Automatisierungsregel mit ihrer Risikogrenze. Keine andere Umgebung, kein
 *   anderes Projekt, keine Organisation, keine Mitgliederliste.
 * * `storage:read`: Buckets, ihre festen Zugriffsregeln, Kontingente und
 *   Verbrauch, sowie begrenzte Metadaten der Objekte eines Buckets. **Kein
 *   Inhalt und keine Signatur.**
 * * `queues:read`: Queue-Definitionen und ihre Zaehler je Nachrichtenzustand.
 *   Keine Nachrichteninhalte.
 * * `queues:write`: Genau das Einstellen einer Nachricht. **Keine
 *   Worker-Operation**, also kein Claim, kein Lease, kein Renewal und kein
 *   Abschluss; die gibt es ueber MCP ueberhaupt nicht, und dieser Bereich macht
 *   sie nicht erreichbar.
 * * `logs:read`: Die Suche im begrenzten, bereits redigierten Audit-Log dieser
 *   Projektumgebung.
 * * `migrations:propose`: Das Anlegen einer unveraenderlichen
 *   Migrationsvorschau. **Kein Anwenden.** Vorschlagen und Anwenden sind zwei
 *   Saetze, und ein Bereich, der beides oeffnete, saegte an dem, was er nennt.
 *
 * ## `storage:write`, und warum er erst jetzt kommt (Migration 0078)
 *
 * Bis 2.115 fehlte er, und die Begruendung war, dass ihn nichts geprueft haette:
 * Der MCP-Server hatte kein schreibendes Storage-Werkzeug, und ein Bereich, den
 * niemand prueft, ist eine Beschriftung. Auf einer Zustimmungsseite ist eine
 * Beschriftung schlimmer als ein fehlender Eintrag, denn der Nutzer liest eine
 * Erlaubnis, die nirgends wirkt, und haelt sie fuer die Grenze. Er sollte mit dem
 * ersten Werkzeug kommen, das ihn braucht, und das ist er jetzt:
 *
 * * `storage:write`: Das Loeschen eines Objekts in einem Bucket dieser
 *   Projektumgebung, und nur das. **Kein Hochladen**, denn ein Hochladen ist bei
 *   QKERN Reservierung, Bytes beim Anbieter, Abschluss mit Pruefsumme und Scan,
 *   und ein Werkzeug, das die Bytes durch einen Modellkontext schiebt, kann die
 *   Zusage des Abschlusses nicht halten. **Kein Bucket**, denn Anlegen, Aendern
 *   und Entfernen eines Buckets verlangen die Betreiberrolle.
 *
 * Dieser Bereich traegt eine Decke, die `storage:read` nicht hat: Das
 * Loeschwerkzeug laeuft mit `authenticated` und der Kennung des zustimmenden
 * Nutzers, und damit entscheidet die Schreibregel des Buckets. Die
 * Betreiberrolle bekommt es ueber OAuth nicht. Ein Bucket mit `owner` gibt nur die
 * Objekte dieses Nutzers her, einer mit `private` keines. Der Grund steht unten
 * bei der Grenze, die diese Bereiche sonst nicht verschieben.
 *
 * Die HTTP-Tueren von Storage nehmen ein OAuth-Token weiterhin nicht an. Dieser
 * Bereich wirkt also am entfernten MCP-Server und nirgends sonst, und das sagt
 * die Console so.
 *
 * ## Was diese sechs **nicht** aendern
 *
 * Die HTTP-Tueren. `ProjectOAuthAdmission` bleibt bei `reject` fuer Queues,
 * Functions und Storage, und diese Bereiche aendern daran nichts. Das ist keine
 * Halbheit: Eine Tuer aufzumachen heisst, ihre Ansprueche, ihre Rolle und ihre
 * Ablehnungen zu pruefen, und das ist je Tuer ein eigener Schnitt. Was hier
 * entsteht, ist der Satz, den eine solche Tuer dann verlangen **kann**.
 *
 * ## Und die Grenze, die die lesenden nicht verschieben
 *
 * Die lesenden Storage-Werkzeuge und die Queues laufen im MCP-Server mit
 * `role: "admin"` im Namen des Betreibers, nicht unter einer Zeilensicherheit
 * des zustimmenden Nutzers. Ein Bucket hat keine Policy je Zeile, eine Queue
 * auch nicht. `storage:read` und `queues:read` sagen darum etwas ueber diese
 * Projektumgebung und nichts ueber die Daten eines Nutzers, und die Console sagt
 * das bei jedem der beiden.
 *
 * Beim Loeschen eines Objekts gilt das nicht, und zwar weil es dort nicht
 * genuegt. Eine Betreiberrolle gibt jedes Objekt jedes Buckets her, auch das
 * eines anderen Nutzers; bei einem Lesen bleibt das eine offene Grenze, bei
 * einem Loeschen waere es eine Rechteausweitung durch Zustimmung eines
 * Endnutzers. `qkern_storage_object_delete` laeuft darum mit `authenticated` und
 * der Kennung des zustimmenden Nutzers, und die Schreibregel des Buckets
 * entscheidet je Objekt.
 *
 * Getragen wird das von der Decke am Client: Welche Bereiche eine Anwendung
 * hoechstens verlangen darf, schreibt ein Owner oder Administrator der
 * Organisation, und ein Nutzer kann nur zustimmen, was dort schon steht. Ohne
 * diese Decke waere ein Bereich wie `project:read` eine Rechteausweitung durch
 * Zustimmung eines Endnutzers; mit ihr ist er die Erlaubnis, die der Betreiber
 * einer namentlich hinterlegten Anwendung geben wollte.
 */
export const PROJECT_AUTH_OAUTH_SCOPES = [
  "identity:read",
  "data:read",
  "data:write",
  "project:read",
  "storage:read",
  // Neben dem lesenden und vor den Queues, weil `orderedScopes` diese
  // Reihenfolge ausgibt und eine Zustimmungsseite die zwei Storage-Saetze
  // nebeneinander zeigen soll.
  "storage:write",
  "queues:read",
  "queues:write",
  "logs:read",
  "migrations:propose",
] as const;
export type ProjectAuthOAuthScope = (typeof PROJECT_AUTH_OAUTH_SCOPES)[number];

export function isProjectAuthOAuthScope(value: unknown): value is ProjectAuthOAuthScope {
  return typeof value === "string" && (PROJECT_AUTH_OAUTH_SCOPES as readonly string[]).includes(value);
}

/**
 * Die Rolle, die ein Token dieses Ablaufs in der Zeilensicherheit bekommt. Immer
 * diese, nie eine andere, und sie ist kein Feld an einem Client: Es gibt keinen
 * Wert, den jemand verstellen koennte.
 */
export const PROJECT_AUTH_OAUTH_ROLE = "authenticated" as const;

/**
 * Die Rolle, die ein Token dieses Ablaufs nie bekommt. Als Wert, damit Console
 * und Test sie nennen koennen, ohne sie in einer Zeichenkette zu wiederholen.
 *
 * `service_role` umgeht in der Data API jede Policy. Ein fremder Client mit
 * dieser Rolle laese jede Zeile jeder Tabelle, ganz gleich, welcher Nutzer
 * zugestimmt hat. Wer eine Anfrage ohne Policies braucht, nimmt einen Service
 * Key dieses Projekts: Den gibt QKERN aus, er ist widerrufbar, und seine Ausgabe
 * steht im Audit.
 */
export const PROJECT_AUTH_OAUTH_FORBIDDEN_ROLE = "service_role";

/** Die Verfahren, die dieser Server nicht kennt, jedes mit einem Namen fuer die Ablehnung. */
export const PROJECT_AUTH_OAUTH_UNSUPPORTED_GRANTS = [
  "implicit", "password", "client_credentials", "refresh_token",
] as const;
export type ProjectAuthOAuthUnsupportedGrant = (typeof PROJECT_AUTH_OAUTH_UNSUPPORTED_GRANTS)[number];

/** Das einzige Verfahren, das es gibt, und die einzige Art der Pruefsumme. */
export const PROJECT_AUTH_OAUTH_GRANT = "authorization_code" as const;
export const PROJECT_AUTH_OAUTH_CHALLENGE_METHOD = "S256" as const;
export const PROJECT_AUTH_OAUTH_RESPONSE_TYPE = "code" as const;

/* ------------------------------------------------------------------ *
 * Die Formen und die Raender
 * ------------------------------------------------------------------ */

/** Der Name eines Clients, gleichzeitig seine Kennung auf der Leitung. */
export const PROJECT_AUTH_OAUTH_CLIENT_NAME = /^[a-z][a-z0-9_-]{1,62}$/;

/**
 * Die Pruefsumme des Prueftexts: base64url, 43 Zeichen. Das ist genau die
 * Laenge eines SHA-256 in dieser Kodierung, und eine andere Laenge ist kein
 * SHA-256.
 */
export const PROJECT_AUTH_OAUTH_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Der Prueftext selbst: 43 bis 128 Zeichen aus dem Zeichensatz, den RFC 7636
 * dafuer festlegt.
 *
 * Die Untergrenze ist die eigentliche Zusage. 43 base64url-Zeichen sind 256 Bit
 * Zufall. Ein kuerzerer Prueftext waere zu raten, und ein geratener Prueftext
 * macht aus PKCE eine Formalie.
 */
export const PROJECT_AUTH_OAUTH_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** Der `state` der Anwendung: ihr eigener Zustand, den QKERN nur zurueckgibt. */
export const PROJECT_AUTH_OAUTH_STATE = /^[A-Za-z0-9._~-]{1,256}$/;

/**
 * Die Raender, jeder einzeln begruendet.
 *
 * `clients`: zehn je Umgebung. Jeder Client ist eine laufende Erlaubnis, im
 * Namen von Nutzern dieses Projekts zu arbeiten, und die Liste soll
 * ueberschaubar bleiben. Dieselbe Zahl fuehrt der OIDC-Katalog seit 2.29 und die
 * Liste der fremden Anbieter seit 2.80.
 *
 * `redirectUris`: eins bis fuenf. Eine Anwendung hat im Betrieb und auf dem
 * Rechner des Entwicklers verschiedene Ziele; wer mehr braucht, hat mehrere
 * Anwendungen und soll sie einzeln hinschreiben.
 *
 * `codeTtlSeconds`: 60. Ein Code ist ein Zugangsschluessel im Browserverlauf,
 * und eine Minute reicht fuer einen Ruecksprung und einen Netzwerkumlauf. Die
 * Obergrenze von fuenf Minuten steht als CHECK in 0062, damit auch ein zweiter
 * Schreibweg sie nicht ueberschreitet.
 *
 * `tokenTtlSeconds`: 3600. Es gibt kein Refresh Token, also ist das die Zeit,
 * die eine Anwendung ohne neue Zustimmung arbeitet. Eine Stunde ist kurz genug,
 * dass ein abgeflossenes Token nicht zum Dauerzugang wird, und lang genug, dass
 * ein Nutzer die Zustimmungsseite nicht wegklickt, ohne sie zu lesen. Die
 * Obergrenze von zwoelf Stunden steht als CHECK in 0062.
 *
 * `tokenLength`: 512 Zeichen. Ein Token wird nachgeschlagen, bevor irgendetwas
 * geprueft ist; die Grenze steht vor dem Nachschlagen. Sie ist grosszuegig
 * gegenueber den 51 Zeichen, die ein echtes Token hat, und trotzdem weit
 * unterhalb dessen, was eine Abfrage belasten wuerde.
 *
 * `redirectUriLength`: 512 Zeichen je Ziel, wie bei den Adressen in 0061.
 *
 * `consents`: 200 Zeilen je Umgebung in der Console (2.92). Das ist kein Rand
 * fuer die Zustimmungen selbst, davon darf es beliebig viele geben, sondern
 * einer fuer die Liste: Eine Ansicht, die eine unbegrenzte Tabelle in einem
 * Stueck holt, ist im Betrieb eine Abfrage ohne Obergrenze. Die Seite sagt, wenn
 * sie abgeschnitten hat; eine Liste, die stillschweigend endet, waere die
 * unehrlichste Form von Vollstaendigkeit.
 */
export const PROJECT_AUTH_OAUTH_BOUNDS = {
  clients: { max: 10 },
  consents: { max: 200 },
  // Der Rand der Tokenliste in der Console (2.93). Dieselbe Bauart wie bei den
  // Zustimmungen: Der Aufrufer fragt eines mehr an und sagt auf der Seite, dass
  // die Liste abgeschnitten ist.
  tokens: { max: 200 },
  redirectUris: { min: 1, max: 5 },
  redirectUriLength: 512,
  codeTtlSeconds: 60,
  tokenTtlSeconds: 3_600,
  tokenLength: 512,
} as const;

/* ------------------------------------------------------------------ *
 * Der Client
 * ------------------------------------------------------------------ */

export type ProjectAuthOAuthClientDefinition = {
  name: string;
  redirectUris: string[];
  scopes: ProjectAuthOAuthScope[];
};

export type ProjectAuthOAuthClient = ProjectAuthOAuthClientDefinition & {
  id: string;
  createdAt: Date;
};

/** Warum eine Client-Definition abgelehnt wurde. Der Schluessel ist stabil. */
export type ProjectAuthOAuthClientRejection =
  | "not_an_object"
  | "name_invalid"
  | "redirect_uris_empty"
  | "too_many_redirect_uris"
  | "redirect_uri_too_long"
  | "redirect_uri_not_a_url"
  | "redirect_uri_insecure_scheme"
  | "redirect_uri_carries_credentials"
  | "redirect_uri_wildcard"
  | "redirect_uri_carries_query"
  | "redirect_uri_carries_fragment"
  | "redirect_uri_duplicate"
  | "scopes_empty"
  | "scope_unknown"
  | "scope_duplicate"
  | "too_many_clients";

export type ProjectAuthOAuthClientParse =
  | { ok: true; client: ProjectAuthOAuthClientDefinition }
  | { ok: false; reason: ProjectAuthOAuthClientRejection; field: string };

/** Ein lokaler Entwicklungshost, und nur diese drei. Dieselbe Liste wie in 2.54. */
function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Prueft ein einzelnes Ruecksprungziel.
 *
 * Streng, und es kostet nichts: Der Wert wird spaeter Zeichen fuer Zeichen mit
 * dem verglichen, den die Anwendung mitschickt, und QKERN springt ihn nie an.
 * Eine Abfrage waere in zwei Schreibweisen zweimal derselbe Ort und trotzdem
 * zwei Werte; ein Fragment waere ein Teil, den der Browser gar nicht schickt.
 * Beides ist darum verboten, und wer Zustand durchschleifen will, nimmt `state`.
 */
export function parseProjectAuthOAuthRedirectUri(value: unknown):
| { ok: true; uri: string }
| { ok: false; reason: ProjectAuthOAuthClientRejection } {
  if (typeof value !== "string") return { ok: false, reason: "redirect_uri_not_a_url" };
  const entry = value.trim();
  if (entry === "") return { ok: false, reason: "redirect_uri_not_a_url" };
  if (entry.length > PROJECT_AUTH_OAUTH_BOUNDS.redirectUriLength) {
    return { ok: false, reason: "redirect_uri_too_long" };
  }
  // Vor dem Parsen: Ein Stern ist nie ein Tippfehler, sondern der Versuch, eine
  // Gruppe von Zielen zu erlauben. Platzhalter gibt es an keiner Stelle dieses
  // Produkts, und es soll nicht so aussehen, als koennte es sie geben.
  if (entry.includes("*")) return { ok: false, reason: "redirect_uri_wildcard" };
  let url: URL;
  try { url = new URL(entry); } catch { return { ok: false, reason: "redirect_uri_not_a_url" }; }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "redirect_uri_carries_credentials" };
  }
  if (url.search !== "") return { ok: false, reason: "redirect_uri_carries_query" };
  if (url.hash !== "") return { ok: false, reason: "redirect_uri_carries_fragment" };
  const localHttp = url.protocol === "http:" && isLocalDevelopmentHost(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    return { ok: false, reason: "redirect_uri_insecure_scheme" };
  }
  // Nicht die Eingabe, sondern die geparste Form: `https://app.test` und
  // `https://app.test/` sind derselbe Ort, und ein Vergleich Zeichen fuer
  // Zeichen wuerde sie auseinanderhalten. Normalisiert wird darum hier, einmal,
  // und danach ist der gespeicherte Wert die Wahrheit.
  return { ok: true, uri: url.toString() };
}

/** Prueft eine ganze Client-Definition. Doppelte Werte sind ein Fehler und kein Filter. */
export function parseProjectAuthOAuthClient(input: unknown): ProjectAuthOAuthClientParse {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "not_an_object", field: "client" };
  }
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!PROJECT_AUTH_OAUTH_CLIENT_NAME.test(name)) {
    return { ok: false, reason: "name_invalid", field: "name" };
  }
  if (!Array.isArray(raw.redirectUris) || raw.redirectUris.length === 0) {
    return { ok: false, reason: "redirect_uris_empty", field: "redirectUris" };
  }
  if (raw.redirectUris.length > PROJECT_AUTH_OAUTH_BOUNDS.redirectUris.max) {
    return { ok: false, reason: "too_many_redirect_uris", field: "redirectUris" };
  }
  const redirectUris: string[] = [];
  for (const candidate of raw.redirectUris) {
    const parsed = parseProjectAuthOAuthRedirectUri(candidate);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, field: "redirectUris" };
    // Ein doppeltes Ziel wird nicht stillschweigend zusammengefasst. Wer es
    // zweimal hinschreibt, hat sich vertan, und ein stiller Filter verdeckte
    // den Tippfehler, der beim zweiten Eintrag steckt.
    if (redirectUris.includes(parsed.uri)) {
      return { ok: false, reason: "redirect_uri_duplicate", field: "redirectUris" };
    }
    redirectUris.push(parsed.uri);
  }
  if (!Array.isArray(raw.scopes) || raw.scopes.length === 0) {
    return { ok: false, reason: "scopes_empty", field: "scopes" };
  }
  const scopes: ProjectAuthOAuthScope[] = [];
  for (const candidate of raw.scopes) {
    if (!isProjectAuthOAuthScope(candidate)) {
      return { ok: false, reason: "scope_unknown", field: "scopes" };
    }
    if (scopes.includes(candidate)) return { ok: false, reason: "scope_duplicate", field: "scopes" };
    scopes.push(candidate);
  }
  return { ok: true, client: { name, redirectUris, scopes: orderedScopes(scopes) } };
}

/**
 * Die Bereiche in der Reihenfolge der Liste, nicht in der der Eingabe.
 *
 * Damit sieht dieselbe Erlaubnis immer gleich aus: in der Console, im Audit und
 * in `request.jwt.claims`. Zwei Schreibweisen derselben Menge waeren zwei Zeilen,
 * die dasselbe sagen, und ein Leser muesste sie vergleichen statt lesen.
 */
export function orderedScopes(scopes: readonly ProjectAuthOAuthScope[]): ProjectAuthOAuthScope[] {
  return PROJECT_AUTH_OAUTH_SCOPES.filter((scope) => scopes.includes(scope));
}

/* ------------------------------------------------------------------ *
 * Die Zustimmung als Zeile (2.92)
 * ------------------------------------------------------------------ */

/**
 * Eine erteilte Zustimmung, wie sie in der Datenbank steht (Migration 0064).
 *
 * Nutzer, Client, Bereiche, Zeitpunkt, und ob sie noch gilt. Der Widerruf ist
 * ein Datum und kein Schalter: Ein Schalter sagte nur, dass widerrufen wurde,
 * dieses Feld sagt, wann.
 */
export type ProjectAuthOAuthConsent = {
  id: string;
  clientId: string;
  userId: string;
  scopes: ProjectAuthOAuthScope[];
  grantedAt: Date;
  revokedAt: Date | null;
};

/** Warum eine Zustimmung nicht erteilt werden konnte. Der Schluessel ist stabil. */
export type ProjectAuthOAuthConsentRejection =
  | "not_an_object"
  | "client_unknown"
  | "scopes_empty"
  | "scope_unknown"
  | "scope_duplicate"
  | "scope_not_granted";

export type ProjectAuthOAuthConsentRequest = {
  clientName: string;
  scopes: ProjectAuthOAuthScope[];
};

export type ProjectAuthOAuthConsentParse =
  | { ok: true; request: ProjectAuthOAuthConsentRequest }
  | { ok: false; reason: ProjectAuthOAuthConsentRejection; field: string };

/**
 * Prueft eine Zustimmung gegen die Form, ohne den Client zu kennen.
 *
 * **Die Bereiche sind Pflicht und haben keine Vorgabe.** Das ist die tragende
 * Entscheidung dieser Funktion. Eine Zustimmung ohne genannte Bereiche muesste
 * QKERN aus dem Client ergaenzen, und dann stuende in der Zeile, was der Client
 * darf, und nicht, was der Nutzer erlaubt hat. Wer zustimmt, nennt die Liste,
 * sonst gibt es keine Zustimmung.
 */
export function parseProjectAuthOAuthConsent(input: unknown): ProjectAuthOAuthConsentParse {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "not_an_object", field: "consent" };
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.clientId !== "string" || !PROJECT_AUTH_OAUTH_CLIENT_NAME.test(raw.clientId.trim())) {
    return { ok: false, reason: "client_unknown", field: "clientId" };
  }
  if (!Array.isArray(raw.scopes) || raw.scopes.length === 0) {
    return { ok: false, reason: "scopes_empty", field: "scopes" };
  }
  const scopes: ProjectAuthOAuthScope[] = [];
  for (const candidate of raw.scopes) {
    if (!isProjectAuthOAuthScope(candidate)) {
      return { ok: false, reason: "scope_unknown", field: "scopes" };
    }
    if (scopes.includes(candidate)) return { ok: false, reason: "scope_duplicate", field: "scopes" };
    scopes.push(candidate);
  }
  return { ok: true, request: { clientName: raw.clientId.trim(), scopes: orderedScopes(scopes) } };
}

/**
 * Deckt diese Zustimmung genau diese Bereiche?
 *
 * **Genau, und nicht "mindestens".** Eine Zustimmung ueber `data:read` und
 * `data:write` deckt einen Anlauf ueber `data:read` hier **nicht**, und das ist
 * Absicht:
 *
 * * Ein Vergleich auf Teilmengen liesse mehrere Zeilen als Treffer zu, und dann
 *   entschiede die Reihenfolge der Zeilen, an welcher der Code haengt. Der
 *   Widerruf wuerde damit ein Glueckspiel: Der Nutzer nimmt eine Zeile zurueck
 *   und weiss nicht, ob das Token an ihr hing.
 * * Die Anwendung nennt die Bereiche ohnehin bei der Zustimmung; dieselbe Liste
 *   beim Anlauf zu schicken kostet sie nichts.
 *
 * Verglichen wird ueber die geordnete Liste, denn beide Seiten sind durch
 * `orderedScopes` gelaufen. Zwei Schreibweisen derselben Menge gibt es darum
 * nicht.
 */
export function projectAuthOAuthConsentCovers(
  consent: Pick<ProjectAuthOAuthConsent, "scopes">,
  scopes: readonly ProjectAuthOAuthScope[],
): boolean {
  const wanted = orderedScopes(scopes);
  const granted = orderedScopes(consent.scopes);
  return wanted.length === granted.length && wanted.every((scope, index) => granted[index] === scope);
}

/**
 * Gilt diese Zustimmung noch?
 *
 * Eine Zeile und eine Frage, und sie steht hier statt in einer Bedingung
 * mitten im Dienst, damit es genau eine Stelle gibt, die sie beantwortet.
 * Keine Zustimmung ist dabei dasselbe wie eine widerrufene: Ein Token, das an
 * keiner haengt, ist eines aus der Zeit vor Migration 0064, und es gilt nicht
 * mehr.
 */
export function projectAuthOAuthConsentHolds(
  consent: Pick<ProjectAuthOAuthConsent, "revokedAt"> | null | undefined,
): boolean {
  return consent !== null && consent !== undefined && consent.revokedAt === null;
}

/* ------------------------------------------------------------------ *
 * Der Anlauf
 * ------------------------------------------------------------------ */

export type ProjectAuthOAuthAuthorizeRequest = {
  clientName: string;
  redirectUri: string;
  scopes: ProjectAuthOAuthScope[];
  codeChallenge: string;
  state: string | null;
};

/** Warum ein Anlauf abgelehnt wurde. */
export type ProjectAuthOAuthAuthorizeRejection =
  | "not_an_object"
  | "response_type_unsupported"
  | "client_unknown"
  | "redirect_uri_unknown"
  | "scope_unknown"
  | "scope_duplicate"
  | "scope_not_granted"
  | "consent_missing"
  | "scopes_empty"
  | "challenge_invalid"
  | "challenge_method_unsupported"
  | "state_invalid";

export type ProjectAuthOAuthAuthorizeParse =
  | { ok: true; request: ProjectAuthOAuthAuthorizeRequest }
  | { ok: false; reason: ProjectAuthOAuthAuthorizeRejection; field: string };

/**
 * Prueft einen Anlauf gegen die Form, ohne den Client zu kennen.
 *
 * Der Client selbst wird eine Ebene weiter nachgeschlagen; hier faellt nur, was
 * schon an der Form falsch ist. Die Trennung hat einen Grund: Diese Pruefung
 * soll ohne Datenbank laufen koennen, und der Test soll sie einzeln fuehren.
 */
export function parseProjectAuthOAuthAuthorize(input: unknown): ProjectAuthOAuthAuthorizeParse {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "not_an_object", field: "request" };
  }
  const raw = input as Record<string, unknown>;
  // `response_type` ist hier nicht Zierde. Ein Aufrufer, der `token` schickt,
  // versucht den impliziten Ablauf, und er soll das als eigene Ablehnung lesen
  // und nicht als "ungueltige Anfrage": Das eine sagt ihm, dass dieser Server
  // es nicht kann, das andere, dass er sich vertippt hat.
  if (raw.responseType !== undefined && raw.responseType !== PROJECT_AUTH_OAUTH_RESPONSE_TYPE) {
    return { ok: false, reason: "response_type_unsupported", field: "responseType" };
  }
  if (typeof raw.clientId !== "string" || !PROJECT_AUTH_OAUTH_CLIENT_NAME.test(raw.clientId.trim())) {
    return { ok: false, reason: "client_unknown", field: "clientId" };
  }
  if (typeof raw.redirectUri !== "string" || raw.redirectUri.trim() === "" ||
      raw.redirectUri.length > PROJECT_AUTH_OAUTH_BOUNDS.redirectUriLength) {
    return { ok: false, reason: "redirect_uri_unknown", field: "redirectUri" };
  }
  if (raw.codeChallengeMethod !== undefined &&
      raw.codeChallengeMethod !== PROJECT_AUTH_OAUTH_CHALLENGE_METHOD) {
    // `plain` heisst in PKCE: Die Pruefsumme **ist** der Prueftext. Dann ist ein
    // abgefangener Anlauf ein abgefangener Prueftext, und PKCE tut nichts mehr.
    return { ok: false, reason: "challenge_method_unsupported", field: "codeChallengeMethod" };
  }
  if (typeof raw.codeChallenge !== "string" || !PROJECT_AUTH_OAUTH_CHALLENGE.test(raw.codeChallenge)) {
    return { ok: false, reason: "challenge_invalid", field: "codeChallenge" };
  }
  if (raw.state !== undefined && raw.state !== null &&
      (typeof raw.state !== "string" || !PROJECT_AUTH_OAUTH_STATE.test(raw.state))) {
    return { ok: false, reason: "state_invalid", field: "state" };
  }
  if (!Array.isArray(raw.scopes) || raw.scopes.length === 0) {
    return { ok: false, reason: "scopes_empty", field: "scopes" };
  }
  const scopes: ProjectAuthOAuthScope[] = [];
  for (const candidate of raw.scopes) {
    if (!isProjectAuthOAuthScope(candidate)) {
      return { ok: false, reason: "scope_unknown", field: "scopes" };
    }
    if (scopes.includes(candidate)) return { ok: false, reason: "scope_duplicate", field: "scopes" };
    scopes.push(candidate);
  }
  return {
    ok: true,
    request: {
      clientName: raw.clientId.trim(),
      redirectUri: raw.redirectUri.trim(),
      scopes: orderedScopes(scopes),
      codeChallenge: raw.codeChallenge,
      state: typeof raw.state === "string" ? raw.state : null,
    },
  };
}

/**
 * Prueft einen geformten Anlauf gegen den gefundenen Client.
 *
 * Zwei Pruefungen, und beide sind Zusagen:
 *
 * * Das Ruecksprungziel muss **eines der hinterlegten** sein, Zeichen fuer
 *   Zeichen. Kein Praefixvergleich: `https://echt.example.com` als Praefix
 *   liesse `https://echt.example.com.angreifer.test` durch.
 * * Die verlangten Bereiche muessen **in den erlaubten** liegen. Weniger als
 *   erlaubt ist in Ordnung und der haeufige Fall; mehr ist eine Ablehnung und
 *   keine stille Kuerzung. Eine stille Kuerzung sah fuer die Anwendung wie ein
 *   Erfolg aus, und sie baute danach auf einem Recht, das sie nicht hat.
 */
export function checkProjectAuthOAuthAuthorize(
  request: ProjectAuthOAuthAuthorizeRequest,
  client: ProjectAuthOAuthClient,
): { ok: true } | { ok: false; reason: ProjectAuthOAuthAuthorizeRejection; field: string } {
  if (!client.redirectUris.includes(request.redirectUri)) {
    return { ok: false, reason: "redirect_uri_unknown", field: "redirectUri" };
  }
  if (!request.scopes.every((scope) => client.scopes.includes(scope))) {
    return { ok: false, reason: "scope_not_granted", field: "scopes" };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Das Einloesen
 * ------------------------------------------------------------------ */

export type ProjectAuthOAuthExchangeRequest = {
  clientName: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
};

/** Warum ein Einloesen abgelehnt wurde. */
export type ProjectAuthOAuthExchangeRejection =
  | "not_an_object"
  | "grant_type_unsupported"
  | "client_unknown"
  | "code_invalid"
  | "redirect_uri_unknown"
  | "verifier_invalid";

export type ProjectAuthOAuthExchangeParse =
  | { ok: true; request: ProjectAuthOAuthExchangeRequest }
  | { ok: false; reason: ProjectAuthOAuthExchangeRejection; field: string };

/** Die Form eines Codes, wie QKERN ihn ausgibt. */
export const PROJECT_AUTH_OAUTH_CODE = /^qk_oauthcode_[A-Za-z0-9_-]{43}$/;

/** Die Form eines Tokens, wie QKERN es ausgibt. */
export const PROJECT_AUTH_OAUTH_TOKEN = /^qk_oauth_[A-Za-z0-9_-]{43}$/;

export function parseProjectAuthOAuthExchange(input: unknown): ProjectAuthOAuthExchangeParse {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "not_an_object", field: "request" };
  }
  const raw = input as Record<string, unknown>;
  // Das einzige Verfahren, und ein anderes faellt mit Namen. Wer
  // `client_credentials` oder `password` versucht, soll lesen, dass dieser
  // Server sie nicht kennt, und nicht raten, ob sein Rumpf falsch war.
  if (raw.grantType !== undefined && raw.grantType !== PROJECT_AUTH_OAUTH_GRANT) {
    return { ok: false, reason: "grant_type_unsupported", field: "grantType" };
  }
  if (typeof raw.clientId !== "string" || !PROJECT_AUTH_OAUTH_CLIENT_NAME.test(raw.clientId.trim())) {
    return { ok: false, reason: "client_unknown", field: "clientId" };
  }
  if (typeof raw.code !== "string" || !PROJECT_AUTH_OAUTH_CODE.test(raw.code)) {
    return { ok: false, reason: "code_invalid", field: "code" };
  }
  if (typeof raw.redirectUri !== "string" || raw.redirectUri.trim() === "" ||
      raw.redirectUri.length > PROJECT_AUTH_OAUTH_BOUNDS.redirectUriLength) {
    return { ok: false, reason: "redirect_uri_unknown", field: "redirectUri" };
  }
  if (typeof raw.codeVerifier !== "string" || !PROJECT_AUTH_OAUTH_VERIFIER.test(raw.codeVerifier)) {
    return { ok: false, reason: "verifier_invalid", field: "codeVerifier" };
  }
  return {
    ok: true,
    request: {
      clientName: raw.clientId.trim(),
      code: raw.code,
      redirectUri: raw.redirectUri.trim(),
      codeVerifier: raw.codeVerifier,
    },
  };
}

/**
 * Die Rechnung, um die es bei PKCE geht: Ist dieser Prueftext der zu dieser
 * Pruefsumme?
 *
 * SHA-256 des Prueftexts, base64url kodiert, mit der gespeicherten Pruefsumme
 * verglichen. Und zwar in fester Zeit: Die Pruefsumme steht in der Datenbank,
 * der Prueftext kommt vom Aufrufer, und ein Vergleich, der beim ersten
 * abweichenden Zeichen aufhoert, verraet ueber die Dauer, wie viele Zeichen
 * gestimmt haben. Bei 43 Zeichen aus 64 ist das kein theoretisches Problem,
 * sondern der Weg, die Pruefsumme Zeichen fuer Zeichen zu erraten.
 *
 * Das Verfahren kommt aus dieser Funktion und nicht aus der Anfrage. Die Anfrage
 * darf sagen, welches Verfahren sie meint (`codeChallengeMethod`), und dieser
 * Wert wird gegen `S256` geprueft; sie darf nicht sagen, wie gerechnet wird. Es
 * ist dieselbe Regel wie bei den fremden Anbietern (2.80), nur andersherum
 * gedreht.
 */
export function projectAuthOAuthVerifierMatches(input: {
  codeVerifier: string;
  codeChallenge: string;
}): boolean {
  if (!PROJECT_AUTH_OAUTH_VERIFIER.test(input.codeVerifier)) return false;
  if (!PROJECT_AUTH_OAUTH_CHALLENGE.test(input.codeChallenge)) return false;
  const computed = createHash("sha256").update(input.codeVerifier, "ascii").digest();
  const stored = Buffer.from(input.codeChallenge, "base64url");
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/** Die Pruefsumme zu einem Prueftext, so wie eine Anwendung sie rechnen muss. */
export function projectAuthOAuthChallengeFor(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

/* ------------------------------------------------------------------ *
 * Was am Ende gilt
 * ------------------------------------------------------------------ */

/**
 * Ein geprueftes Token, in die Auskunft uebersetzt, die die Data API braucht.
 *
 * `role` ist keine Variable, sondern die Zusage: immer `authenticated`. Sie
 * steht hier als Feld, damit der Aufrufer sie nicht selbst hinschreiben muss,
 * und ihr Wert kommt aus `PROJECT_AUTH_OAUTH_ROLE`.
 */
export type ProjectAuthOAuthIdentity = {
  clientId: string;
  clientName: string;
  userId: string;
  email: string;
  scopes: ProjectAuthOAuthScope[];
  role: typeof PROJECT_AUTH_OAUTH_ROLE;
  expiresAt: Date;
};

/**
 * Ein Code, wie er in der Datenbank steht (Migration 0062).
 *
 * Der Code selbst fehlt, und das ist der Punkt: Gespeichert ist nur seine
 * Pruefsumme, und die steht hier nicht, weil kein Aufrufer sie braucht, der
 * diese Zeile schon gefunden hat.
 */
export type ProjectAuthOAuthCode = {
  id: string;
  clientId: string;
  userId: string;
  /**
   * Die Zustimmung, unter der dieser Code ausgegeben wurde (2.92). `null` nur
   * fuer Zeilen aus der Zeit vor Migration 0064; der Dienst loest sie nicht ein.
   */
  consentId: string | null;
  redirectUri: string;
  scopes: ProjectAuthOAuthScope[];
  codeChallenge: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

/** Ein ausgegebenes Token, wie es in der Datenbank steht (Migration 0062). */
export type ProjectAuthOAuthToken = {
  id: string;
  clientId: string;
  userId: string;
  /**
   * Die Zustimmung, an der dieses Token haengt (2.92). Wird sie widerrufen,
   * gilt das Token im selben Augenblick nicht mehr. `null` nur fuer Zeilen aus
   * der Zeit vor Migration 0064, und die gelten ebenfalls nicht mehr.
   */
  consentId: string | null;
  scopes: ProjectAuthOAuthScope[];
  createdAt: Date;
  expiresAt: Date;
};

/** Warum ein vorgelegtes Token abgewiesen wurde. */
export type ProjectAuthOAuthRefusal =
  | "malformed"
  | "unknown"
  | "expired"
  // Die Zustimmung hinter diesem Token gilt nicht mehr, oder es haengt an
  // keiner. Ein eigener Grund und nicht `unknown`, weil er im Audit etwas
  // anderes sagt: `unknown` heisst, dass es diese Zeile nie gab, `revoked`
  // heisst, dass jemand sie zurueckgenommen hat.
  | "revoked";

/**
 * Darf ein Token mit diesen Bereichen diese Anfrage?
 *
 * Getrennt gehalten von allem anderen, weil es die Stelle ist, an der ein
 * Bereich wirklich etwas tut. Ein Bereich, den niemand prueft, ist eine
 * Beschriftung.
 */
export function projectAuthOAuthAllows(
  scopes: readonly ProjectAuthOAuthScope[],
  needed: ProjectAuthOAuthScope,
): boolean {
  return scopes.includes(needed);
}
