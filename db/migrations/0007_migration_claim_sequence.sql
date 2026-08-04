BEGIN;

-- attempt_count is bounded retry policy and can repeat on final reclaims. A
-- separate, strictly increasing int8 generation is therefore required for
-- target-side stale-worker fencing.
ALTER TABLE migration_jobs
  ADD COLUMN claim_sequence bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT migration_jobs_claim_sequence_bounds
    CHECK (claim_sequence BETWEEN 0 AND 9223372036854775807);

REVOKE UPDATE (claim_sequence) ON migration_jobs FROM qkern_runtime;
GRANT UPDATE (claim_sequence) ON migration_jobs TO qkern_worker;

COMMIT;
