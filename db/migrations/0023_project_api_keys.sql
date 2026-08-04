BEGIN;

CREATE TABLE project_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('public', 'service')),
  token_prefix text NOT NULL CHECK (char_length(token_prefix) BETWEEN 12 AND 32),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT project_api_keys_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT project_api_keys_revocation_after_creation
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX project_api_keys_scope_idx
  ON project_api_keys (organization_id, project_id, environment, created_at DESC);
CREATE INDEX project_api_keys_active_expiry_idx
  ON project_api_keys (expires_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION qkern_reject_project_api_key_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.name IS DISTINCT FROM OLD.name OR
     NEW.kind IS DISTINCT FROM OLD.kind OR
     NEW.token_prefix IS DISTINCT FROM OLD.token_prefix OR
     NEW.token_hash IS DISTINCT FROM OLD.token_hash OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     NEW.created_by IS DISTINCT FROM OLD.created_by OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'project API keys are immutable except for one-way revocation' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_api_keys_immutable
BEFORE UPDATE ON project_api_keys
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_api_key_mutation();

ALTER TABLE project_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_api_keys_select ON project_api_keys
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_api_keys_insert ON project_api_keys
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_api_keys_update ON project_api_keys
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

-- Authenticates a verifier hash before tenant discovery. The SECURITY DEFINER
-- function exposes only the active key binding, never the stored verifier,
-- prefix, creator, name or raw key. Its owner is the migration authority; the
-- unprivileged auth login only receives EXECUTE.
CREATE OR REPLACE FUNCTION qkern_authenticate_project_api_key(p_token_hash text)
RETURNS TABLE (
  key_id uuid,
  organization_id uuid,
  project_id uuid,
  environment qkern_environment,
  kind text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT api_key.id, api_key.organization_id, api_key.project_id,
         api_key.environment, api_key.kind, api_key.expires_at
  FROM public.project_api_keys AS api_key
  WHERE api_key.token_hash = p_token_hash
    AND api_key.revoked_at IS NULL
    AND api_key.expires_at > now()
    AND p_token_hash ~ '^[A-Za-z0-9_-]{43}$'
  LIMIT 1
$$;

REVOKE ALL ON project_api_keys FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_authenticate_project_api_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_api_key_mutation() FROM PUBLIC;

GRANT SELECT, INSERT ON project_api_keys TO qkern_runtime;
GRANT UPDATE (revoked_at) ON project_api_keys TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_project_api_key_mutation() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_authenticate_project_api_key(text) TO qkern_auth;

COMMIT;
