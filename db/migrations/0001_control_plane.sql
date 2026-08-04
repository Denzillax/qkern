CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE qkern_environment AS ENUM ('development', 'staging', 'production');
CREATE TYPE qkern_change_status AS ENUM ('draft', 'validating', 'ready', 'approved', 'applied', 'rejected', 'failed', 'rolled_back');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','administrator','developer','deployer','analyst','support','read_only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  region text NOT NULL,
  status text NOT NULL DEFAULT 'provisioning',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, slug)
);

CREATE INDEX projects_tenant_idx ON projects (organization_id, id) WHERE deleted_at IS NULL;

CREATE TABLE project_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment qkern_environment NOT NULL,
  database_instance_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, environment),
  UNIQUE (organization_id, project_id, id)
);

CREATE TABLE change_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment qkern_environment NOT NULL,
  title text NOT NULL,
  statement_sha256 text NOT NULL,
  encrypted_statement bytea NOT NULL,
  risk text NOT NULL CHECK (risk IN ('low','medium','high','critical')),
  status qkern_change_status NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES users(id),
  agent_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX change_sets_tenant_idx ON change_sets (organization_id, project_id, environment, created_at DESC);

CREATE TABLE approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  change_set_id uuid NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
  environment qkern_environment NOT NULL,
  action_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','expired')) DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_pending_approval_per_action ON approval_requests (organization_id, action_hash) WHERE status = 'pending';

CREATE TABLE approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  decided_by uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_request_id)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  environment qkern_environment,
  actor_type text NOT NULL,
  actor_ref text NOT NULL,
  action text NOT NULL,
  resource_ref text NOT NULL,
  status text NOT NULL,
  redacted_metadata jsonb NOT NULL DEFAULT '{}',
  previous_hash text,
  entry_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_tenant_time_idx ON audit_logs (organization_id, project_id, environment, created_at DESC);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_projects ON projects USING (organization_id = current_setting('qkern.organization_id', true)::uuid);
CREATE POLICY tenant_environments ON project_environments USING (organization_id = current_setting('qkern.organization_id', true)::uuid);
CREATE POLICY tenant_change_sets ON change_sets USING (organization_id = current_setting('qkern.organization_id', true)::uuid);
CREATE POLICY tenant_approvals ON approval_requests USING (organization_id = current_setting('qkern.organization_id', true)::uuid);
CREATE POLICY tenant_audit ON audit_logs USING (organization_id = current_setting('qkern.organization_id', true)::uuid);
