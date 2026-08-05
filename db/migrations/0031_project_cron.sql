-- Dauerhafte Cron-Definitionen und Fortschritt je Definition.
--
-- Der CronDispatcher existiert seit Release 1.6 Alpha 4, aber seine
-- Definitionen kamen aus dem Nichts: Es gab keinen Ort, an dem ein Betreiber
-- einen Zeitplan hinterlegen konnte, und keinen Fortschritt, an dem ein
-- Scheduler ansetzen koennte.
--
-- Ausdruecklich **kein** Lease-Mechanismus. Der Dispatcher enqueuet mit dem
-- Occurrence-Dedupe-Key `cron:<id>:<zeitpunkt>`; zwei Instanzen, die dasselbe
-- Vorkommen ausloesen, erzeugen deshalb genau eine Nachricht. Die Queue ist
-- bereits die Autoritaet fuer Einmaligkeit. Eine zweite Autoritaet daneben
-- waere eine zusaetzliche Fehlerquelle ohne zusaetzliche Garantie.
--
-- `last_dispatched_at` ist deshalb Fortschritt, keine Sperre: Es begrenzt, wie
-- weit ein Scheduler nachholt, und darf nur vorwaerts laufen.

CREATE TABLE project_cron_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{2,62}$'),
  -- Der Parser akzeptiert nur einen kleinen UTC-Ausdruck. Die Laengengrenze
  -- haelt die Spalte klein; die Form prueft der Dienst.
  expression text NOT NULL CHECK (char_length(expression) BETWEEN 5 AND 64),
  queue text NOT NULL CHECK (queue ~ '^[a-z][a-z0-9_-]{2,62}$'),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 65536),
  enabled boolean NOT NULL DEFAULT true,
  -- Zuletzt ausgeloestes Vorkommen. NULL bedeutet: noch nie ausgeloest.
  last_dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT project_cron_definitions_name_key
    UNIQUE (organization_id, project_id, environment, name),
  CONSTRAINT project_cron_definitions_scope_id_key
    UNIQUE (organization_id, project_id, environment, id)
);

CREATE INDEX project_cron_definitions_due_idx
  ON project_cron_definitions (organization_id, project_id, environment, last_dispatched_at)
  WHERE enabled;

-- Der Fortschritt darf niemals zurueckspringen. Ein Ruecksprung wuerde
-- vergangene Vorkommen erneut ausloesen; das Dedupe-Fenster der Queue ist
-- endlich und faengt das nicht dauerhaft ab.
CREATE OR REPLACE FUNCTION qkern_validate_project_cron_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id
     OR NEW.project_id <> OLD.project_id OR NEW.environment <> OLD.environment
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'cron identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.last_dispatched_at IS NOT NULL
     AND (NEW.last_dispatched_at IS NULL OR NEW.last_dispatched_at < OLD.last_dispatched_at) THEN
    RAISE EXCEPTION 'cron progress must not move backwards' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_cron_definitions_guard
  BEFORE UPDATE ON project_cron_definitions FOR EACH ROW
  EXECUTE FUNCTION qkern_validate_project_cron_update();

ALTER TABLE project_cron_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_cron_definitions_select ON project_cron_definitions
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_cron_definitions_insert ON project_cron_definitions
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_cron_definitions_update ON project_cron_definitions
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_cron_definitions_delete ON project_cron_definitions
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_cron_definitions FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_validate_project_cron_update() FROM PUBLIC;

GRANT SELECT, INSERT, DELETE ON project_cron_definitions TO qkern_runtime;
-- Eng: der Scheduler schreibt ausschliesslich den Fortschritt, ein
-- Administrator zusaetzlich das Aktivierungsflag. Ausdruck, Queue und Payload
-- bleiben unveraenderlich; eine Aenderung erfolgt ueber Loeschen und Neuanlegen
-- und damit ueber den Audit-Weg.
GRANT UPDATE (last_dispatched_at, enabled, updated_at)
  ON project_cron_definitions TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_validate_project_cron_update() TO qkern_runtime;
