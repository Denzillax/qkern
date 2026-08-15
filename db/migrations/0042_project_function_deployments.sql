BEGIN;

-- Der Image-Deployment-Fluss — Sprosse 6 der Paritaetsleiter.
--
-- Seit 0033 ist eine Function-Definition unveraenderlich bis auf das
-- Aktivierungsflag: Ein Aufruf darf nie gegen eine Definition laufen, die
-- sich zwischen Aufloesen und Ausfuehren veraendert hat. Diese Grenze bleibt.
-- Neu ist eine einzige, definierte Tuer hindurch: `qkern_deploy_project_function`
-- wechselt das Image **und** schreibt im selben Atemzug die Historienzeile —
-- eine Image-Aenderung ohne ihre Historie ist damit nicht ausdrueckbar, auch
-- nicht fuer den Eigentuemer.
CREATE TABLE project_function_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  function_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  image text NOT NULL CHECK (image ~ '^[a-z0-9][a-z0-9./_-]{2,255}@sha256:[0-9a-f]{64}$'),
  deployed_by text NOT NULL CHECK (char_length(deployed_by) BETWEEN 1 AND 320),
  deployed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, function_id, revision),
  FOREIGN KEY (organization_id, project_id, environment, function_id)
    REFERENCES project_functions (organization_id, project_id, environment, id)
    ON DELETE CASCADE
);

CREATE INDEX project_function_deployments_history_idx
  ON project_function_deployments (organization_id, function_id, revision DESC);

ALTER TABLE project_function_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_function_deployments FORCE ROW LEVEL SECURITY;

-- Append-only wie Preisblatt und Rechnungen: keine UPDATE-, keine
-- DELETE-Policy. Was einmal ausgerollt war, laesst sich nicht umschreiben.
CREATE POLICY project_function_deployments_tenant_select ON project_function_deployments
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_function_deployments_tenant_insert ON project_function_deployments
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

-- Der Wachtrigger aus 0033 bekommt genau eine Ausnahme: Ein Image-Wechsel ist
-- erlaubt, wenn das transaktionslokale Deployment-Flag gesetzt ist — und das
-- setzt ausschliesslich qkern_deploy_project_function, nachdem die
-- Historienzeile geschrieben ist.
CREATE OR REPLACE FUNCTION qkern_validate_project_function_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id
     OR NEW.project_id <> OLD.project_id OR NEW.environment <> OLD.environment
     OR NEW.name <> OLD.name OR NEW.runtime <> OLD.runtime
     OR (NEW.image <> OLD.image
         AND COALESCE(current_setting('qkern.function_deployment', true), '') <> '1')
     OR NEW.entrypoint <> OLD.entrypoint OR NEW.timeout_ms <> OLD.timeout_ms
     OR NEW.memory_mib <> OLD.memory_mib OR NEW.max_concurrency <> OLD.max_concurrency
     OR NEW.egress_origins <> OLD.egress_origins OR NEW.secret_refs <> OLD.secret_refs
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'function definition is immutable except for the enabled flag'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Die eine Tuer. SECURITY DEFINER, weil die Laufzeitrolle das Image-Feld
-- absichtlich nicht schreiben darf; FORCE RLS gilt auch dem Eigentuemer, und
-- die Organisationsbindung kommt aus derselben Sitzungsvariablen wie ueberall.
CREATE FUNCTION qkern_deploy_project_function(target_function_id uuid, new_image text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fn record;
  next_revision integer;
  actor text;
BEGIN
  actor := COALESCE(nullif(current_setting('qkern.actor_ref', true), ''), 'unknown');
  IF new_image !~ '^[a-z0-9][a-z0-9./_-]{2,255}@sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'image must be digest-pinned' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO fn FROM project_functions
    WHERE id = target_function_id
      AND organization_id = qkern_current_organization_id()
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'function not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(max(revision), 0) + 1 INTO next_revision
    FROM project_function_deployments
    WHERE organization_id = fn.organization_id AND function_id = fn.id;
  INSERT INTO project_function_deployments
    (organization_id, project_id, environment, function_id, revision, image, deployed_by)
    VALUES (fn.organization_id, fn.project_id, fn.environment, fn.id, next_revision, new_image, actor);
  PERFORM set_config('qkern.function_deployment', '1', true);
  UPDATE project_functions SET image = new_image
    WHERE id = fn.id AND organization_id = fn.organization_id;
  PERFORM set_config('qkern.function_deployment', '', true);
  RETURN next_revision;
END;
$$;

REVOKE ALL ON project_function_deployments
  FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner, qkern_auth;
REVOKE ALL ON FUNCTION qkern_deploy_project_function(uuid, text)
  FROM PUBLIC, qkern_worker, qkern_provisioner, qkern_auth;

-- Lesen darf die Laufzeit; schreiben nur die Tuer.
GRANT SELECT ON project_function_deployments TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_deploy_project_function(uuid, text) TO qkern_runtime;

COMMIT;
