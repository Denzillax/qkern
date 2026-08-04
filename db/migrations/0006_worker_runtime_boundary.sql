BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qkern_worker') THEN
    CREATE ROLE qkern_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
END;
$$;

-- Bind each queued job to the exact Approval Request that authorized it. A
-- later request for the same Change Set must never replace the reviewed
-- artifact snapshot observed by the worker.
ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_job_scope_key
    UNIQUE (organization_id, project_id, environment, change_set_id, id);

ALTER TABLE migration_jobs
  ADD COLUMN approval_request_id uuid;

UPDATE migration_jobs AS job
SET approval_request_id = (
  SELECT request.id
  FROM approval_requests AS request
  WHERE request.organization_id = job.organization_id
    AND request.project_id = job.project_id
    AND request.environment = job.environment
    AND request.change_set_id = job.change_set_id
    AND request.status = 'approved'
    AND request.created_at <= job.created_at
  ORDER BY request.created_at DESC, request.id DESC
  LIMIT 1
);

ALTER TABLE migration_jobs
  ALTER COLUMN approval_request_id SET NOT NULL,
  ADD CONSTRAINT migration_jobs_approval_scope_fk
    FOREIGN KEY (organization_id, project_id, environment, change_set_id, approval_request_id)
    REFERENCES approval_requests (organization_id, project_id, environment, change_set_id, id)
    ON DELETE RESTRICT;

-- Web/API runtime may enqueue and inspect job status, but only the dedicated
-- worker boundary may advance leases or terminal migration/outbox state.
REVOKE UPDATE ON migration_jobs, migration_outbox FROM qkern_runtime;
REVOKE UPDATE (
  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,
  last_error_code, last_error_message, started_at, finished_at, updated_at
) ON migration_jobs FROM qkern_runtime;
REVOKE UPDATE (
  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,
  published_at, updated_at
) ON migration_outbox FROM qkern_runtime;
GRANT INSERT (approval_request_id) ON migration_jobs TO qkern_runtime;

REVOKE ALL ON migration_jobs, migration_outbox FROM qkern_worker;
REVOKE ALL ON change_sets, approval_requests, audit_logs FROM qkern_worker;

GRANT USAGE ON SCHEMA public TO qkern_worker;
GRANT SELECT ON migration_jobs, migration_outbox, change_sets, approval_requests TO qkern_worker;
GRANT UPDATE (
  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,
  last_error_code, last_error_message, started_at, finished_at, updated_at
) ON migration_jobs TO qkern_worker;
GRANT UPDATE (
  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,
  published_at, updated_at
) ON migration_outbox TO qkern_worker;
GRANT UPDATE (status, updated_at) ON change_sets TO qkern_worker;
GRANT SELECT, INSERT ON audit_logs TO qkern_worker;

GRANT EXECUTE ON FUNCTION qkern_current_organization_id() TO qkern_worker;
GRANT EXECUTE ON FUNCTION qkern_touch_updated_at() TO qkern_worker;
GRANT EXECUTE ON FUNCTION qkern_prepare_audit_log() TO qkern_worker;
GRANT EXECUTE ON FUNCTION qkern_reject_audit_mutation() TO qkern_worker;
GRANT EXECUTE ON FUNCTION qkern_reject_changeset_artifact_mutation() TO qkern_worker;

COMMIT;
