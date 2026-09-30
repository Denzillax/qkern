BEGIN;

-- Anmeldung mit SAML 2.0 fuer Project Auth (2.99).
--
-- Diese Migration legt genau eine Tabelle an, und sie haelt genau eine Sache:
-- die `ID` einer Assertion, die hier schon einmal eine Sitzung erzeugt hat.
--
-- Warum das eine eigene Tabelle ist und keine Zeile in
-- project_auth_one_time_tokens: Ein Einmal-Token ist etwas, das QKERN selbst
-- ausgegeben hat und das QKERN verbraucht. Eine Assertion-`ID` ist das
-- Gegenteil — sie kommt von aussen, QKERN hat sie nie vergeben, und sie wird
-- nicht verbraucht, sondern **gemerkt**. Beides in eine Tabelle zu zwingen
-- hiesse, den Hash eines eigenen Geheimnisses und eine fremde Kennung in
-- derselben Spalte zu fuehren.
--
-- Was hier **nicht** liegt, ist der wichtigste Teil: kein XML, keine Adresse,
-- kein Subject, keine Signatur, kein Zertifikat. Wer diese Tabelle liest,
-- erfaehrt, wie oft sich in einer Umgebung jemand ueber welchen Anbieter
-- angemeldet hat, und sonst nichts. Das hinterlegte Zertifikat des Anbieters
-- steht in der Konfiguration des Auth-Dienstes, nicht in der Datenbank —
-- dieselbe Grenze wie beim OIDC-Katalog.
CREATE TABLE project_auth_saml_assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  -- Der Slug des Anbieters aus dem Katalog, dieselbe Form wie bei OIDC.
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,62}$'),
  -- Die `ID` der Assertion, wie der Anbieter sie geschrieben hat. Ein
  -- `xsd:ID` faengt mit einem Buchstaben oder einem Unterstrich an und enthaelt
  -- keine Leerzeichen; genau das prueft die Bedingung, und zwar in der
  -- Datenbank und nicht nur im Dienst. Die Grenzen stehen als char_length,
  -- weil PostgreSQL in einem regulaeren Ausdruck hoechstens 255
  -- Wiederholungen zulaesst — derselbe Befund wie bei 0060.
  assertion_id text NOT NULL CHECK (
    char_length(assertion_id) BETWEEN 1 AND 256
    AND assertion_id ~ '^[A-Za-z_][A-Za-z0-9_.:-]*$'
  ),
  used_at timestamptz NOT NULL DEFAULT now(),
  -- Das `NotOnOrAfter` der Assertion. Danach braucht der Riegel die Zeile
  -- nicht mehr: Eine abgelaufene Assertion scheitert schon am Zeitfenster.
  -- Der Aufraeumer aus 0063 nimmt diese Tabelle noch nicht; bis dahin
  -- waechst sie, und das steht so im Handbuch statt als stiller Rueckstand.
  expires_at timestamptz NOT NULL,
  CONSTRAINT project_auth_saml_assertions_window CHECK (expires_at > used_at),
  -- Der Riegel selbst. Er liegt hier und nicht im Dienst: Zwei Einreichungen
  -- derselben Assertion, die gleichzeitig ankommen, bekommen so genau einmal
  -- eine Zeile. Ein vorher gelesener Zustand haette beiden erlaubt
  -- weiterzumachen.
  --
  -- Der Anbieter steht mit im Schluessel, weil eine `ID` eine Zusage des
  -- Anbieters ist und nicht global eindeutig: Zwei Anbieter duerfen dieselbe
  -- `ID` vergeben, und keiner von beiden soll den anderen aussperren koennen.
  CONSTRAINT project_auth_saml_assertion_key
    UNIQUE (organization_id, project_id, environment, provider, assertion_id)
);

-- Der Weg des Aufraeumens, wenn es ihn gibt, und der Weg einer Uebersicht je
-- Umgebung. Das Nachschlagen einer `ID` trifft die eindeutige Bedingung oben.
CREATE INDEX project_auth_saml_assertions_expiry_idx
  ON project_auth_saml_assertions (organization_id, project_id, environment, expires_at);

-- Die offene AuthnRequest liegt in derselben Tabelle wie die uebrigen
-- kurzlebigen Token, mit einem eigenen Zweck. Sie traegt keinen Nutzer
-- (auth_user_id bleibt NULL): Wer eine Anmeldung anstoesst, hat noch keine
-- Identitaet, und der Server soll aus der Anfrage auch nicht schliessen
-- koennen, welche Adresse es gibt.
--
-- Verbraucht wird sie **nicht**. Das ist der Unterschied zum OIDC-Zustand
-- daneben, und er ist eine Entscheidung: Wuerde die Anfrage beim ersten
-- Einreichen verbraucht, wiese die zweite Einreichung derselben Assertion mit
-- dem Grund "Zustand unbekannt" ab, und der Riegel gegen Wiedereinreichung
-- waere nie das, was entscheidet. Ein Riegel, den nie etwas erreicht, ist kein
-- Riegel. Gegen Wiedereinreichung schuetzt project_auth_saml_assertions, und
-- die Anfrage laeuft nach zehn Minuten von selbst ab.
ALTER TABLE project_auth_one_time_tokens
  DROP CONSTRAINT project_auth_one_time_tokens_purpose_check;
ALTER TABLE project_auth_one_time_tokens
  ADD CONSTRAINT project_auth_one_time_tokens_purpose_check CHECK (purpose IN (
    'email_verification', 'magic_link', 'password_reset', 'oidc_state',
    'mfa_challenge', 'mfa_enrollment',
    'passkey_registration', 'passkey_authentication',
    'saml_request'
  ));

-- Eine SAML-Identitaet liegt in derselben Tabelle wie eine OIDC-Identitaet,
-- aber unter dem Namen 'saml:<slug>'. Der Praefix ist kein Schmuck: Ohne ihn
-- koennten ein OIDC-Anbieter und ein SAML-Anbieter mit demselben Slug sich
-- gegenseitig die Subjects ueberschreiben, und ein Subject ist die Zusage
-- **eines** Ausstellers. Ein Doppelpunkt kann in keinem Slug stehen, also kann
-- auch kein OIDC-Anbieter je so heissen.
--
-- Die Bedingung aus 0024 kannte nur die Slug-Form und hat den Praefix
-- abgewiesen. Gefunden hat das der echte PostgreSQL-Lauf zu (2.99): Der
-- Speicher-Adapter kennt die Bedingung nicht und liess die Zeile durch, die
-- Datenbank nicht. Genau dafuer gibt es den Lauf.
ALTER TABLE project_auth_oidc_identities
  DROP CONSTRAINT project_auth_oidc_identities_provider_check;
ALTER TABLE project_auth_oidc_identities
  ADD CONSTRAINT project_auth_oidc_identities_provider_check CHECK (
    provider ~ '^[a-z][a-z0-9_-]{0,62}$'
    OR provider ~ '^saml:[a-z][a-z0-9_-]{0,62}$'
  );

-- Scope-Spalten bleiben unveraenderlich, wie bei jeder project_auth_*-Tabelle.
CREATE TRIGGER project_auth_saml_assertions_scope_immutable
BEFORE UPDATE ON project_auth_saml_assertions
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_scope_mutation();

REVOKE ALL ON project_auth_saml_assertions FROM PUBLIC;

-- Kein UPDATE. Eine gemerkte Assertion aendert sich nicht; was sich aendern
-- liesse, waere der Riegel selbst. DELETE steht fuer das Aufraeumen
-- abgelaufener Zeilen und fuer nichts anderes.
GRANT SELECT, INSERT, DELETE ON project_auth_saml_assertions TO qkern_auth;

COMMIT;
