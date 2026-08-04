BEGIN;

CREATE TABLE project_storage_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  read_policy text NOT NULL DEFAULT 'private'
    CHECK (read_policy IN ('private', 'authenticated', 'owner', 'public', 'service')),
  write_policy text NOT NULL DEFAULT 'private'
    CHECK (write_policy IN ('private', 'authenticated', 'owner', 'service')),
  allowed_mime_types text[] NOT NULL,
  max_object_bytes bigint NOT NULL CHECK (max_object_bytes BETWEEN 1 AND 5368709120),
  quota_bytes bigint NOT NULL CHECK (quota_bytes BETWEEN 1 AND 5497558138880),
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  retention_days integer CHECK (retention_days BETWEEN 1 AND 3650),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT project_storage_buckets_scope_id_key
    UNIQUE (organization_id, project_id, environment, id),
  CONSTRAINT project_storage_buckets_scope_name_key
    UNIQUE (organization_id, project_id, environment, name),
  CONSTRAINT project_storage_buckets_mime_allowlist CHECK (
    cardinality(allowed_mime_types) BETWEEN 1 AND 20 AND
    array_position(allowed_mime_types, NULL) IS NULL
  ),
  CONSTRAINT project_storage_buckets_size_policy CHECK (
    max_object_bytes <= quota_bytes AND used_bytes + reserved_bytes <= quota_bytes
  )
);

CREATE INDEX project_storage_buckets_scope_idx
  ON project_storage_buckets (organization_id, project_id, environment, name);

CREATE TABLE project_storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  bucket_id uuid NOT NULL,
  object_key text NOT NULL CHECK (
    char_length(object_key) BETWEEN 1 AND 1024 AND
    position(chr(92) IN object_key) = 0 AND position(chr(13) IN object_key) = 0 AND
    position(chr(10) IN object_key) = 0
  ),
  owner_subject text CHECK (owner_subject IS NULL OR char_length(owner_subject) BETWEEN 1 AND 320),
  provider_key text NOT NULL CHECK (char_length(provider_key) BETWEEN 1 AND 2048),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5368709120),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 3 AND 192),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  etag text CHECK (etag IS NULL OR char_length(etag) BETWEEN 1 AND 256),
  status text NOT NULL CHECK (status IN ('quarantined', 'clean', 'infected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz,
  deleted_at timestamptz,
  FOREIGN KEY (organization_id, project_id, environment, bucket_id)
    REFERENCES project_storage_buckets (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT project_storage_objects_scope_id_key
    UNIQUE (organization_id, project_id, environment, id),
  CONSTRAINT project_storage_objects_provider_key_key UNIQUE (provider_key),
  CONSTRAINT project_storage_objects_delete_time CHECK (
    delete_after IS NULL OR delete_after > created_at
  ),
  CONSTRAINT project_storage_objects_deleted_time CHECK (
    deleted_at IS NULL OR deleted_at >= created_at
  )
);

CREATE UNIQUE INDEX project_storage_objects_active_key
  ON project_storage_objects (organization_id, project_id, environment, bucket_id, object_key)
  WHERE deleted_at IS NULL;
CREATE INDEX project_storage_objects_listing_idx
  ON project_storage_objects (organization_id, project_id, environment, bucket_id, object_key)
  WHERE deleted_at IS NULL;
CREATE INDEX project_storage_objects_lifecycle_idx
  ON project_storage_objects (organization_id, project_id, environment, delete_after, id)
  WHERE deleted_at IS NULL AND delete_after IS NOT NULL;

CREATE TABLE project_storage_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  bucket_id uuid NOT NULL,
  object_key text NOT NULL CHECK (
    char_length(object_key) BETWEEN 1 AND 1024 AND
    position(chr(92) IN object_key) = 0 AND position(chr(13) IN object_key) = 0 AND
    position(chr(10) IN object_key) = 0
  ),
  provider_key text NOT NULL CHECK (char_length(provider_key) BETWEEN 1 AND 2048),
  owner_subject text NOT NULL CHECK (char_length(owner_subject) BETWEEN 1 AND 320),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 3 AND 192),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5368709120),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  completion_token_hash text NOT NULL UNIQUE
    CHECK (completion_token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  object_id uuid,
  FOREIGN KEY (organization_id, project_id, environment, bucket_id)
    REFERENCES project_storage_buckets (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, environment, object_id)
    REFERENCES project_storage_objects (organization_id, project_id, environment, id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT project_storage_uploads_scope_id_key
    UNIQUE (organization_id, project_id, environment, id),
  CONSTRAINT project_storage_uploads_provider_key_key UNIQUE (provider_key),
  CONSTRAINT project_storage_uploads_expiry CHECK (expires_at > created_at),
  CONSTRAINT project_storage_uploads_completion CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND object_id IS NOT NULL) OR
    (status <> 'completed' AND completed_at IS NULL AND object_id IS NULL)
  )
);

CREATE UNIQUE INDEX project_storage_uploads_pending_key
  ON project_storage_uploads (organization_id, project_id, environment, bucket_id, object_key)
  WHERE status = 'pending';
CREATE INDEX project_storage_uploads_expiry_idx
  ON project_storage_uploads (organization_id, project_id, environment, bucket_id, expires_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION qkern_reject_project_storage_bucket_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.id IS DISTINCT FROM OLD.id OR NEW.name IS DISTINCT FROM OLD.name OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'project storage bucket identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION qkern_reject_project_storage_upload_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR NEW.id IS DISTINCT FROM OLD.id OR
     NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR
     NEW.provider_key IS DISTINCT FROM OLD.provider_key OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject OR
     NEW.content_type IS DISTINCT FROM OLD.content_type OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR
     NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256 OR
     NEW.completion_token_hash IS DISTINCT FROM OLD.completion_token_hash OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'project storage upload verifier and identity are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION qkern_reject_project_storage_object_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR NEW.id IS DISTINCT FROM OLD.id OR
     NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR
     NEW.provider_key IS DISTINCT FROM OLD.provider_key OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject OR
     NEW.content_type IS DISTINCT FROM OLD.content_type OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR
     NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256 OR NEW.etag IS DISTINCT FROM OLD.etag OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.delete_after IS DISTINCT FROM OLD.delete_after OR
     OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'project storage object identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_storage_buckets_identity_immutable
  BEFORE UPDATE ON project_storage_buckets FOR EACH ROW
  EXECUTE FUNCTION qkern_reject_project_storage_bucket_identity_mutation();
CREATE TRIGGER project_storage_uploads_immutable
  BEFORE UPDATE ON project_storage_uploads FOR EACH ROW
  EXECUTE FUNCTION qkern_reject_project_storage_upload_mutation();
CREATE TRIGGER project_storage_objects_immutable
  BEFORE UPDATE ON project_storage_objects FOR EACH ROW
  EXECUTE FUNCTION qkern_reject_project_storage_object_mutation();

ALTER TABLE project_storage_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_storage_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_storage_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_storage_buckets_select ON project_storage_buckets
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_buckets_insert ON project_storage_buckets
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_buckets_update ON project_storage_buckets
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_buckets_delete ON project_storage_buckets
  FOR DELETE USING (organization_id = qkern_current_organization_id());

CREATE POLICY project_storage_uploads_select ON project_storage_uploads
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_uploads_insert ON project_storage_uploads
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_uploads_update ON project_storage_uploads
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

CREATE POLICY project_storage_objects_select ON project_storage_objects
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_objects_insert ON project_storage_objects
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_storage_objects_update ON project_storage_objects
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_storage_buckets, project_storage_uploads, project_storage_objects FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_storage_bucket_identity_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_storage_upload_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_storage_object_mutation() FROM PUBLIC;

GRANT SELECT, INSERT, DELETE ON project_storage_buckets TO qkern_runtime;
GRANT UPDATE (read_policy, write_policy, allowed_mime_types, max_object_bytes, quota_bytes,
  used_bytes, reserved_bytes, retention_days, updated_at) ON project_storage_buckets TO qkern_runtime;
GRANT SELECT, INSERT ON project_storage_uploads TO qkern_runtime;
GRANT UPDATE (status, completed_at, object_id) ON project_storage_uploads TO qkern_runtime;
GRANT SELECT, INSERT ON project_storage_objects TO qkern_runtime;
GRANT UPDATE (status, deleted_at) ON project_storage_objects TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_project_storage_bucket_identity_mutation() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_project_storage_upload_mutation() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_project_storage_object_mutation() TO qkern_runtime;

COMMIT;
