BEGIN;

CREATE OR REPLACE FUNCTION qkern_current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('qkern.organization_id', true), '')::uuid
$$;

-- Composite keys make it impossible to combine a tenant id with another
-- tenant's project, change set or approval id, even if application code fails.
ALTER TABLE projects
  ADD CONSTRAINT projects_organization_id_id_key UNIQUE (organization_id, id);

ALTER TABLE change_sets
  ADD CONSTRAINT change_sets_organization_project_id_key UNIQUE (organization_id, project_id, id),
  ADD CONSTRAINT change_sets_organization_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id)
    ON DELETE CASCADE;

ALTER TABLE project_environments
  ADD CONSTRAINT project_environments_organization_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id)
    ON DELETE CASCADE;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_organization_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT approval_requests_change_set_scope_fk
    FOREIGN KEY (organization_id, project_id, change_set_id)
    REFERENCES change_sets (organization_id, project_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT approval_requests_organization_id_id_key UNIQUE (organization_id, id);

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_organization_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects (organization_id, id)
    ON DELETE RESTRICT;

ALTER TABLE approval_decisions ADD COLUMN organization_id uuid;

UPDATE approval_decisions AS decision
SET organization_id = request.organization_id
FROM approval_requests AS request
WHERE request.id = decision.approval_request_id;

ALTER TABLE approval_decisions
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT approval_decisions_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES organizations (id)
    ON DELETE CASCADE,
  ADD CONSTRAINT approval_decisions_request_scope_fk
    FOREIGN KEY (organization_id, approval_request_id)
    REFERENCES approval_requests (organization_id, id)
    ON DELETE CASCADE;

CREATE INDEX approval_decisions_tenant_idx
  ON approval_decisions (organization_id, approval_request_id);

CREATE INDEX audit_logs_chain_idx
  ON audit_logs (organization_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION qkern_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_touch_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

CREATE TRIGGER projects_touch_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

CREATE TRIGGER change_sets_touch_updated_at
BEFORE UPDATE ON change_sets
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

CREATE OR REPLACE FUNCTION qkern_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION qkern_prepare_audit_log()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Serialize the hash chain per organization, including inserts that do not
  -- pass through the TypeScript repository.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 0));

  SELECT entry_hash
  INTO NEW.previous_hash
  FROM audit_logs
  WHERE organization_id = NEW.organization_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.redacted_metadata = coalesce(NEW.redacted_metadata, '{}'::jsonb);
  NEW.entry_hash = encode(
    digest(
      jsonb_build_object(
        'id', NEW.id,
        'organization_id', NEW.organization_id,
        'project_id', NEW.project_id,
        'environment', NEW.environment,
        'actor_type', NEW.actor_type,
        'actor_ref', NEW.actor_ref,
        'action', NEW.action,
        'resource_ref', NEW.resource_ref,
        'status', NEW.status,
        'redacted_metadata', NEW.redacted_metadata,
        'previous_hash', NEW.previous_hash,
        'created_at', NEW.created_at
      )::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_logs_prepare_insert
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION qkern_prepare_audit_log();

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION qkern_reject_audit_mutation();

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE project_environments FORCE ROW LEVEL SECURITY;
ALTER TABLE change_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE approval_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE approval_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_projects ON projects;
DROP POLICY IF EXISTS tenant_environments ON project_environments;
DROP POLICY IF EXISTS tenant_change_sets ON change_sets;
DROP POLICY IF EXISTS tenant_approvals ON approval_requests;
DROP POLICY IF EXISTS tenant_audit ON audit_logs;

CREATE POLICY organizations_select ON organizations
  FOR SELECT USING (id = qkern_current_organization_id());
CREATE POLICY organizations_insert ON organizations
  FOR INSERT WITH CHECK (id = qkern_current_organization_id());
CREATE POLICY organizations_update ON organizations
  FOR UPDATE
  USING (id = qkern_current_organization_id())
  WITH CHECK (id = qkern_current_organization_id());

CREATE POLICY organization_members_select ON organization_members
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY organization_members_insert ON organization_members
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY organization_members_update ON organization_members
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY organization_members_delete ON organization_members
  FOR DELETE USING (organization_id = qkern_current_organization_id());

CREATE POLICY projects_select ON projects
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY projects_update ON projects
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

CREATE POLICY project_environments_select ON project_environments
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_environments_insert ON project_environments
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_environments_update ON project_environments
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_environments_delete ON project_environments
  FOR DELETE USING (organization_id = qkern_current_organization_id());

CREATE POLICY change_sets_select ON change_sets
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY change_sets_insert ON change_sets
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY change_sets_update ON change_sets
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

CREATE POLICY approval_requests_select ON approval_requests
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY approval_requests_insert ON approval_requests
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY approval_requests_update ON approval_requests
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

CREATE POLICY approval_decisions_select ON approval_decisions
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY approval_decisions_insert ON approval_decisions
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

-- A deployment can grant LOGIN to a dedicated role that inherits this one;
-- no credential is created by the migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qkern_runtime') THEN
    CREATE ROLE qkern_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

REVOKE ALL ON organizations, organization_members, projects, project_environments,
  change_sets, approval_requests, approval_decisions, audit_logs FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO qkern_runtime;
GRANT SELECT, INSERT, UPDATE ON organizations TO qkern_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_members TO qkern_runtime;
GRANT SELECT, INSERT, UPDATE ON projects TO qkern_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_environments TO qkern_runtime;
GRANT SELECT, INSERT, UPDATE ON change_sets TO qkern_runtime;
GRANT SELECT, INSERT, UPDATE ON approval_requests TO qkern_runtime;
GRANT SELECT, INSERT ON approval_decisions TO qkern_runtime;
GRANT SELECT, INSERT ON audit_logs TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_current_organization_id() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_touch_updated_at() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_prepare_audit_log() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_audit_mutation() TO qkern_runtime;

COMMIT;
