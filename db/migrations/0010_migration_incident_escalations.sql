BEGIN;

CREATE TYPE qkern_migration_incident_status AS ENUM ('open', 'acknowledged');
CREATE TYPE qkern_migration_incident_acknowledgement_code AS ENUM (
  'investigation_started',
  'external_dependency_engaged',
  'runbook_in_progress'
);

-- Incidents are reference-only operational records. They deliberately contain
-- no SQL, database reference, credentials, target diagnostics or free text.
CREATE TABLE migration_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  migration_job_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  change_set_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'migration_outcome_unresolved'
    CHECK (kind = 'migration_outcome_unresolved'),
  severity text NOT NULL DEFAULT 'critical'
    CHECK (severity = 'critical'),
  status qkern_migration_incident_status NOT NULL DEFAULT 'open',
  detected_review_cycle integer NOT NULL CHECK (detected_review_cycle BETWEEN 1 AND 10),
  detected_reconciliation_attempt integer NOT NULL CHECK (detected_reconciliation_attempt BETWEEN 1 AND 20),
  acknowledged_by text,
  acknowledgement_code qkern_migration_incident_acknowledgement_code,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_incidents_job_scope_fk
    FOREIGN KEY (organization_id, migration_job_id)
    REFERENCES migration_jobs (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT migration_incidents_scope_key UNIQUE (organization_id, id),
  CONSTRAINT migration_incidents_one_per_job UNIQUE (organization_id, migration_job_id),
  CONSTRAINT migration_incidents_state_shape CHECK (
    (status = 'open' AND acknowledged_by IS NULL AND acknowledgement_code IS NULL AND acknowledged_at IS NULL) OR
    (status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledgement_code IS NOT NULL AND acknowledged_at IS NOT NULL)
  )
);

CREATE INDEX migration_incidents_tenant_status_time_idx
  ON migration_incidents (organization_id, status, created_at DESC, id DESC);
CREATE INDEX migration_incidents_tenant_project_time_idx
  ON migration_incidents (organization_id, project_id, created_at DESC, id DESC);

CREATE TRIGGER migration_incidents_touch_updated_at
BEFORE UPDATE ON migration_incidents
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

CREATE FUNCTION qkern_validate_migration_incident_acknowledgement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status <> 'open' OR NEW.status <> 'acknowledged' THEN
    RAISE EXCEPTION 'migration incident acknowledgement is append-only' USING ERRCODE = '55000';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.migration_job_id IS DISTINCT FROM OLD.migration_job_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.change_set_id IS DISTINCT FROM OLD.change_set_id OR
     NEW.kind IS DISTINCT FROM OLD.kind OR
     NEW.severity IS DISTINCT FROM OLD.severity OR
     NEW.detected_review_cycle IS DISTINCT FROM OLD.detected_review_cycle OR
     NEW.detected_reconciliation_attempt IS DISTINCT FROM OLD.detected_reconciliation_attempt OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'migration incident evidence is immutable' USING ERRCODE = '55000';
  END IF;
  NEW.acknowledged_by := current_setting('qkern.actor_ref', true);
  NEW.acknowledged_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER migration_incidents_acknowledgement_guard
BEFORE UPDATE ON migration_incidents
FOR EACH ROW EXECUTE FUNCTION qkern_validate_migration_incident_acknowledgement();

ALTER TABLE migration_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_incidents FORCE ROW LEVEL SECURITY;

CREATE POLICY migration_incidents_select ON migration_incidents
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY migration_incidents_insert ON migration_incidents
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY migration_incidents_update ON migration_incidents
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON migration_incidents FROM PUBLIC, qkern_runtime, qkern_worker;
REVOKE EXECUTE ON FUNCTION qkern_validate_migration_incident_acknowledgement() FROM PUBLIC;

-- The web runtime may inspect and acknowledge an incident, but cannot create,
-- resolve or mutate its immutable evidence fields.
GRANT SELECT ON migration_incidents TO qkern_runtime;
GRANT UPDATE (status, acknowledgement_code)
  ON migration_incidents TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_validate_migration_incident_acknowledgement() TO qkern_runtime;

-- Only the dedicated worker may derive an incident from an exhausted job.
GRANT SELECT ON migration_incidents TO qkern_worker;
GRANT INSERT (
  organization_id, migration_job_id, project_id, environment, change_set_id,
  detected_review_cycle, detected_reconciliation_attempt
) ON migration_incidents TO qkern_worker;

COMMIT;
