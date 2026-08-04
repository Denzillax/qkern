BEGIN;

CREATE TABLE project_automation_policies (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  mode text NOT NULL DEFAULT 'manual'
    CHECK (mode IN ('manual', 'guarded', 'autonomous')),
  max_auto_risk text NOT NULL DEFAULT 'low'
    CHECK (max_auto_risk IN ('low', 'medium', 'high', 'critical')),
  auto_queue boolean NOT NULL DEFAULT false,
  emergency_stop boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, environment),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE
);

ALTER TABLE approval_decisions
  ALTER COLUMN decided_by DROP NOT NULL,
  ADD COLUMN actor_type text NOT NULL DEFAULT 'user'
    CHECK (actor_type IN ('user', 'agent', 'system')),
  ADD COLUMN actor_ref text;

UPDATE approval_decisions
SET actor_ref = decided_by::text
WHERE actor_ref IS NULL;

ALTER TABLE approval_decisions
  ALTER COLUMN actor_ref SET NOT NULL,
  ADD CONSTRAINT approval_decisions_actor_binding
    CHECK (
      (actor_type = 'user' AND decided_by IS NOT NULL) OR
      (actor_type IN ('agent', 'system') AND decided_by IS NULL)
    );

ALTER TABLE project_automation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_automation_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY project_automation_policies_select ON project_automation_policies
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_automation_policies_insert ON project_automation_policies
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_automation_policies_update ON project_automation_policies
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_automation_policies FROM PUBLIC;
GRANT SELECT, INSERT ON project_automation_policies TO qkern_runtime;
GRANT UPDATE (mode, max_auto_risk, auto_queue, emergency_stop, revision, updated_by, updated_at)
  ON project_automation_policies TO qkern_runtime;

COMMIT;
