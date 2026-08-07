-- Clusterweite Nebenlaeufigkeitsgrenze fuer Functions.
--
-- `max_concurrency` steht seit Migration 0033 in der Definition und wird seit
-- Release 1.24 beim Aufruf durchgesetzt — aber **prozesslokal**. Zwei
-- Web-Instanzen zaehlten getrennt, die tatsaechliche Obergrenze war also
-- `max_concurrency × Instanzen`. Jede Release-Notiz seit 1.23 fuehrte das offen
-- mit; hier wird es geschlossen.
--
-- Ein Platz ist eine Zeile. Sie entsteht vor dem Start des Containers und
-- verschwindet, wenn er fertig ist.
--
-- ## Warum ein Ablauf und keine Aufraeumaufgabe
--
-- Ein Prozess kann zwischen Belegen und Freigeben sterben. Ohne Ablauf bliebe
-- der Platz fuer immer belegt, und die Function waere nach ein paar Abstuerzen
-- dauerhaft "voll" — genau der Fehler, den Release 1.24 schon einmal
-- prozesslokal behoben hat. Der Ablauf macht die Freigabe zur Eigenschaft der
-- Zeile statt zur Aufgabe eines Aufraeumers, den es noch nicht gibt.

CREATE TABLE project_function_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  function_id uuid NOT NULL,
  -- Nur zur Beobachtung. Die Grenze haengt nicht daran, wer den Platz haelt:
  -- Ein Adapter, der nach Instanz filtert, koennte fremde Plaetze uebersehen.
  holder text NOT NULL CHECK (holder ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > claimed_at),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  -- Ein Platz gehoert zu genau einer Definition desselben Scopes. Ohne diesen
  -- Fremdschluessel koennte ein Platz eine Function belegen, die es nicht gibt.
  FOREIGN KEY (organization_id, project_id, environment, function_id)
    REFERENCES project_functions (organization_id, project_id, environment, id)
    ON DELETE CASCADE
);

-- Der Zaehlweg des Adapters: alle noch gueltigen Plaetze einer Definition.
CREATE INDEX project_function_slots_active_idx
  ON project_function_slots (organization_id, project_id, environment, function_id, expires_at);

-- Ein Platz ist unveraenderlich. Wer ihn laenger braucht, nimmt einen neuen;
-- eine verlaengerbare Zeile waere ein Weg, die Grenze zu umgehen, ohne sie zu
-- verletzen.
CREATE OR REPLACE FUNCTION qkern_reject_project_function_slot_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'function slots are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER project_function_slots_guard
  BEFORE UPDATE ON project_function_slots FOR EACH ROW
  EXECUTE FUNCTION qkern_reject_project_function_slot_update();

ALTER TABLE project_function_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_function_slots_select ON project_function_slots
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_function_slots_insert ON project_function_slots
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_function_slots_delete ON project_function_slots
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_function_slots FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_function_slot_update() FROM PUBLIC;

-- Kein UPDATE-Recht. Der Trigger ist die zweite Sicherung, das fehlende Recht
-- die erste.
GRANT SELECT, INSERT, DELETE ON project_function_slots TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_project_function_slot_update() TO qkern_runtime;
