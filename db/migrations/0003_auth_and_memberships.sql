BEGIN;

-- Authentication data is deliberately global: a session must be resolved
-- before an organization can be selected. Access is therefore isolated in a
-- dedicated role rather than exposed to the tenant-scoped runtime role.
ALTER TABLE users
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled'));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_email_key;

UPDATE users
SET email = lower(btrim(email));

ALTER TABLE users
  ADD CONSTRAINT users_email_is_canonical
    CHECK (
      email = lower(btrim(email))
      AND char_length(email) BETWEEN 3 AND 320
      AND position('@' IN email) > 1
    );

CREATE UNIQUE INDEX users_canonical_email_unique
  ON users ((lower(btrim(email))))
  WHERE deleted_at IS NULL;

CREATE TRIGGER users_touch_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- AuthService uses base64url(SHA-256(token)); the bearer token itself is
  -- never persisted and cannot be recovered from this verifier.
  token_hash text NOT NULL UNIQUE
    CHECK (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT auth_sessions_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT auth_sessions_revocation_after_creation
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX auth_sessions_active_user_idx
  ON auth_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX auth_sessions_expiry_idx
  ON auth_sessions (expires_at);

-- Membership discovery is needed immediately after authentication, before a
-- tenant-scoped transaction exists. The definer function returns only rows
-- for the authenticated user id supplied by the auth service and exposes no
-- organization membership table privileges to the auth role.
CREATE OR REPLACE FUNCTION qkern_memberships_for_user(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  membership_user_id uuid,
  membership_role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT organization.id,
         organization.name,
         organization.slug,
         member.user_id,
         member.role
  FROM public.organization_members AS member
  JOIN public.organizations AS organization
    ON organization.id = member.organization_id
  WHERE member.user_id = p_user_id
    AND organization.deleted_at IS NULL
  ORDER BY member.created_at ASC, organization.id ASC
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qkern_auth') THEN
    CREATE ROLE qkern_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

REVOKE ALL ON users, auth_sessions FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_memberships_for_user(uuid) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO qkern_auth;
GRANT SELECT (id, email, password_hash, status, created_at, updated_at, deleted_at),
      INSERT (id, email, password_hash, status, created_at, updated_at)
  ON users TO qkern_auth;
GRANT SELECT (id, user_id, token_hash, created_at, expires_at, revoked_at),
      INSERT (id, user_id, token_hash, created_at, expires_at, revoked_at),
      UPDATE (revoked_at)
  ON auth_sessions TO qkern_auth;
GRANT EXECUTE ON FUNCTION qkern_memberships_for_user(uuid) TO qkern_auth;

COMMIT;
