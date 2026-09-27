BEGIN;

-- Anmeldung mit WebAuthn fuer Project Auth (2.79).
--
-- Warum eine eigene Tabelle und nicht project_auth_mfa_factors: Der Faktor aus
-- 0024 ist genau einer je Nutzer, traegt ein verschluesseltes Geheimnis und ist
-- ein *zweiter* Faktor. Ein Passkey ist keines von beidem. Er ist ein erster
-- Faktor, es gibt mehrere je Nutzer (Telefon, Rechner, Sicherheitsschluessel),
-- und er traegt kein Geheimnis: Was hier liegt, ist ein oeffentlicher
-- Schluessel. Beides in eine Zeile zu zwingen haette aus der eindeutigen
-- Bedingung "einer je Nutzer" eine Luege gemacht.
--
-- Was hier **nicht** liegt, ist der wichtigste Teil dieser Tabelle: kein
-- privater Schluessel, kein Geheimnis, nichts Verschluesseltes. Der private
-- Teil verlaesst den Authenticator nie. Ein Leck dieser Tabelle gibt niemandem
-- die Moeglichkeit, sich anzumelden; es verraet, welche Nutzer wie viele
-- Passkeys haben. Darum steht hier auch kein aes-Feld und kein Schluessel aus
-- der Prozessumgebung: Es gibt nichts zu schuetzen, was Verschluesselung
-- schuetzen wuerde.
CREATE TABLE project_auth_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  auth_user_id uuid NOT NULL,
  -- Die Kennung, die der Browser fuehrt, in base64url. 1023 Byte ist die
  -- Grenze der Spezifikation; base64url macht daraus 1364 Zeichen.
  -- Die Grenzen stehen als char_length und nicht als Wiederholung im Muster:
  -- PostgreSQL laesst in einem regulaeren Ausdruck hoechstens 255 Wiederholungen
  -- zu, und {16,1364} ist darum kein gueltiges Muster. Der Fall (2.79) hat das
  -- an der echten Datenbank gezeigt; ein Muster, das nur in der Theorie prueft,
  -- prueft nichts.
  credential_id text NOT NULL CHECK (
    char_length(credential_id) BETWEEN 16 AND 1364 AND credential_id ~ '^[A-Za-z0-9_-]+$'
  ),
  -- Der oeffentliche Schluessel als SPKI-DER in base64url. Ein P-256-Schluessel
  -- ist 91 Byte lang und damit 122 Zeichen; die Grenzen lassen Luft, aber nicht
  -- beliebig viel: Eine Spalte ohne Grenze ist eine Einladung, etwas anderes
  -- als einen Schluessel hineinzulegen.
  public_key text NOT NULL CHECK (
    char_length(public_key) BETWEEN 100 AND 512 AND public_key ~ '^[A-Za-z0-9_-]+$'
  ),
  -- Das Verfahren in der Zaehlung von COSE. Genau -7 (ES256), und zwar in der
  -- Datenbank und nicht nur im Dienst: Eine Zeile mit einem Verfahren, das der
  -- Dienst nicht prueft, waere ein Passkey, der nie funktioniert, und sie sah
  -- wie einer aus, der funktioniert. Kommt RS256 oder EdDSA je dazu, ist dieses
  -- CHECK die Stelle, die es zugeben muss.
  algorithm integer NOT NULL CHECK (algorithm = -7),
  -- Der Zaehler des Authenticators. Er darf nur wachsen, und dass er das tut,
  -- prueft der Dienst gegen den hier abgelegten Stand; ein rueckwaerts
  -- laufender Zaehler heisst geklonter Schluessel. 0 heisst "dieser
  -- Authenticator fuehrt keinen Zaehler" und ist erlaubt.
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0 AND sign_count <= 4294967295),
  -- Ob der Authenticator bei der Registrierung den Nutzer erkannt hat (PIN,
  -- Fingerabdruck, Gesicht). Nur eine Auskunft fuer die Uebersicht: Die
  -- Anmeldung haengt nicht daran, und die Seite sagt das auch.
  user_verified boolean NOT NULL DEFAULT false,
  -- Das Format der Attestation, wie es in der Antwort stand. Abgelegt, damit
  -- man spaeter sehen kann, was ein Geraet geschickt hat; **geprueft wird es
  -- nicht**. Bei 'none', und das ist der Normalfall, gibt es auch nichts zu
  -- pruefen.
  attestation_format text NOT NULL CHECK (attestation_format ~ '^[a-z][a-z0-9-]{1,31}$'),
  -- Ein Name, den der Nutzer selbst vergibt, damit er in der Liste seine
  -- Geraete unterscheiden kann. Keine Adresse, keine Kennung eines Geraets, die
  -- der Server sich ausdenkt.
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  FOREIGN KEY (organization_id, project_id, environment, auth_user_id)
    REFERENCES project_auth_users (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  -- Eine Kennung je Umgebung, und zwar ueber die Umgebung und nicht ueber den
  -- Nutzer: Zwei Nutzer derselben Umgebung mit derselben Kennung waeren zwei
  -- Anmeldungen, zwischen denen die Anmeldung nicht entscheiden koennte, weil
  -- sie den Nutzer erst aus der Kennung nachschlaegt.
  CONSTRAINT project_auth_passkeys_credential_key
    UNIQUE (organization_id, project_id, environment, credential_id),
  CONSTRAINT project_auth_passkeys_usage CHECK (last_used_at IS NULL OR last_used_at >= created_at)
);

-- Die Liste eines Nutzers, neueste zuerst. Der andere Zugriff, das Nachschlagen
-- einer Kennung, trifft die eindeutige Bedingung oben.
CREATE INDEX project_auth_passkeys_user_idx
  ON project_auth_passkeys (organization_id, project_id, environment, auth_user_id, created_at DESC);

-- Die kurzlebigen Herausforderungen liegen in derselben Tabelle wie die
-- uebrigen kurzlebigen Token, mit zwei eigenen Zwecken. Zwei und nicht einer,
-- weil eine Herausforderung fuer eine Registrierung nichts bei einer Anmeldung
-- zu suchen hat: Sonst liesse sich eine Herausforderung, die ein angemeldeter
-- Nutzer fuer ein neues Geraet geholt hat, an der Anmeldung einloesen.
--
-- Verbraucht wird jede Herausforderung ueber consumeOneTimeToken, also mit
-- einem UPDATE, das consumed_at setzt und nur dann eine Zeile zurueckgibt, wenn
-- es sie selbst gesetzt hat. Das macht die Einmaligkeit in der Datenbank und
-- nicht im Dienst: Zwei Anfragen mit derselben Herausforderung bekommen genau
-- einmal eine Zeile.
--
-- Die Herausforderung fuer eine Anmeldung traegt keinen Nutzer (auth_user_id
-- bleibt NULL): Wer sich anmeldet, sagt vorher nicht, wer er ist, und der
-- Server soll aus der Herausforderung auch nicht schliessen koennen, welche
-- Adresse es gibt.
ALTER TABLE project_auth_one_time_tokens
  DROP CONSTRAINT project_auth_one_time_tokens_purpose_check;
ALTER TABLE project_auth_one_time_tokens
  ADD CONSTRAINT project_auth_one_time_tokens_purpose_check CHECK (purpose IN (
    'email_verification', 'magic_link', 'password_reset', 'oidc_state',
    'mfa_challenge', 'mfa_enrollment',
    'passkey_registration', 'passkey_authentication'
  ));

-- Scope-Spalten bleiben unveraenderlich, wie bei jeder project_auth_*-Tabelle.
-- Der Trigger aus 0024 prueft genau das und haelt zusaetzlich die id fest.
CREATE TRIGGER project_auth_passkeys_scope_immutable
BEFORE UPDATE ON project_auth_passkeys
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_scope_mutation();

REVOKE ALL ON project_auth_passkeys FROM PUBLIC;

-- Gegen die uebrigen project_auth_*-Tabellen gibt es hier einen Unterschied:
-- DELETE. Ein Nutzer muss ein verlorenes Geraet wirklich entfernen koennen, und
-- "entfernt" heisst hier weg und nicht markiert. Eine widerrufene Zeile haette
-- den oeffentlichen Schluessel und die Kennung behalten und in jeder Liste
-- erklaert werden muessen; das ist mehr Flaeche fuer weniger Aussage. Ein
-- Passkey ist ausserdem nichts, wofuer es eine Spur in der Zeile braucht: Dass
-- einer entfernt wurde, steht im Audit, und das Audit ist append-only.
--
-- UPDATE nur auf den zwei Spalten, die sich im Betrieb aendern: der Zaehler und
-- der Zeitpunkt der letzten Benutzung. Der oeffentliche Schluessel, die
-- Kennung und das Verfahren sind nach dem Anlegen fest; ein Passkey, dessen
-- Schluessel sich aendern laesst, ist kein Passkey.
GRANT SELECT, INSERT, DELETE ON project_auth_passkeys TO qkern_auth;
GRANT UPDATE (sign_count, last_used_at) ON project_auth_passkeys TO qkern_auth;

COMMIT;
