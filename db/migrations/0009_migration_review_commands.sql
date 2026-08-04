BEGIN;

CREATE TYPE qkern_migration_review_command_status AS ENUM ('pending', 'applied', 'rejected');

ALTER TABLE migration_jobs
  ADD COLUMN review_cycle_count integer NOT NULL DEFAULT 0,
  ADD COLUMN max_review_cycles integer NOT NULL DEFAULT 3,
  ADD CONSTRAINT migration_jobs_review_cycle_bounds
    CHECK (review_cycle_count BETWEEN 0 AND max_review_cycles AND max_review_cycles BETWEEN 1 AND 10);

-- The web runtime may request only a read-only ledger recheck. It still cannot
-- mutate migration_jobs; the dedicated worker consumes this reference-only
-- command and performs the exact bounded transition.
CREATE TABLE migration_review_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  migration_job_id uuid NOT NULL,
  requested_by text NOT NULL CHECK (char_length(requested_by) BETWEEN 1 AND 200),
  reason_code text NOT NULL CHECK (reason_code IN ('dependency_recovered', 'manual_recheck', 'incident_recovery')),
  status qkern_migration_review_command_status NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_review_commands_job_scope_fk
    FOREIGN KEY (organization_id, migration_job_id)
    REFERENCES migration_jobs (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT migration_review_commands_scope_key UNIQUE (organization_id, id),
  CONSTRAINT migration_review_commands_state_shape CHECK (
    (status = 'pending' AND processed_at IS NULL) OR
    (status IN ('applied', 'rejected') AND processed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX migration_review_commands_one_pending_job
  ON migration_review_commands (organization_id, migration_job_id)
  WHERE status = 'pending';

CREATE INDEX migration_review_commands_worker_claim_idx
  ON migration_review_commands (organization_id, created_at, id)
  WHERE status = 'pending';

CREATE TRIGGER migration_review_commands_touch_updated_at
BEFORE UPDATE ON migration_review_commands
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

ALTER TABLE migration_review_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_review_commands FORCE ROW LEVEL SECURITY;

CREATE POLICY migration_review_commands_select ON migration_review_commands
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY migration_review_commands_insert ON migration_review_commands
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY migration_review_commands_update ON migration_review_commands
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON migration_review_commands FROM PUBLIC, qkern_runtime, qkern_worker;

GRANT SELECT ON migration_review_commands TO qkern_runtime;
GRANT INSERT (organization_id, migration_job_id, requested_by, reason_code)
  ON migration_review_commands TO qkern_runtime;

GRANT SELECT ON migration_review_commands TO qkern_worker;
GRANT UPDATE (status, processed_at, updated_at)
  ON migration_review_commands TO qkern_worker;

REVOKE UPDATE (review_cycle_count, max_review_cycles) ON migration_jobs FROM qkern_runtime;
GRANT UPDATE (review_cycle_count) ON migration_jobs TO qkern_worker;

COMMIT;
