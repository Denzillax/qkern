BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qkern_provisioner') THEN
    CREATE ROLE qkern_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
END;
$$;

CREATE TYPE qkern_project_provisioning_status
  AS ENUM ('pending', 'running', 'succeeded', 'failed');

CREATE TABLE project_database_provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  requested_by text NOT NULL CHECK (char_length(requested_by) BETWEEN 1 AND 200),
  status qkern_project_provisioning_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts = 5),
  retry_cycle_count integer NOT NULL DEFAULT 0 CHECK (retry_cycle_count BETWEEN 0 AND 3),
  max_retry_cycles integer NOT NULL DEFAULT 3 CHECK (max_retry_cycles = 3),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN (
    'PROVIDER_UNAVAILABLE', 'PROVIDER_REJECTED', 'INVALID_BINDING',
    'BOOTSTRAP_UNVERIFIED', 'PROVISIONING_TIMEOUT'
  )),
  binding_id uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_database_provisioning_jobs_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT project_database_provisioning_jobs_scope_key UNIQUE (organization_id, id),
  CONSTRAINT project_database_provisioning_jobs_environment_key
    UNIQUE (organization_id, project_id, environment),
  CONSTRAINT project_database_provisioning_jobs_lease_shape CHECK (
    (status = 'pending' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND
      finished_at IS NULL AND binding_id IS NULL) OR
    (status = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND
      started_at IS NOT NULL AND finished_at IS NULL AND binding_id IS NULL) OR
    (status = 'succeeded' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND
      finished_at IS NOT NULL AND binding_id IS NOT NULL AND last_error_code IS NULL) OR
    (status = 'failed' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND
      finished_at IS NOT NULL AND binding_id IS NULL AND last_error_code IS NOT NULL AND attempt_count = max_attempts)
  )
);

CREATE TABLE project_database_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  provisioning_job_id uuid NOT NULL,
  database_instance_ref text NOT NULL
    CHECK (char_length(database_instance_ref) BETWEEN 9 AND 128)
    CHECK (database_instance_ref ~ '^managed:[a-z0-9][a-z0-9._:-]{0,119}$')
    CHECK (database_instance_ref !~ '://|@'),
  vault_static_role text NOT NULL CHECK (vault_static_role ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  host text NOT NULL CHECK (char_length(host) BETWEEN 1 AND 253)
    CHECK (host !~ '[[:cntrl:]@/]'),
  port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
  expected_role text NOT NULL CHECK (expected_role ~ '^[a-z_][a-z0-9_]{0,62}$' AND expected_role !~ '^pg_'),
  expected_database text NOT NULL CHECK (
    expected_database ~ '^[a-z_][a-z0-9_]{0,62}$' AND expected_database !~ '^pg_'
  ),
  expected_ledger_owner text NOT NULL CHECK (
    expected_ledger_owner ~ '^[a-z_][a-z0-9_]{0,62}$' AND expected_ledger_owner !~ '^pg_'
  ),
  server_certificate_sha256 text NOT NULL CHECK (server_certificate_sha256 ~ '^[a-f0-9]{64}$'),
  bootstrap_contract_sha256 text NOT NULL CHECK (
    bootstrap_contract_sha256 = 'e69a830d70f785477af0165667f56735821e25a58bf724a17b46cf33d5358d67'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_database_bindings_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT project_database_bindings_job_fk
    FOREIGN KEY (organization_id, provisioning_job_id)
    REFERENCES project_database_provisioning_jobs (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT project_database_bindings_scope_key UNIQUE (organization_id, id),
  CONSTRAINT project_database_bindings_environment_key UNIQUE (organization_id, project_id, environment),
  CONSTRAINT project_database_bindings_reference_key UNIQUE (organization_id, database_instance_ref),
  CONSTRAINT project_database_bindings_job_key UNIQUE (organization_id, provisioning_job_id),
  CONSTRAINT project_database_bindings_role_separation CHECK (expected_role <> expected_ledger_owner)
);

ALTER TABLE project_database_provisioning_jobs
  ADD CONSTRAINT project_database_provisioning_jobs_binding_fk
    FOREIGN KEY (organization_id, binding_id)
    REFERENCES project_database_bindings (organization_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX project_database_provisioning_claim_idx
  ON project_database_provisioning_jobs (organization_id, available_at, created_at, id)
  WHERE status IN ('pending', 'running');

CREATE TRIGGER project_database_provisioning_jobs_touch_updated_at
BEFORE UPDATE ON project_database_provisioning_jobs
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

ALTER TABLE project_database_provisioning_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_database_provisioning_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE project_database_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_database_bindings FORCE ROW LEVEL SECURITY;

CREATE POLICY project_database_provisioning_jobs_tenant ON project_database_provisioning_jobs
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_database_bindings_tenant ON project_database_bindings
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

-- The web runtime can request a reference-only job only for an existing pending
-- environment. Actor binding, idempotency and bounded operator recovery are
-- decided inside this function; the runtime never receives table mutation rights.
CREATE FUNCTION qkern_request_project_database_provisioning(
  requested_project_id uuid,
  requested_environment qkern_environment
)
RETURNS TABLE (
  job_id uuid,
  job_status qkern_project_provisioning_status,
  attempt_count integer,
  max_attempts integer,
  retry_cycle_count integer,
  max_retry_cycles integer,
  last_error_code text,
  created_at timestamptz,
  updated_at timestamptz,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor text;
  pending_ref text;
  existing public.project_database_provisioning_jobs%ROWTYPE;
BEGIN
  actor := nullif(pg_catalog.current_setting('qkern.actor_ref', true), '');
  IF actor IS NULL OR char_length(actor) > 200 THEN RETURN; END IF;

  SELECT environment.database_instance_ref
  INTO pending_ref
  FROM public.project_environments AS environment
  JOIN public.projects AS project
    ON project.organization_id = environment.organization_id AND project.id = environment.project_id
  WHERE environment.organization_id = public.qkern_current_organization_id()
    AND environment.project_id = requested_project_id
    AND environment.environment = requested_environment
    AND environment.database_instance_ref ~* '^pending:'
    AND project.deleted_at IS NULL
  FOR UPDATE OF environment, project;
  IF pending_ref IS NULL THEN RETURN; END IF;

  SELECT * INTO existing
  FROM public.project_database_provisioning_jobs AS job
  WHERE job.organization_id = public.qkern_current_organization_id()
    AND job.project_id = requested_project_id
    AND job.environment = requested_environment
  FOR UPDATE;

  IF existing.id IS NULL THEN
    RETURN QUERY
      INSERT INTO public.project_database_provisioning_jobs
        (organization_id, project_id, environment, requested_by)
      VALUES (public.qkern_current_organization_id(), requested_project_id, requested_environment, actor)
      RETURNING project_database_provisioning_jobs.id, project_database_provisioning_jobs.status,
        project_database_provisioning_jobs.attempt_count,
        project_database_provisioning_jobs.max_attempts,
        project_database_provisioning_jobs.retry_cycle_count,
        project_database_provisioning_jobs.max_retry_cycles,
        project_database_provisioning_jobs.last_error_code,
        project_database_provisioning_jobs.created_at,
        project_database_provisioning_jobs.updated_at, true;
    RETURN;
  END IF;

  IF existing.status = 'failed' AND existing.retry_cycle_count < existing.max_retry_cycles THEN
    RETURN QUERY
      UPDATE public.project_database_provisioning_jobs AS job
      SET status = 'pending', attempt_count = 0, retry_cycle_count = job.retry_cycle_count + 1,
          available_at = pg_catalog.statement_timestamp(), last_error_code = NULL,
          finished_at = NULL, requested_by = actor, updated_at = pg_catalog.statement_timestamp()
      WHERE job.organization_id = public.qkern_current_organization_id() AND job.id = existing.id
      RETURNING job.id, job.status, job.attempt_count, job.max_attempts,
        job.retry_cycle_count, job.max_retry_cycles, job.last_error_code,
        job.created_at, job.updated_at, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT existing.id, existing.status, existing.attempt_count, existing.max_attempts,
    existing.retry_cycle_count, existing.max_retry_cycles, existing.last_error_code,
    existing.created_at, existing.updated_at, false;
END;
$$;

CREATE FUNCTION qkern_project_database_provisioning_status(
  requested_project_id uuid,
  requested_environment qkern_environment
)
RETURNS TABLE (
  job_id uuid,
  job_status qkern_project_provisioning_status,
  attempt_count integer,
  max_attempts integer,
  retry_cycle_count integer,
  max_retry_cycles integer,
  last_error_code text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT job.id, job.status, job.attempt_count, job.max_attempts,
         job.retry_cycle_count, job.max_retry_cycles, job.last_error_code,
         job.created_at, job.updated_at
  FROM public.project_database_provisioning_jobs AS job
  WHERE job.organization_id = public.qkern_current_organization_id()
    AND job.project_id = requested_project_id
    AND job.environment = requested_environment
$$;

REVOKE UPDATE ON projects FROM qkern_runtime;
REVOKE UPDATE, DELETE ON project_environments FROM qkern_runtime;
REVOKE ALL ON project_database_provisioning_jobs, project_database_bindings
  FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_request_project_database_provisioning(uuid, qkern_environment)
  FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_project_database_provisioning_status(uuid, qkern_environment)
  FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;

GRANT EXECUTE ON FUNCTION qkern_request_project_database_provisioning(uuid, qkern_environment) TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_project_database_provisioning_status(uuid, qkern_environment) TO qkern_runtime;

GRANT USAGE ON SCHEMA public TO qkern_provisioner;
GRANT SELECT ON projects, project_environments, project_database_provisioning_jobs TO qkern_provisioner;
GRANT UPDATE (
  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,
  last_error_code, binding_id, started_at, finished_at, updated_at
) ON project_database_provisioning_jobs TO qkern_provisioner;
GRANT INSERT ON project_database_bindings TO qkern_provisioner;
GRANT UPDATE (database_instance_ref) ON project_environments TO qkern_provisioner;
GRANT UPDATE (status, updated_at) ON projects TO qkern_provisioner;
GRANT SELECT, INSERT ON audit_logs TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_current_organization_id() TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_touch_updated_at() TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_prepare_audit_log() TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_reject_audit_mutation() TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_reject_project_database_retarget() TO qkern_provisioner;

-- Migration workers can resolve only secret-free, immutable bindings. They
-- still retrieve rotating database passwords through the Vault boundary.
GRANT SELECT ON project_database_bindings TO qkern_worker;

COMMIT;
