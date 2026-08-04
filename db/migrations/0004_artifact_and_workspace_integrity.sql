BEGIN;

ALTER TABLE organization_members
  ADD COLUMN is_personal_workspace boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX one_personal_workspace_per_user
  ON organization_members (user_id)
  WHERE is_personal_workspace;

ALTER TABLE project_environments
  ADD CONSTRAINT project_environments_scope_key
    UNIQUE (organization_id, project_id, environment);

ALTER TABLE change_sets
  ADD CONSTRAINT change_sets_environment_scope_key
    UNIQUE (organization_id, project_id, environment, id),
  ADD CONSTRAINT change_sets_project_environment_fk
    FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_change_set_environment_fk
    FOREIGN KEY (organization_id, project_id, environment, change_set_id)
    REFERENCES change_sets (organization_id, project_id, environment, id)
    ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION qkern_reject_changeset_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.project_id IS DISTINCT FROM OLD.project_id OR
    NEW.environment IS DISTINCT FROM OLD.environment OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.statement_sha256 IS DISTINCT FROM OLD.statement_sha256 OR
    NEW.encrypted_statement IS DISTINCT FROM OLD.encrypted_statement OR
    NEW.risk IS DISTINCT FROM OLD.risk OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.agent_session_id IS DISTINCT FROM OLD.agent_session_id
  ) THEN
    RAISE EXCEPTION 'change set artifact is immutable after preview creation' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER change_sets_artifact_immutable
BEFORE UPDATE ON change_sets
FOR EACH ROW EXECUTE FUNCTION qkern_reject_changeset_artifact_mutation();

CREATE OR REPLACE FUNCTION qkern_reject_session_unrevoke()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'session revocation is irreversible' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_sessions_revocation_monotonic
BEFORE UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION qkern_reject_session_unrevoke();

REVOKE UPDATE ON change_sets FROM qkern_runtime;
GRANT UPDATE (status, updated_at) ON change_sets TO qkern_runtime;
REVOKE UPDATE ON approval_requests FROM qkern_runtime;
GRANT UPDATE (status) ON approval_requests TO qkern_runtime;

GRANT EXECUTE ON FUNCTION qkern_reject_changeset_artifact_mutation() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_session_unrevoke() TO qkern_auth;

COMMIT;
