BEGIN;

-- QKERN als OAuth-Anbieter (2.82): genau ein Ablauf, Authorization Code mit
-- PKCE, und nichts daneben.
--
-- ## Was hier gebaut wird, und was nicht
--
-- Gebaut ist der Ablauf, den eine fremde Anwendung braucht, um im Namen eines
-- Nutzers dieses Projekts zu lesen und zu schreiben: Die Anwendung ist als
-- Client hinterlegt, der Nutzer ist bei QKERN angemeldet und stimmt zu, QKERN
-- gibt einen kurzlebigen Code heraus, die Anwendung loest ihn mit ihrem
-- Prueftext gegen ein Token ein.
--
-- Nicht gebaut, und jede Auslassung hat ihren Grund in der Tabelle, in der sie
-- fehlt:
--
-- * **Kein impliziter Ablauf.** Er gibt das Token selbst an das Ruecksprungziel
--   zurueck, also durch den Browser und in dessen Verlauf. Dafuer gibt es hier
--   keine Spalte, weil es diesen Weg nicht gibt.
-- * **Kein Passwort-Ablauf.** Er verlangt, dass die fremde Anwendung das
--   Passwort des Nutzers sieht. Genau das soll ein OAuth-Ablauf verhindern; wer
--   ihn anbietet, hat den Zweck weggelassen und die Flaeche behalten.
-- * **Kein Client-Credentials-Ablauf.** Er ist ein Token ohne Nutzer, also ein
--   Schluessel fuer eine Maschine. Den gibt QKERN schon aus, er heisst Service
--   Key, er ist widerrufbar, und seine Ausgabe steht im Audit. Ein zweiter Weg
--   zum selben Ziel waere eine zweite Stelle, an der Rechte entstehen.
-- * **Kein Refresh Token.** Es gibt hier keine Spalte dafuer und keine Tabelle.
--   Ein Refresh Token ist ein Dauerzugang, und ein Dauerzugang fuer eine fremde
--   Anwendung ist eine eigene Entscheidung mit eigener Widerrufsflaeche. Laeuft
--   ein Token ab, geht die Anwendung denselben Weg noch einmal, und der Nutzer
--   sieht dabei wieder, wem er was erlaubt.
--
-- ## Warum der Client kein Geheimnis hat
--
-- Es gibt keine Spalte `secret_hash`, und das ist die Zusage dieses Schnitts.
-- Ein Client ist eine Anwendung, die der Nutzer installiert oder im Browser
-- laedt. Ein Geheimnis darin ist kein Geheimnis: Es liegt im Programmpaket oder
-- im JavaScript und ist mit einem Editor zu lesen. PKCE ist genau dafuer da.
-- Der Prueftext entsteht bei jedem Anlauf neu, er verlaesst die Anwendung nie,
-- und nur seine Pruefsumme geht durch den Browser. Ein gestohlener Code ohne
-- Prueftext ist wertlos.
--
-- Eine Spalte fuer ein Geheimnis, die man "fuer vertrauliche Clients spaeter"
-- anlegt, waere eine Spalte, die heute leer ist und morgen behauptet, dieser
-- Client sei geprueft. Sie kommt, wenn der vertrauliche Client kommt.

-- ## Der Client
CREATE TABLE project_auth_oauth_clients (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  -- Der Name, unter dem die Console den Client zeigt und unter dem der Nutzer
  -- ihn auf der Zustimmungsseite liest. Er ist gleichzeitig die oeffentliche
  -- Kennung (`client_id` auf der Leitung), und darum ist er streng geformt:
  -- klein, mit Bindestrich, wie jeder Bezeichner, den QKERN in eine Adresse
  -- schreibt.
  name text NOT NULL,
  -- Die erlaubten Ruecksprungziele dieses Clients. Eine Liste und kein
  -- einzelner Wert, weil eine Anwendung im Betrieb und auf dem Rechner des
  -- Entwicklers verschiedene Ziele hat.
  --
  -- Verglichen wird spaeter Zeichen fuer Zeichen mit dem Wert, den die Anwendung
  -- mitschickt. Das darf so streng sein, weil QKERN selbst nie einen 302 an
  -- dieses Ziel schickt (siehe unten): Der Wert ist eine Bindung des Codes und
  -- kein Ort, an den QKERN jemanden schickt.
  redirect_uris text[] NOT NULL,
  -- Die Bereiche, die dieser Client hoechstens verlangen darf. Was er wirklich
  -- bekommt, steht am Code und am Token, nicht hier: Ein Nutzer kann weniger
  -- zustimmen, als der Client darf, und dann gilt das Weniger.
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Ein Name je Umgebung. Der Name ist die Kennung auf der Leitung; zwei
  -- Eintraege mit demselben Namen waeren zwei Antworten auf die Frage, welche
  -- Ruecksprungziele erlaubt sind, und welche gilt, entschiede die Reihenfolge
  -- der Zeilen.
  UNIQUE (organization_id, project_id, environment, name),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE
);

ALTER TABLE project_auth_oauth_clients
  ADD CONSTRAINT project_auth_oauth_clients_name_check CHECK (
    name ~ '^[a-z][a-z0-9_-]{1,62}$'
  );

-- Die Ruecksprungziele: 1 bis 5, jedes eine vollstaendige Adresse. Geprueft
-- ueber array_to_string, weil ein CHECK keine Unterabfrage haben darf; das
-- Trennzeichen (Leerzeichen) kommt im Muster nicht vor, der Umweg aendert also
-- nichts.
--
-- Erlaubt ist https, und http nur auf einem lokalen Entwicklungshost. Dieselbe
-- Grenze zieht `return-targets.ts` seit 2.54 fuer die Ziele der Anmeldung, und
-- sie soll hier nicht anders aussehen.
--
-- Verboten sind Abfrage und Fragment, und das ist hier keine Bequemlichkeit: Der
-- Wert wird Zeichen fuer Zeichen verglichen, und zwei Schreibweisen derselben
-- Abfrage (`?a=1&b=2` und `?b=2&a=1`) waeren zwei Werte. Wer Zustand
-- durchschleifen will, nimmt `state`; dafuer ist es da.
--
-- Verboten ist ausserdem der Stern. Ein Platzhalter im Ruecksprungziel ist die
-- Tuer, durch die ein Code an eine fremde Unteradresse geht, und Platzhalter
-- gibt es an keiner Stelle dieses Produkts.
ALTER TABLE project_auth_oauth_clients
  ADD CONSTRAINT project_auth_oauth_clients_redirect_check CHECK (
    array_length(redirect_uris, 1) BETWEEN 1 AND 5 AND
    array_to_string(redirect_uris, ' ') ~ (
      '^(' ||
        '(https://[A-Za-z0-9._~%-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&()+,;=:/-]*)?' ||
        '|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&()+,;=:/-]*)?)' ||
      ')( (' ||
        '(https://[A-Za-z0-9._~%-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&()+,;=:/-]*)?' ||
        '|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&()+,;=:/-]*)?)' ||
      '))*$'
    ) AND
    array_to_string(redirect_uris, ' ') !~ '[*?#]' AND
    length(array_to_string(redirect_uris, ' ')) <= 1024
  );

-- ### Die Bereiche, und was es an Bereichen gibt
--
-- Drei, und die Liste ist geschlossen. Sie steht hier als CHECK und noch einmal
-- in lib/server/project-auth/oauth.ts, weil die Datenbank nicht darauf
-- vertrauen soll, dass jeder Schreiber durch den Dienst kommt, und der Dienst
-- nicht darauf, dass jede Zeile durch diesen CHECK gekommen ist.
--
-- * `identity:read`: Wer hat zugestimmt. Der Client liest Kennung und
--   E-Mail-Adresse dieses Nutzers, und sonst nichts.
-- * `data:read`: Lesen durch die Data API, unter der Zeilensicherheit, als
--   dieser Nutzer.
-- * `data:write`: Schreiben durch die Data API, unter derselben Zeilensicherheit.
--
-- Warum nicht ein Bereich je Tabelle: Weil die Zeilensicherheit die Frage schon
-- beantwortet, und zwar besser. Eine Policy entscheidet je Zeile, ein Bereich
-- je Tabelle koennte nur die Tabelle sperren. Zwei Systeme fuer dieselbe Frage
-- haetten zwei Antworten, und die Console muesste erklaeren, welche gilt.
--
-- Warum `data:read` und `data:write` getrennt: Weil der Unterschied der ist,
-- den ein Nutzer wirklich versteht und wirklich will. Eine Anwendung, die nur
-- anzeigt, soll nicht loeschen koennen.
ALTER TABLE project_auth_oauth_clients
  ADD CONSTRAINT project_auth_oauth_clients_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 3 AND
    array_to_string(scopes, ' ') ~
      '^(identity:read|data:read|data:write)( (identity:read|data:read|data:write))*$'
  );

REVOKE ALL ON project_auth_oauth_clients FROM PUBLIC;

-- SELECT, INSERT und DELETE, und kein UPDATE. Aus demselben Grund wie bei den
-- fremden Anbietern in 0061: Ein Client wird angelegt und entfernt, nicht
-- bearbeitet. Ein UPDATE auf `redirect_uris` oder `scopes` wuerde die Zusage
-- aendern, unter der ein Nutzer zugestimmt hat, ohne dass Name, Alter oder
-- Audit-Zeile sich aenderten; wer die Liste danach liest, sieht denselben Client
-- und meint dieselbe Erlaubnis.
--
-- DELETE gibt es, und es ist der Widerruf: Ueber ON DELETE CASCADE fallen mit
-- dem Client auch seine Codes und seine ausgegebenen Token. Das ist der einzige
-- Widerruf dieser Flaeche, und er ist grob; feiner gibt es nicht, und die Seite
-- sagt das.
GRANT SELECT, INSERT, DELETE ON project_auth_oauth_clients TO qkern_auth;

-- ## Der Code
--
-- Kurzlebig, einmalig, und an vier Dinge gebunden: den Client, das
-- Ruecksprungziel, die Pruefsumme des Prueftexts und den Nutzer, der
-- zugestimmt hat. Jede dieser vier Bindungen schliesst einen Angriff:
--
-- * **Client**: Ein Code, der fuer eine andere Anwendung ausgegeben wurde, ist
--   fuer diese nichts wert.
-- * **Ruecksprungziel**: Ein Code, den ein Angreifer an ein anderes Ziel
--   einloesen will, faellt, obwohl der Client derselbe ist.
-- * **Pruefsumme**: Ein abgefangener Code ohne den Prueftext ist wertlos. Das
--   ist PKCE, und es ist der Grund, warum der Client kein Geheimnis braucht.
-- * **Nutzer**: Der Code traegt, wer zugestimmt hat. Er steht nicht im Token
--   und wird nicht aus einer Sitzung geraten.
CREATE TABLE project_auth_oauth_codes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  client_id uuid NOT NULL REFERENCES project_auth_oauth_clients (id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES project_auth_users (id) ON DELETE CASCADE,
  -- Das Ziel, an das die Anwendung den Code erwartet. Gespeichert und nicht
  -- bloss geprueft: Beim Einloesen muss derselbe Wert wieder kommen, und ein
  -- Vergleich braucht beide Seiten.
  redirect_uri text NOT NULL,
  -- Die Bereiche, denen der Nutzer zugestimmt hat. Hoechstens die des Clients,
  -- moeglicherweise weniger.
  scopes text[] NOT NULL,
  -- Der Code selbst steht hier nicht. Nur seine Pruefsumme (SHA-256,
  -- base64url), wie bei jedem Einmal-Token seit 0024. Wer diese Tabelle liest,
  -- kann damit keinen Code einloesen.
  code_hash text NOT NULL,
  -- Die Pruefsumme des Prueftexts, wie die Anwendung sie geschickt hat:
  -- base64url, 43 Zeichen, also genau die Laenge eines SHA-256 in dieser
  -- Kodierung. Der Prueftext selbst kommt nie hierher; er verlaesst die
  -- Anwendung erst beim Einloesen.
  code_challenge text NOT NULL,
  -- Ein Spaltenwert mit genau einer erlaubten Ausfuellung, und das mit Absicht.
  -- `plain` heisst in PKCE: Die Pruefsumme **ist** der Prueftext. Dann ist ein
  -- abgefangener Anlauf ein abgefangener Prueftext, und PKCE tut nichts mehr.
  -- Die Spalte steht hier, damit die Abweisung von `plain` eine Eigenschaft der
  -- Zeile ist und nicht nur eine Regel im Dienst.
  code_challenge_method text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- Der Verbrauch. Gesetzt beim ersten Einloesen, und zwar in derselben
  -- Anweisung, die die Zeile findet: Ein zweites Einloesen ist ein
  -- Wiedereinspielangriff und muss fallen, auch wenn beide Anfragen gleichzeitig
  -- kommen. Warum ein Vermerk und kein DELETE: Eine geloeschte Zeile sieht wie
  -- ein erfundener Code aus, und dann kann der Betreiber im Audit nicht
  -- unterscheiden, ob jemand einen Code zweimal eingeloest oder einen erfunden
  -- hat. Das ist genau der Unterschied, der ihn interessiert.
  consumed_at timestamptz,
  -- Ein Code je Pruefsumme, global. Nicht je Umgebung: Der Code ist ein
  -- Zufallswert mit 256 Bit, und zwei gleiche waeren kein Zufall, sondern ein
  -- Fehler im Zufall. Eine Bedingung, die das je Umgebung erlaubt, wuerde
  -- diesen Fehler verstecken.
  UNIQUE (code_hash),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE
);

ALTER TABLE project_auth_oauth_codes
  ADD CONSTRAINT project_auth_oauth_codes_pkce_check CHECK (
    code_challenge ~ '^[A-Za-z0-9_-]{43}$' AND
    code_challenge_method = 'S256'
  );

-- Die Laufzeit. Nach unten und nach oben begrenzt, und die Obergrenze ist die
-- wichtigere: Ein Code, der eine Stunde gilt, ist eine Stunde lang ein
-- Zugangsschluessel im Browserverlauf. Eine Minute reicht fuer einen
-- Ruecksprung und einen Netzwerkumlauf.
ALTER TABLE project_auth_oauth_codes
  ADD CONSTRAINT project_auth_oauth_codes_lifetime_check CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '5 minutes'
  );

ALTER TABLE project_auth_oauth_codes
  ADD CONSTRAINT project_auth_oauth_codes_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 3 AND
    array_to_string(scopes, ' ') ~
      '^(identity:read|data:read|data:write)( (identity:read|data:read|data:write))*$'
  );

-- Scope-Spalten bleiben unveraenderlich, wie bei jeder project_auth_*-Tabelle.
-- Der Trigger aus 0024 prueft genau das und haelt zusaetzlich die id fest.
CREATE TRIGGER project_auth_oauth_codes_scope_immutable
BEFORE UPDATE ON project_auth_oauth_codes
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_scope_mutation();

REVOKE ALL ON project_auth_oauth_codes FROM PUBLIC;

-- SELECT und INSERT, und UPDATE auf genau einer Spalte: dem Verbrauchsvermerk.
-- Alles andere an einem Code ist nach dem Anlegen fest. Ein Code, dessen
-- Pruefsumme oder Ruecksprungziel sich aendern liesse, ist keine Bindung,
-- sondern eine Notiz.
GRANT SELECT, INSERT ON project_auth_oauth_codes TO qkern_auth;
GRANT UPDATE (consumed_at) ON project_auth_oauth_codes TO qkern_auth;

-- ## Das Token
--
-- ### Die Entscheidung: undurchsichtig, nicht signiert
--
-- Ein Sitzungstoken der Projekt-Anmeldung ist ein signiertes JWT. Dieses hier
-- ist es nicht. Es ist ein Zufallswert, und gueltig ist es, weil diese Zeile
-- existiert.
--
-- Der Grund ist der Widerruf. Ein signiertes Token gilt bis `exp`, und wer es
-- vorher stoppen will, braucht eine Liste der gestoppten, also genau diese
-- Tabelle, nur umgekehrt. Ein Token fuer eine **fremde** Anwendung muss
-- stoppbar sein: Der Nutzer hat einer Anwendung zugestimmt, nicht einer Frist.
-- Wird der Client entfernt, faellt diese Zeile mit ihm (ON DELETE CASCADE), und
-- das Token ist im selben Augenblick nichts mehr.
--
-- Der Preis steht dazu: Jede Anfrage mit einem solchen Token kostet eine
-- Datenbankabfrage. Ein signiertes Token kostet keine. Das ist der Handel, und
-- er geht hier zugunsten des Widerrufs aus.
--
-- ### Was das Token umfasst
--
-- Die Rolle in der Zeilensicherheit ist `authenticated`, und zwar immer. Nicht
-- `anon`, weil hinter dem Token ein Nutzer steht, der zugestimmt hat; und
-- **nie** `service_role`.
--
-- `service_role` umgeht in der Data API jede Policy. Ein fremder Client mit
-- dieser Rolle laese jede Zeile jeder Tabelle, ganz gleich, welcher Nutzer
-- zugestimmt hat. Wer sie hier vergibt, hat die Zeilensicherheit des Projekts
-- an eine fremde Anwendung delegiert. Das ist keine Einstellung mit
-- Warnhinweis, das ist eine Tuer, und sie wird nicht gebaut: Es gibt keine
-- Spalte fuer eine Rolle, darum gibt es keinen Wert, den man auf `service_role`
-- setzen koennte. Wer eine Anfrage ohne Policies braucht, nimmt einen Service
-- Key dieses Projekts.
--
-- Der Nutzer im Token ist der, der zugestimmt hat, und `sub` in der
-- Zeilensicherheit ist seine Kennung. Eine Policy sieht damit dasselbe wie bei
-- einer Anfrage aus der eigenen Anwendung des Projekts, und zusaetzlich, dass
-- ein fremder Client ruft: Der Name des Clients und die Bereiche stehen in
-- `request.jwt.claims`. Eine Policy, die einem fremden Client weniger erlauben
-- will als der eigenen Anwendung, kann das darum schreiben.
CREATE TABLE project_auth_oauth_tokens (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  client_id uuid NOT NULL REFERENCES project_auth_oauth_clients (id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES project_auth_users (id) ON DELETE CASCADE,
  -- Der Code, aus dem dieses Token entstand, und zwar eindeutig. Das ist die
  -- zweite Tuer gegen das zweite Einloesen, neben dem Verbrauchsvermerk am
  -- Code: Selbst wenn jemand den Vermerk umschreibt oder einen zweiten
  -- Einloeseweg baut, der ihn nicht setzt, kann aus einem Code kein zweites
  -- Token entstehen. Eine Bedingung, die im Betrieb nie greift, ist hier
  -- richtig: Sie greift genau dann, wenn woanders etwas kaputt ist.
  code_id uuid NOT NULL UNIQUE REFERENCES project_auth_oauth_codes (id) ON DELETE CASCADE,
  -- Wie beim Code: nur die Pruefsumme. Ein Leser dieser Tabelle kann mit ihr
  -- keine Anfrage stellen.
  token_hash text NOT NULL,
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (token_hash),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE
);

-- Die Laufzeit eines Tokens: hoechstens zwoelf Stunden. Es gibt kein Refresh
-- Token, also ist das die Zeit, die eine Anwendung ohne neue Zustimmung
-- arbeitet. Laenger waere ein Dauerzugang ohne den Namen; kuerzer waere eine
-- Zustimmungsseite alle paar Minuten, und die klickt irgendwann jeder weg, ohne
-- sie zu lesen.
ALTER TABLE project_auth_oauth_tokens
  ADD CONSTRAINT project_auth_oauth_tokens_lifetime_check CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '12 hours'
  );

ALTER TABLE project_auth_oauth_tokens
  ADD CONSTRAINT project_auth_oauth_tokens_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 3 AND
    array_to_string(scopes, ' ') ~
      '^(identity:read|data:read|data:write)( (identity:read|data:read|data:write))*$'
  );

REVOKE ALL ON project_auth_oauth_tokens FROM PUBLIC;

-- SELECT und INSERT, und kein UPDATE. Ein ausgegebenes Token aendert sich nicht:
-- Es gilt, bis es ablaeuft, oder es faellt mit seinem Client. Ein DELETE gibt es
-- auch nicht, und das ist keine Luecke, sondern die Kehrseite derselben
-- Entscheidung: Der Widerruf geht ueber den Client, weil der Nutzer einer
-- Anwendung zugestimmt hat und nicht einem Token, das er nie gesehen hat.
--
-- Was hier fehlt und fehlen darf: ein Aufraeumer fuer abgelaufene Zeilen. Eine
-- abgelaufene Zeile gilt nicht mehr, denn die Pruefung sieht auf die Uhr. Sie
-- bleibt aber stehen, und die Tabelle waechst. Das steht auf der Seite unter
-- "Was diese Flaeche nicht haelt", weil es ehrlicher ist als ein Auftrag, der
-- nicht laeuft.
GRANT SELECT, INSERT ON project_auth_oauth_tokens TO qkern_auth;

-- Die Suchen im heissen Weg deckt je ein UNIQUE-Index ab: `code_hash` beim
-- Einloesen, `token_hash` bei jeder Anfrage mit einem solchen Token. Ein
-- zusaetzlicher Index waere nur Pflegeaufwand.

COMMIT;
