-- PostgreSQL does not permit a newly added enum label to be used before the
-- transaction that added it commits. Keep this statement outside the schema
-- transaction so the review_required state is usable below.
ALTER TYPE qkern_migration_job_status ADD VALUE IF NOT EXISTS 'review_required';

BEGIN;

ALTER TABLE migration_jobs
  DROP CONSTRAINT migration_jobs_state_shape,
  ADD COLUMN reconciliation_required boolean NOT NULL DEFAULT false,
  ADD COLUMN reconciliation_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN max_reconciliation_attempts integer NOT NULL DEFAULT 3,
  ADD CONSTRAINT migration_jobs_reconciliation_attempt_bounds
    CHECK (
      reconciliation_attempt_count BETWEEN 0 AND max_reconciliation_attempts AND
      max_reconciliation_attempts BETWEEN 1 AND 20
    ),
  ADD CONSTRAINT migration_jobs_state_shape
    CHECK (
      (status = 'queued' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND finished_at IS NULL) OR
      (status = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND finished_at IS NULL) OR
      (status IN ('applied', 'failed', 'review_required') AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND finished_at IS NOT NULL)
    ),
  ADD CONSTRAINT migration_jobs_reconciliation_state_shape
    CHECK (
      (NOT reconciliation_required AND reconciliation_attempt_count = 0 AND status <> 'review_required') OR
      (reconciliation_required AND (
        (status = 'queued' AND reconciliation_attempt_count < max_reconciliation_attempts) OR
        (status = 'running' AND reconciliation_attempt_count BETWEEN 1 AND max_reconciliation_attempts) OR
        (status = 'review_required' AND reconciliation_attempt_count = max_reconciliation_attempts)
      ))
    );

-- Only the dedicated worker may enter or advance the reconciliation state
-- machine. Runtime/API callers retain read-only visibility through the
-- existing tenant-scoped SELECT grant.
REVOKE UPDATE (
  reconciliation_required, reconciliation_attempt_count, max_reconciliation_attempts
) ON migration_jobs FROM qkern_runtime;
GRANT UPDATE (
  reconciliation_required, reconciliation_attempt_count
) ON migration_jobs TO qkern_worker;

COMMIT;
