BEGIN;

-- Eine Zustimmung ist eine Zeile (2.92).
--
-- ## Was 0062 offen gelassen hat
--
-- Der OAuth-Server aus 0062 kennt Clients, Codes und Token, aber keine
-- Zustimmung. Wer zugestimmt hat, stand nur am Code und am Token, also an zwei
-- kurzlebigen Dingen, und war nach einer Stunde nicht mehr zu sehen. Daraus
-- folgten die drei Luecken, die diese Migration zusammen schliesst: kein
-- Widerruf je Zustimmung (nur je Client), keine Ansicht, welcher Nutzer welchem
-- Client zugestimmt hat, und keine Tatsache in der Datenbank, auf die sich
-- QKERN bei der Frage "hat er zugestimmt?" berufen koennte.
--
-- ## Was eine Zustimmung ist
--
-- Ein Nutzer, ein Client, eine Menge von Bereichen, ein Zeitpunkt, und ob sie
-- noch gilt. Mehr nicht, und jedes Weniger waere eine andere Frage:
--
-- * Ohne die Bereiche waere sie eine Zustimmung zu einer Anwendung und nicht zu
--   dem, was diese Anwendung tun darf. Genau das unterscheidet `data:read` von
--   `data:write`, und das ist der Unterschied, den ein Nutzer wirklich meint.
-- * Ohne den Zeitpunkt waere sie nicht nachzulesen. Die Console zeigt ihn, und
--   der Betreiber sieht damit, ob eine Erlaubnis von gestern oder von vor einem
--   Jahr ist.
-- * Ohne den Widerrufsvermerk waere Widerruf gleich Loeschen, und wer widerruft,
--   will die Spur behalten. Dieselbe Entscheidung wie bei den S3-Schluesseln in
--   0059: Die Zeile bleibt stehen, sie traegt nur ein zweites Datum.
--
-- ## Wann eine zweite Zustimmung dieselbe ist
--
-- Derselbe Nutzer, derselbe Client, dieselben Bereiche: dieselbe Zeile. Der
-- Dienst legt keine zweite an, und `granted_at` bleibt der Zeitpunkt der ersten.
-- Das ist die Aussage des Teilindex weiter unten, und es ist keine
-- Bequemlichkeit: Zwei Zeilen mit demselben Inhalt waeren zwei Antworten auf die
-- Frage, seit wann diese Erlaubnis gilt, und der Widerruf der einen liesse die
-- andere stehen.
--
-- **Andere** Bereiche sind etwas anderes und werden eine zweite Zeile. Die
-- erste bleibt dabei stehen und gilt weiter. Sie stillschweigend mit zu
-- widerrufen waere ein Widerruf, den niemand verlangt hat; sie
-- stillschweigend zu erweitern waere eine Erlaubnis, die niemand erteilt hat.
-- Der Code haengt an genau einer dieser Zeilen (siehe `consent_id` unten), also
-- ist auch ohne Ordnung der Zeilen entschieden, welche gilt.
--
-- ## Und was eine Zustimmung nicht belegt
--
-- Sie belegt **nicht**, dass ein Mensch eine Liste gelesen hat. QKERN hat keine
-- eigene Zustimmungsseite, und eine zu bauen hiesse, einen Anmeldefluss im
-- Browser zu bauen; das ist ein eigener Schnitt. Was diese Zeile belegt, ist
-- schmaler und dafuer wahr: Ein Aufrufer mit dem gueltigen Access Token dieses
-- Nutzers hat genau diese Bereiche ausdruecklich genannt, zu diesem Zeitpunkt,
-- in einer Anfrage, die nichts anderes tut. Die Seite sagt diesen Unterschied
-- mit denselben Worten.

CREATE TABLE project_auth_oauth_consents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  -- Faellt der Client, fallen seine Zustimmungen. Das ist dieselbe Kette wie
  -- bei Codes und Token in 0062 und die ehrlichere Variante: Ein Client, den es
  -- nicht mehr gibt, kann keine Erlaubnis mehr tragen, und eine Zustimmung ohne
  -- Client waere eine Zeile, die auf einen Namen zeigt, den niemand mehr kennt.
  -- Der Unterschied zum Widerruf steht auf der Seite: Widerruf behaelt die Zeile,
  -- Entfernen des Clients nimmt sie mit.
  client_id uuid NOT NULL REFERENCES project_auth_oauth_clients (id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES project_auth_users (id) ON DELETE CASCADE,
  -- Die Bereiche, in der Reihenfolge der Liste aus oauth.ts. Der Dienst ordnet
  -- sie, bevor er schreibt, und darauf ruht der Teilindex unten: Zwei
  -- Schreibweisen derselben Menge waeren sonst zwei verschiedene Zeilen, und die
  -- zweite Zustimmung waere nicht mehr dieselbe.
  scopes text[] NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  -- Der Widerruf. Ein Datum und kein Schalter: Ein Schalter sagte nur, dass
  -- widerrufen wurde, dieses Feld sagt, wann.
  revoked_at timestamptz,
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE
);

ALTER TABLE project_auth_oauth_consents
  ADD CONSTRAINT project_auth_oauth_consents_scope_check CHECK (
    array_length(scopes, 1) BETWEEN 1 AND 3 AND
    array_to_string(scopes, ' ') ~
      '^(identity:read|data:read|data:write)( (identity:read|data:read|data:write))*$'
  );

-- Ein Widerruf liegt nie vor der Zustimmung. Dieselbe Bedingung wie in 0059,
-- und sie faengt den Fall, in dem eine Uhr springt oder ein Handeingriff ein
-- Datum erfindet.
ALTER TABLE project_auth_oauth_consents
  ADD CONSTRAINT project_auth_oauth_consents_revocation_check CHECK (
    revoked_at IS NULL OR revoked_at >= granted_at
  );

-- Eine geltende Zustimmung je Nutzer, Client und Bereichsmenge.
--
-- Teilindex, und der Teil ist der Punkt: Widerrufene Zeilen bleiben stehen, und
-- es duerfen mehrere davon sein, denn ein Nutzer kann derselben Anwendung
-- zustimmen, widerrufen und wieder zustimmen. Jede Runde ist dann eine eigene
-- Zeile mit eigenem Zeitpunkt, und genau das ist die Spur, die ein Widerruf
-- behalten soll. Ohne `WHERE` waere die zweite Zustimmung nach einem Widerruf
-- ein Fehler, und der Betreiber muesste die alte Zeile loeschen, um sie zu
-- erlauben.
CREATE UNIQUE INDEX project_auth_oauth_consents_active_idx
  ON project_auth_oauth_consents
     (organization_id, project_id, environment, client_id, auth_user_id, scopes)
  WHERE revoked_at IS NULL;

-- Der Weg der Console: zu einem Client alle seine Zustimmungen, die geltenden
-- wie die widerrufenen.
CREATE INDEX project_auth_oauth_consents_client_idx
  ON project_auth_oauth_consents
     (organization_id, project_id, environment, client_id, granted_at DESC);

-- Der Scope bleibt unveraenderlich, wie bei jeder project_auth_*-Tabelle seit
-- 0024. Zusammen mit dem Rechtesatz unten heisst das: An einer Zustimmung ist
-- nach dem Anlegen nur noch der Widerruf zu aendern.
CREATE TRIGGER project_auth_oauth_consents_scope_immutable
BEFORE UPDATE ON project_auth_oauth_consents
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_scope_mutation();

-- Und der Widerruf geht nur in eine Richtung. Ohne diesen Waechter koennte ein
-- zweites UPDATE `revoked_at` wieder auf NULL setzen, und dann waere eine
-- widerrufene Erlaubnis wieder offen, ohne dass die Liste es zeigt. Derselbe
-- Gedanke wie beim Schluesselpaar in 0059, nur an der Zustimmung.
CREATE OR REPLACE FUNCTION qkern_reject_project_auth_oauth_consent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id OR
     NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id OR
     NEW.scopes IS DISTINCT FROM OLD.scopes OR
     NEW.granted_at IS DISTINCT FROM OLD.granted_at OR
     (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'project auth oauth consents are immutable except for one-way revocation'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_auth_oauth_consents_immutable
BEFORE UPDATE ON project_auth_oauth_consents
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_oauth_consent_mutation();

REVOKE ALL ON project_auth_oauth_consents FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_auth_oauth_consent_mutation() FROM PUBLIC;

-- SELECT, INSERT und UPDATE auf genau einer Spalte. Kein DELETE, und das ist
-- die Aussage dieser Tabelle: Widerruf ist nicht Loeschen. Wer widerruft, will
-- die Spur behalten, also bleibt die Zeile mit ihrem Zeitpunkt stehen, und die
-- Rolle, die den Widerruf ausfuehrt, hat gar kein Recht, sie zu entfernen.
GRANT SELECT, INSERT ON project_auth_oauth_consents TO qkern_auth;
GRANT UPDATE (revoked_at) ON project_auth_oauth_consents TO qkern_auth;
GRANT EXECUTE ON FUNCTION qkern_reject_project_auth_oauth_consent_mutation() TO qkern_auth;

-- ## Die Bindung: Code und Token haengen an genau einer Zustimmung
--
-- Ohne diese beiden Spalten waere der Widerruf wieder nur eine Behauptung. Ein
-- Token gilt, weil eine Zeile existiert (0062); jetzt gilt es zusaetzlich nur,
-- solange **diese** Zustimmung gilt. Der Vergleich laeuft ueber den
-- Fremdschluessel und nicht ueber Nutzer, Client und Bereiche: Drei Werte
-- nachtraeglich zu vergleichen hiesse, dieselbe Zuordnung ein zweites Mal zu
-- bauen, und zwei Bauarten derselben Zuordnung koennen auseinanderlaufen.
--
-- **Die Spalte ist NULL-bar, und das ist kein Schlupfloch.** Zeilen aus der Zeit
-- vor dieser Migration tragen keine Zustimmung, weil es damals keine gab. Der
-- Dienst weist sie ab: Ein Token ohne Zustimmung ist genau das, was dieser
-- Schnitt abschafft. Der Preis ist hoechstens eine Stunde, denn laenger gilt
-- kein Token, und ein Code ist nach einer Minute ohnehin tot. Die Alternative
-- waere gewesen, die alten Zeilen zu loeschen, und das haette die Spur
-- weggenommen, um die es hier gerade geht.
ALTER TABLE project_auth_oauth_codes
  ADD COLUMN consent_id uuid REFERENCES project_auth_oauth_consents (id) ON DELETE CASCADE;

ALTER TABLE project_auth_oauth_tokens
  ADD COLUMN consent_id uuid REFERENCES project_auth_oauth_consents (id) ON DELETE CASCADE;

COMMIT;
