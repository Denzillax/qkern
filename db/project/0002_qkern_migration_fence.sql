-- Run once after 0001_qkern_migration_ledger.sql as the trusted project
-- database provisioner. This object is deliberately outside customer schemas.
BEGIN;

CREATE TABLE qkern_internal.migration_fences (
  job_id uuid PRIMARY KEY,
  fence_epoch bigint NOT NULL CHECK (fence_epoch > 0),
  lease_token uuid NOT NULL,
  statement_sha256 text NOT NULL CHECK (statement_sha256 ~ '^[a-f0-9]{64}$'),
  fenced_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE qkern_internal.migration_fences OWNER TO qkern_ledger_owner;
REVOKE ALL ON qkern_internal.migration_fences FROM PUBLIC, qkern_project_migrator;
GRANT SELECT, INSERT ON qkern_internal.migration_fences TO qkern_project_migrator;
GRANT UPDATE (fence_epoch, lease_token, statement_sha256, fenced_at)
  ON qkern_internal.migration_fences TO qkern_project_migrator;

COMMIT;
