BEGIN;

CREATE TYPE qkern_migration_job_status AS ENUM ('queued', 'running', 'applied', 'failed');
CREATE TYPE qkern_outbox_status AS ENUM ('pending', 'published');

-- This is a control-plane queue. It deliberately stores only references to an
-- immutable Change Set. SQL ciphertext and project database credentials never
-- enter the queue.
CREATE TABLE migration_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  database_instance_ref text NOT NULL
    CHECK (char_length(database_instance_ref) BETWEEN 1 AND 200)
    CHECK (database_instance_ref !~ '://|@')
    CHECK (database_instance_ref !~* '^pending:'),
  change_set_id uuid NOT NULL,
  status qkern_migration_job_status NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 100),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_jobs_change_set_scope_fk
    FOREIGN KEY (organization_id, project_id, environment, change_set_id)
    REFERENCES change_sets (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT migration_jobs_one_per_change_set
    UNIQUE (organization_id, change_set_id),
  CONSTRAINT migration_jobs_scope_key
    UNIQUE (organization_id, id),
  CONSTRAINT migration_jobs_attempt_bounds
    CHECK (attempt_count <= max_attempts),
  CONSTRAINT migration_jobs_state_shape
    CHECK (
      (status = 'queued' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND finished_at IS NULL) OR
      (status = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND finished_at IS NULL) OR
      (status IN ('applied', 'failed') AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND finished_at IS NOT NULL)
    )
);

CREATE INDEX migration_jobs_queued_claim_idx
  ON migration_jobs (organization_id, available_at, created_at, id)
  WHERE status = 'queued';

CREATE INDEX migration_jobs_running_lease_idx
  ON migration_jobs (organization_id, lease_expires_at, created_at, id)
  WHERE status = 'running';

CREATE TABLE migration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  migration_job_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'migration.apply.requested'),
  status qkern_outbox_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_outbox_job_scope_fk
    FOREIGN KEY (organization_id, migration_job_id)
    REFERENCES migration_jobs (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT migration_outbox_one_request_per_job
    UNIQUE (organization_id, migration_job_id, event_type),
  CONSTRAINT migration_outbox_state_shape
    CHECK (
      (status = 'pending' AND published_at IS NULL AND (
        (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) OR
        (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      )) OR
      (status = 'published' AND published_at IS NOT NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    )
);

CREATE INDEX migration_outbox_claim_idx
  ON migration_outbox (organization_id, available_at, created_at, id)
  WHERE status = 'pending';

CREATE TRIGGER migration_jobs_touch_updated_at
BEFORE UPDATE ON migration_jobs
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

CREATE TRIGGER migration_outbox_touch_updated_at
BEFORE UPDATE ON migration_outbox
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

-- A provisioner may replace a pending reference once. A provisioned target is
-- immutable so an already reviewed Change Set cannot be silently retargeted.
CREATE OR REPLACE FUNCTION qkern_reject_project_database_retarget()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.database_instance_ref !~* '^pending:' AND
     NEW.database_instance_ref IS DISTINCT FROM OLD.database_instance_ref THEN
    RAISE EXCEPTION 'a provisioned project database reference is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_environments_database_ref_immutable
BEFORE UPDATE OF database_instance_ref ON project_environments
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_database_retarget();

-- Approval status is monotonic and an approved/rejected transition is only
-- valid after the matching immutable decision row was inserted in the same
-- transaction. This prevents an orphaned status flip from becoming executable.
CREATE OR REPLACE FUNCTION qkern_require_approval_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'an approval decision is irreversible' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') AND NOT EXISTS (
    SELECT 1
    FROM approval_decisions AS decision
    WHERE decision.organization_id = NEW.organization_id
      AND decision.approval_request_id = NEW.id
      AND decision.decision = NEW.status
  ) THEN
    RAISE EXCEPTION 'approval status requires a matching decision' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_requests_decision_required
BEFORE UPDATE OF status ON approval_requests
FOR EACH ROW EXECUTE FUNCTION qkern_require_approval_decision();

ALTER TABLE migration_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE migration_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY migration_jobs_select ON migration_jobs
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY migration_jobs_insert ON migration_jobs
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY migration_jobs_update ON migration_jobs
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

CREATE POLICY migration_outbox_select ON migration_outbox
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY migration_outbox_insert ON migration_outbox
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY migration_outbox_update ON migration_outbox
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON migration_jobs, migration_outbox FROM PUBLIC;
REVOKE ALL ON migration_jobs, migration_outbox FROM qkern_runtime;

-- Runtime callers may create only a pending request. Omitting `status` forces
-- the table default; approved/rejected can only be reached through the
-- decision-bound UPDATE trigger above.
REVOKE INSERT ON approval_requests FROM qkern_runtime;
GRANT INSERT (organization_id, project_id, change_set_id, environment, action_hash, expires_at)
  ON approval_requests TO qkern_runtime;

GRANT SELECT ON migration_jobs TO qkern_runtime;
GRANT INSERT (organization_id, project_id, environment, database_instance_ref, change_set_id, max_attempts, available_at)
  ON migration_jobs TO qkern_runtime;
GRANT UPDATE (
  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,
  last_error_code, last_error_message, started_at, finished_at, updated_at
) ON migration_jobs TO qkern_runtime;

GRANT SELECT ON migration_outbox TO qkern_runtime;
GRANT INSERT (organization_id, migration_job_id, event_type)
  ON migration_outbox TO qkern_runtime;
GRANT UPDATE (
  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,
  published_at, updated_at
) ON migration_outbox TO qkern_runtime;

GRANT EXECUTE ON FUNCTION qkern_reject_project_database_retarget() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_require_approval_decision() TO qkern_runtime;

COMMIT;
