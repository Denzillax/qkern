BEGIN;

-- Project Auth identities are application end users. They deliberately do not
-- reference public.users, which contains QKERN Control Plane operators.
CREATE TABLE project_auth_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  email text NOT NULL,
  password_hash text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  email_verified_at timestamptz,
  user_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT project_auth_users_email_canonical CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320 AND position('@' IN email) > 1
  ),
  CONSTRAINT project_auth_users_metadata_objects CHECK (
    jsonb_typeof(user_metadata) = 'object' AND jsonb_typeof(app_metadata) = 'object'
    AND octet_length(user_metadata::text) <= 4096 AND octet_length(app_metadata::text) <= 4096
  ),
  CONSTRAINT project_auth_users_scope_id_key
    UNIQUE (organization_id, project_id, environment, id),
  CONSTRAINT project_auth_users_scope_email_key
    UNIQUE (organization_id, project_id, environment, email)
);

CREATE INDEX project_auth_users_scope_created_idx
  ON project_auth_users (organization_id, project_id, environment, created_at DESC, id DESC);

CREATE TABLE project_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  auth_user_id uuid NOT NULL,
  family_id uuid NOT NULL,
  refresh_token_hash text NOT NULL UNIQUE CHECK (refresh_token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  assurance text NOT NULL CHECK (assurance IN ('aal1', 'aal2')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_session_id uuid REFERENCES project_auth_sessions(id) DEFERRABLE INITIALLY DEFERRED,
  compromised_at timestamptz,
  FOREIGN KEY (organization_id, project_id, environment, auth_user_id)
    REFERENCES project_auth_users (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT project_auth_sessions_expiry CHECK (expires_at > created_at),
  CONSTRAINT project_auth_sessions_revocation CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT project_auth_sessions_compromise CHECK (compromised_at IS NULL OR compromised_at >= created_at),
  CONSTRAINT project_auth_sessions_scope_id_key
    UNIQUE (organization_id, project_id, environment, id)
);

CREATE INDEX project_auth_sessions_active_user_idx
  ON project_auth_sessions (organization_id, project_id, environment, auth_user_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX project_auth_sessions_family_idx
  ON project_auth_sessions (organization_id, project_id, environment, family_id);

CREATE TABLE project_auth_one_time_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  auth_user_id uuid,
  purpose text NOT NULL CHECK (purpose IN (
    'email_verification', 'magic_link', 'password_reset', 'oidc_state', 'mfa_challenge'
  )),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (organization_id, project_id, environment, auth_user_id)
    REFERENCES project_auth_users (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT project_auth_one_time_tokens_expiry CHECK (expires_at > created_at),
  CONSTRAINT project_auth_one_time_tokens_consumption CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT project_auth_one_time_tokens_metadata CHECK (
    jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192
  )
);

CREATE INDEX project_auth_one_time_tokens_active_idx
  ON project_auth_one_time_tokens (organization_id, project_id, environment, purpose, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE project_auth_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  auth_user_id uuid NOT NULL,
  encrypted_secret text NOT NULL CHECK (char_length(encrypted_secret) BETWEEN 40 AND 2048),
  recovery_code_hashes jsonb NOT NULL CHECK (
    jsonb_typeof(recovery_code_hashes) = 'array' AND jsonb_array_length(recovery_code_hashes) <= 12
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  FOREIGN KEY (organization_id, project_id, environment, auth_user_id)
    REFERENCES project_auth_users (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT project_auth_mfa_factors_one_per_user
    UNIQUE (organization_id, project_id, environment, auth_user_id)
);

CREATE TABLE project_auth_oidc_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  auth_user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,62}$'),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment, auth_user_id)
    REFERENCES project_auth_users (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT project_auth_oidc_identity_key
    UNIQUE (organization_id, project_id, environment, provider, subject)
);

CREATE OR REPLACE FUNCTION qkern_reject_project_auth_scope_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'project auth scope is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_auth_users_scope_immutable
BEFORE UPDATE ON project_auth_users
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_scope_mutation();
CREATE TRIGGER project_auth_sessions_scope_immutable
BEFORE UPDATE ON project_auth_sessions
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_scope_mutation();
CREATE TRIGGER project_auth_one_time_tokens_scope_immutable
BEFORE UPDATE ON project_auth_one_time_tokens
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_scope_mutation();
CREATE TRIGGER project_auth_mfa_factors_scope_immutable
BEFORE UPDATE ON project_auth_mfa_factors
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_scope_mutation();
CREATE TRIGGER project_auth_oidc_identities_scope_immutable
BEFORE UPDATE ON project_auth_oidc_identities
FOR EACH ROW EXECUTE FUNCTION qkern_reject_project_auth_scope_mutation();

REVOKE ALL ON project_auth_users, project_auth_sessions, project_auth_one_time_tokens,
  project_auth_mfa_factors, project_auth_oidc_identities FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_auth_scope_mutation() FROM PUBLIC;

-- The auth boundary must resolve credentials before an organization can be
-- discovered. It receives explicit columns only; every repository query also
-- requires the exact organization/project/environment tuple.
GRANT SELECT, INSERT ON project_auth_users TO qkern_auth;
GRANT UPDATE (password_hash, status, email_verified_at, user_metadata, app_metadata, updated_at)
  ON project_auth_users TO qkern_auth;
GRANT SELECT, INSERT ON project_auth_sessions TO qkern_auth;
GRANT UPDATE (revoked_at, replaced_by_session_id, compromised_at)
  ON project_auth_sessions TO qkern_auth;
GRANT SELECT, INSERT ON project_auth_one_time_tokens TO qkern_auth;
GRANT UPDATE (consumed_at) ON project_auth_one_time_tokens TO qkern_auth;
GRANT SELECT, INSERT, UPDATE (encrypted_secret, recovery_code_hashes, verified_at)
  ON project_auth_mfa_factors TO qkern_auth;
GRANT SELECT, INSERT, UPDATE (last_sign_in_at) ON project_auth_oidc_identities TO qkern_auth;
GRANT EXECUTE ON FUNCTION qkern_reject_project_auth_scope_mutation() TO qkern_auth;

COMMIT;
