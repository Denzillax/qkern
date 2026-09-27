BEGIN;

-- Fremde Anbieter (2.80): hinterlegte Identitaetsdienste, deren Token die Data
-- API direkt annimmt, ohne dass ein Nutzer in project_auth_users entsteht.
--
-- ## Der Unterschied zu OIDC, und warum er eine eigene Tabelle rechtfertigt
--
-- Der OIDC-Weg aus 0024 endet in zwei Zeilen: einem Nutzer in
-- project_auth_users und einer Identitaet in project_auth_oidc_identities.
-- Danach gibt QKERN ein **eigenes** Token aus, mit eigener Unterschrift,
-- eigenem Aussteller, eigener Laufzeit und einem Widerruf, der wirkt, weil die
-- Sitzung QKERN gehoert.
--
-- Hier passiert nichts davon. Die Anwendung schickt das Token, das sie vom
-- fremden Dienst schon hat, und QKERN prueft es. Es entsteht kein Konto, keine
-- Sitzung, kein Refresh Token und keine Zeile, die man widerrufen koennte. Wer
-- das in project_auth_oidc_identities ablegen wollte, muesste dort einen Nutzer
-- erfinden, den es nicht gibt, nur damit der Fremdschluessel haelt: eine Zeile,
-- die behauptet, jemand haette ein Konto. Darum eine eigene Tabelle, und darum
-- traegt sie keine Spalte, die auf einen Nutzer zeigt.
--
-- ## Warum keine UPDATE-Rechte
--
-- Ein Anbieter wird angelegt und entfernt, nicht bearbeitet. Ein UPDATE auf
-- issuer oder jwks_uri wuerde einen Eintrag in eine andere Vertrauensbeziehung
-- verwandeln, ohne dass sein Name, sein Alter oder seine Audit-Zeile sich
-- aendern; wer die Liste danach liest, sieht denselben Anbieter und meint
-- denselben Dienst. Anlegen und Entfernen sind zwei Audit-Zeilen und zwei
-- Entscheidungen. Deshalb gibt es kein UPDATE, deshalb keine updated_at-Spalte
-- und deshalb auch keinen Trigger gegen Scope-Aenderungen: Ohne UPDATE kann
-- der Scope sich nicht aendern.
--
-- ## Wo die Schluessel liegen: nirgends hier
--
-- Der Schluesselsatz des Ausstellers steht nicht in dieser Tabelle. Er wird
-- geholt, wenn er gebraucht wird, und im Prozessspeicher gehalten, bis seine
-- Frist ablaeuft (lib/server/project-auth/third-party-keys.ts). Eine
-- gespeicherte Kopie waere ein zweiter Wahrheitsort: Dreht der Aussteller
-- seinen Schluessel, prueft QKERN gegen einen Satz, den es niemals mehr
-- nachfragen wuerde, und ein zurueckgezogener Schluessel bliebe gueltig.
CREATE TABLE project_auth_third_party_providers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  -- Der Name, unter dem die Console den Anbieter zeigt. Er wandert nie in ein
  -- Token und ist keine Zusage an den Aussteller, sondern eine Beschriftung.
  name text NOT NULL,
  -- Der erwartete Aussteller. Exakt, ohne Schrägstrich am Ende: Ein Vergleich
  -- auf Praefix waere die Tuer fuer `https://echt.example.com.angreifer.test`.
  issuer text NOT NULL,
  -- Die Adresse des Schluesselsatzes. Sie steht getrennt vom Aussteller und
  -- wird nicht aus ihm abgeleitet: Der Well-Known-Pfad ist eine Konvention und
  -- kein Gesetz, und wer ihn errechnet, holt bei einem Dienst, der ihn anders
  -- legt, still eine 404 und weist danach jedes Token ab.
  jwks_uri text NOT NULL,
  -- Das erwartete Publikum. Mindestens einer der Werte muss im Anspruch `aud`
  -- des Tokens stehen. Eine leere Liste ist verboten (siehe CHECK unten): Sie
  -- hiesse "jedes Publikum", und dann reicht ein Token, das derselbe Aussteller
  -- fuer einen ganz anderen Dienst ausgegeben hat.
  audiences text[] NOT NULL,
  -- Aus welchem Anspruch die Identitaet wird. `sub` ist die Vorgabe, weil es
  -- der einzige Anspruch ist, den jeder Aussteller stabil je Subjekt fuehrt.
  subject_claim text NOT NULL DEFAULT 'sub',
  -- Aus welchem Anspruch die Rolle wird. NULL heisst "aus keinem": Dann gilt
  -- default_role fuer jedes Token dieses Anbieters.
  role_claim text,
  -- ### Die Entscheidung dieses Slices, in SQL
  --
  -- Die Rolle, die ein Token dieses Anbieters bekommt, wenn role_claim NULL
  -- ist oder der Anspruch fehlt. Erlaubt sind genau `anon` und
  -- `authenticated`. **`service_role` ist es nicht**, und das steht hier und
  -- nicht nur im Dienst, weil es die Zusage ist, um die es geht:
  --
  -- `service_role` umgeht in der Data API jede Policy. Wer diese Rolle einem
  -- Token gibt, dessen Aussteller QKERN nicht kontrolliert, hat die
  -- Zeilensicherheit an eine fremde Registrierungsseite delegiert: Jeder, der
  -- beim Anbieter ein Konto anlegen kann, laese danach jede Zeile jeder
  -- Tabelle. Das ist keine Einstellung mit Warnhinweis, das ist eine Tuer, und
  -- sie wird nicht gebaut. Wer eine Anfrage ohne Policies braucht, nimmt einen
  -- Service Key dieses Projekts; den gibt QKERN aus, und er ist widerrufbar.
  default_role text NOT NULL DEFAULT 'authenticated',
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Ein Name je Umgebung, und ein Aussteller je Umgebung. Der zweite ist der
  -- wichtigere: Zwei Eintraege mit demselben Aussteller und verschiedener
  -- Rollenabbildung waeren zwei Antworten auf dieselbe Frage, und welche gilt,
  -- entschiede die Reihenfolge der Zeilen.
  UNIQUE (organization_id, project_id, environment, name),
  UNIQUE (organization_id, project_id, environment, issuer),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE
);

-- Der Name: klein, mit Bindestrich, wie jeder Bezeichner, den die Console in
-- eine Adresse schreibt.
ALTER TABLE project_auth_third_party_providers
  ADD CONSTRAINT project_auth_third_party_providers_name_check CHECK (
    name ~ '^[a-z][a-z0-9_-]{1,62}$'
  );

-- Der Aussteller und die Adresse des Schluesselsatzes. Beide muessen https
-- sein, beide ohne Anmeldedaten im Bezeichner, beide ohne Fragment, und der
-- Aussteller ohne Schrägstrich am Ende, damit der Vergleich mit dem Anspruch
-- `iss` ein Zeichenkettenvergleich bleibt und keine Normalisierung braucht.
--
-- Die Datenbank prueft hier absichtlich grob. Ob der Name des Gegenuebers
-- oeffentlich aufloest, kann sie nicht wissen; das entscheidet die
-- Adresspolicy beim Holen (lib/server/net/guarded-fetch.ts). Was sie kann,
-- prueft sie: Ein `http://`-Aussteller oder ein `jwks_uri` mit Passwort kommt
-- nicht in diese Tabelle, auch nicht durch einen zweiten Schreibweg.
ALTER TABLE project_auth_third_party_providers
  ADD CONSTRAINT project_auth_third_party_providers_url_check CHECK (
    issuer ~ '^https://[A-Za-z0-9._~%-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&()*+,;=:@/-]*[A-Za-z0-9._~%!$&()*+,;=:@-])?$' AND
    length(issuer) BETWEEN 12 AND 512 AND
    jwks_uri ~ '^https://[A-Za-z0-9._~%-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&()*+,;=:@/-]*)?(\?[A-Za-z0-9._~%!$&()*+,;=:@/?-]*)?$' AND
    length(jwks_uri) BETWEEN 12 AND 512
  );

-- Das Publikum: 1 bis 5 Werte, jeder ein brauchbarer Bezeichner. Geprueft ueber
-- array_to_string, weil ein CHECK keine Unterabfrage haben darf; das
-- Trennzeichen kommt im Muster nicht vor, der Umweg aendert also nichts.
--
-- Nach oben begrenzt, weil jeder zusaetzliche Wert die Menge der Token
-- vergroessert, die dieser Eintrag annimmt. Fuenf deckt eine Anwendung mit
-- mehreren Ausgaben ab; wer mehr braucht, hat mehrere Anbieter und soll sie
-- einzeln hinschreiben.
ALTER TABLE project_auth_third_party_providers
  ADD CONSTRAINT project_auth_third_party_providers_audience_check CHECK (
    array_length(audiences, 1) BETWEEN 1 AND 5 AND
    array_to_string(audiences, ',') ~ '^[^,[:space:]]{1,255}(,[^,[:space:]]{1,255})*$'
  );

-- Die beiden Anspruchsnamen. Hier sind Punkt und Doppelpunkt erlaubt, anders
-- als bei den Ansprueche eines Auth-Hooks aus 0058: Ein fremder Aussteller
-- nennt seine eigenen Ansprueche oft mit Namensraum
-- (`https://example.test/rolle`), und QKERN hat kein Recht, ihm einen Namen zu
-- verbieten, den es nur zu lesen hat. Verboten bleibt ein leerer Name.
ALTER TABLE project_auth_third_party_providers
  ADD CONSTRAINT project_auth_third_party_providers_claim_check CHECK (
    subject_claim ~ '^[A-Za-z][A-Za-z0-9_.:/-]{0,126}$' AND
    (role_claim IS NULL OR role_claim ~ '^[A-Za-z][A-Za-z0-9_.:/-]{0,126}$')
  );

-- Und die Obergrenze selbst. Zweimal geschrieben und einmal gemeint: Dieselbe
-- Liste steht in lib/server/project-auth/third-party.ts, weil die Datenbank
-- nicht darauf vertrauen soll, dass jeder Schreiber durch den Dienst kommt,
-- und der Dienst nicht darauf, dass jede Zeile durch diesen CHECK gekommen ist.
ALTER TABLE project_auth_third_party_providers
  ADD CONSTRAINT project_auth_third_party_providers_role_check CHECK (
    default_role IN ('anon', 'authenticated')
  );

-- Die Suche, die im heissen Weg laeuft: Bei jeder Anfrage mit fremdem Token
-- wird ein Aussteller in einer Umgebung gesucht. Der UNIQUE-Index auf
-- (organization_id, project_id, environment, issuer) deckt das schon ab; ein
-- zweiter Index waere nur Pflegeaufwand.

REVOKE ALL ON project_auth_third_party_providers FROM PUBLIC;

-- SELECT, INSERT und DELETE fuer die Auth-Rolle, und kein UPDATE. Warum kein
-- UPDATE, steht oben. DELETE gibt es hier, anders als bei den uebrigen
-- project_auth_*-Tabellen, und der Unterschied ist Absicht: Ein Nutzer, eine
-- Sitzung und eine Audit-Zeile sind Geschichte, die stehen bleibt. Ein
-- hinterlegter Anbieter ist eine laufende Erlaubnis, und eine Erlaubnis muss
-- zurueckgenommen werden koennen, ohne dass jemand in der Datenbank
-- nachhilft. Ein Widerrufsvermerk statt eines DELETE waere hier schlechter:
-- Der heisse Weg muesste ihn bei jeder Anfrage mitlesen, und eine vergessene
-- Bedingung liesse einen zurueckgenommenen Anbieter weiterlaufen.
GRANT SELECT, INSERT, DELETE ON project_auth_third_party_providers TO qkern_auth;

COMMIT;
