-- Run once in each provisioned project database as a trusted provisioning
-- administrator. The application migration login must already exist as
-- qkern_project_migrator and must not be a member of qkern_ledger_owner.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'qkern_ledger_owner' AND rolcanlogin = false
      AND rolsuper = false AND rolcreatedb = false AND rolcreaterole = false
      AND rolreplication = false AND rolbypassrls = false
  ) THEN
    RAISE EXCEPTION 'qkern_ledger_owner must be a non-login, unprivileged owner role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'qkern_project_migrator' AND rolcanlogin = true
      AND rolsuper = false AND rolcreatedb = false AND rolcreaterole = false
      AND rolreplication = false AND rolbypassrls = false
  ) THEN
    RAISE EXCEPTION 'qkern_project_migrator must be an unprivileged login role';
  END IF;
  IF pg_has_role('qkern_project_migrator', 'qkern_ledger_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'the migration role must not inherit the ledger owner role';
  END IF;
END;
$$;

CREATE SCHEMA qkern_internal AUTHORIZATION qkern_ledger_owner;
REVOKE ALL ON SCHEMA qkern_internal FROM PUBLIC;
REVOKE CREATE ON SCHEMA qkern_internal FROM qkern_project_migrator;
GRANT USAGE ON SCHEMA qkern_internal TO qkern_project_migrator;

CREATE TABLE qkern_internal.migration_ledger (
  change_set_id uuid PRIMARY KEY,
  statement_sha256 text NOT NULL CHECK (statement_sha256 ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qkern_internal.migration_ledger OWNER TO qkern_ledger_owner;
REVOKE ALL ON qkern_internal.migration_ledger FROM PUBLIC, qkern_project_migrator;
GRANT SELECT, INSERT ON qkern_internal.migration_ledger TO qkern_project_migrator;

COMMIT;
