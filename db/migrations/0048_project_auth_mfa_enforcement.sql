BEGIN;

-- Der zweite Faktor je Projektumgebung erzwingbar (2.52).
--
-- Warum ueberhaupt eine Tabelle: Bis hierher war TOTP eine freiwillige
-- Zutat. Wer ihn eingerichtet hatte, bekam beim Anmelden eine Challenge;
-- wer nicht, bekam sofort eine Sitzung. Eine Umgebung konnte den zweiten
-- Faktor nicht verlangen. Die Entscheidung gehoert zur Umgebung, nicht zum
-- Nutzer und nicht in eine Umgebungsvariable des Prozesses: Development darf
-- offen bleiben, waehrend Production den Faktor verlangt, und der Schalter
-- muss ueber einen Neustart hinweg halten.
--
-- Warum keine bestehende Spalte: project_environments gehoert der Control
-- Plane und wird von qkern_runtime geschrieben; der Anmeldedienst laeuft
-- unter qkern_auth und darf diese Tabelle nicht anfassen. Eine eigene
-- Tabelle mit denselben Scope-Spalten wie die uebrigen project_auth_* ist
-- die kleinere Aenderung: dieselbe Fremdschluessel-Kaskade, dieselben
-- Rechte, kein neues Recht auf fremden Zeilen.
--
-- Eine fehlende Zeile bedeutet "nicht erzwungen". Der Dienst legt erst beim
-- ersten Einschalten eine an; ein Projekt ohne Zeile verhaelt sich wie
-- bisher. Darum auch kein Nachtragen bestehender Umgebungen hier.
CREATE TABLE project_auth_settings (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  mfa_required boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, environment),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE
);

-- Ein Nutzer ohne Faktor muss sich einrichten koennen, sonst sperrt das
-- Einschalten alle aus. Die Anmeldung gibt ihm dafuer keine Sitzung, sondern
-- einen kurzlebigen Einrichtungsschein: ein opakes Token, das nur die
-- Routen unter `auth/mfa/enroll` oeffnet. Er liegt in derselben Tabelle wie
-- die uebrigen kurzlebigen Token, mit einem eigenen Zweck; die CHECK-Liste
-- aus 0024 kannte ihn noch nicht.
ALTER TABLE project_auth_one_time_tokens
  DROP CONSTRAINT project_auth_one_time_tokens_purpose_check;
ALTER TABLE project_auth_one_time_tokens
  ADD CONSTRAINT project_auth_one_time_tokens_purpose_check CHECK (purpose IN (
    'email_verification', 'magic_link', 'password_reset', 'oidc_state', 'mfa_challenge', 'mfa_enrollment'
  ));

-- Scope-Spalten bleiben unveraenderlich, wie bei jeder project_auth_*-Tabelle.
CREATE OR REPLACE FUNCTION qkern_reject_project_auth_settings_scope_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment THEN
    RAISE EXCEPTION 'project auth scope is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_auth_settings_scope_immutable
BEFORE UPDATE ON project_auth_settings
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_settings_scope_mutation();

REVOKE ALL ON project_auth_settings FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_auth_settings_scope_mutation() FROM PUBLIC;

-- Wie die uebrigen project_auth_*-Tabellen: explizite Spalten fuer UPDATE,
-- kein DELETE. Geloescht wird eine Zeile nur mit ihrer Umgebung, ueber die
-- Kaskade. Der Anmeldedienst liest die Zeile bei jeder Anmeldung, bei jedem
-- Refresh und bei jeder Pruefung eines Access Tokens; die Abfrage trifft den
-- Primaerschluessel.
GRANT SELECT, INSERT ON project_auth_settings TO qkern_auth;
GRANT UPDATE (mfa_required, updated_at) ON project_auth_settings TO qkern_auth;
GRANT EXECUTE ON FUNCTION qkern_reject_project_auth_settings_scope_mutation() TO qkern_auth;

COMMIT;
