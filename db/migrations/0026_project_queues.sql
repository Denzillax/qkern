BEGIN;

CREATE TABLE project_queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{2,62}$'),
  enqueue_policy text NOT NULL DEFAULT 'authenticated'
    CHECK (enqueue_policy IN ('authenticated', 'service')),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  visibility_timeout_seconds integer NOT NULL DEFAULT 30
    CHECK (visibility_timeout_seconds BETWEEN 5 AND 900),
  retry_base_seconds integer NOT NULL DEFAULT 5 CHECK (retry_base_seconds BETWEEN 1 AND 300),
  retry_max_seconds integer NOT NULL DEFAULT 300 CHECK (retry_max_seconds BETWEEN 1 AND 3600),
  dedupe_window_seconds integer NOT NULL DEFAULT 300 CHECK (dedupe_window_seconds BETWEEN 0 AND 86400),
  retention_seconds integer NOT NULL DEFAULT 86400 CHECK (retention_seconds BETWEEN 60 AND 604800),
  max_pending_messages integer NOT NULL DEFAULT 1000 CHECK (max_pending_messages BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT project_queues_scope_id_key
    UNIQUE (organization_id, project_id, environment, id),
  CONSTRAINT project_queues_scope_name_key
    UNIQUE (organization_id, project_id, environment, name),
  CONSTRAINT project_queues_retry_order CHECK (retry_max_seconds >= retry_base_seconds)
);

CREATE INDEX project_queues_scope_idx
  ON project_queues (organization_id, project_id, environment, name);

CREATE TABLE project_queue_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  queue_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 262144),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'in_flight', 'completed', 'dead_lettered')),
  owner_subject text NOT NULL CHECK (char_length(owner_subject) BETWEEN 1 AND 320),
  dedupe_key_hash text CHECK (dedupe_key_hash IS NULL OR dedupe_key_hash ~ '^[0-9a-f]{64}$'),
  dedupe_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_worker_id text CHECK (
    lease_worker_id IS NULL OR lease_worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  lease_token_hash text CHECK (lease_token_hash IS NULL OR lease_token_hash ~ '^[0-9a-f]{64}$'),
  lease_sequence integer NOT NULL DEFAULT 0 CHECK (lease_sequence BETWEEN 0 AND 2147483647),
  lease_expires_at timestamptz,
  last_failure_code text CHECK (last_failure_code IS NULL OR last_failure_code IN (
    'HANDLER_ERROR', 'HANDLER_TIMEOUT', 'DEPENDENCY_UNAVAILABLE', 'INVALID_PAYLOAD', 'LEASE_EXPIRED'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  FOREIGN KEY (organization_id, project_id, environment, queue_id)
    REFERENCES project_queues (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT project_queue_messages_scope_id_key
    UNIQUE (organization_id, project_id, environment, id),
  CONSTRAINT project_queue_messages_schedule CHECK (available_at >= created_at),
  CONSTRAINT project_queue_messages_dedupe_pair CHECK (
    (dedupe_key_hash IS NULL AND dedupe_expires_at IS NULL) OR
    (dedupe_key_hash IS NOT NULL AND dedupe_expires_at IS NOT NULL AND dedupe_expires_at > created_at)
  ),
  CONSTRAINT project_queue_messages_claim_generation CHECK (attempt_count = lease_sequence),
  CONSTRAINT project_queue_messages_lease_shape CHECK (
    (status = 'in_flight' AND lease_worker_id IS NOT NULL AND lease_token_hash IS NOT NULL
      AND lease_expires_at IS NOT NULL) OR
    (status <> 'in_flight' AND lease_worker_id IS NULL AND lease_token_hash IS NULL
      AND lease_expires_at IS NULL)
  ),
  CONSTRAINT project_queue_messages_terminal_shape CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND dead_lettered_at IS NULL) OR
    (status = 'dead_lettered' AND dead_lettered_at IS NOT NULL AND completed_at IS NULL) OR
    (status IN ('available', 'in_flight') AND completed_at IS NULL AND dead_lettered_at IS NULL)
  )
);

CREATE UNIQUE INDEX project_queue_messages_active_dedupe_key
  ON project_queue_messages (organization_id, project_id, environment, queue_id, dedupe_key_hash)
  WHERE dedupe_key_hash IS NOT NULL;
CREATE INDEX project_queue_messages_claim_idx
  ON project_queue_messages (organization_id, project_id, environment, queue_id, available_at, created_at, id)
  WHERE status = 'available';
CREATE INDEX project_queue_messages_lease_expiry_idx
  ON project_queue_messages (organization_id, project_id, environment, queue_id, lease_expires_at, id)
  WHERE status = 'in_flight';
CREATE INDEX project_queue_messages_completed_cleanup_idx
  ON project_queue_messages (organization_id, project_id, environment, queue_id, completed_at, id)
  WHERE status = 'completed';
CREATE INDEX project_queue_messages_status_idx
  ON project_queue_messages (organization_id, project_id, environment, queue_id, status);

CREATE OR REPLACE FUNCTION qkern_reject_project_queue_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project queue definitions are immutable in this release' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION qkern_validate_project_queue_message_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.id IS DISTINCT FROM OLD.id OR NEW.queue_id IS DISTINCT FROM OLD.queue_id OR
     NEW.payload IS DISTINCT FROM OLD.payload OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'project queue message identity and payload are immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.dedupe_key_hash IS DISTINCT FROM OLD.dedupe_key_hash OR
     NEW.dedupe_expires_at IS DISTINCT FROM OLD.dedupe_expires_at THEN
    IF NOT (OLD.dedupe_key_hash IS NOT NULL AND NEW.dedupe_key_hash IS NULL AND
            NEW.dedupe_expires_at IS NULL AND OLD.dedupe_expires_at <= clock_timestamp()) THEN
      RAISE EXCEPTION 'project queue dedupe verifier is immutable until expiry' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.attempt_count < OLD.attempt_count OR NEW.lease_sequence < OLD.lease_sequence OR
     NEW.attempt_count <> NEW.lease_sequence OR
     NEW.attempt_count > OLD.attempt_count + 1 OR NEW.lease_sequence > OLD.lease_sequence + 1 THEN
    RAISE EXCEPTION 'project queue claim generation is invalid' USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'available' AND NEW.status IN ('available', 'in_flight')) OR
    (OLD.status = 'in_flight' AND NEW.status IN ('in_flight', 'available', 'completed', 'dead_lettered')) OR
    (OLD.status = 'completed' AND NEW.status = 'completed') OR
    (OLD.status = 'dead_lettered' AND NEW.status = 'dead_lettered')
  ) THEN
    RAISE EXCEPTION 'project queue state transition is invalid' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'available' AND NEW.status = 'in_flight' AND
     (NEW.attempt_count <> OLD.attempt_count + 1 OR
      NEW.lease_sequence <> OLD.lease_sequence + 1 OR
      NEW.available_at IS DISTINCT FROM OLD.available_at OR
      NEW.last_failure_code IS DISTINCT FROM OLD.last_failure_code) THEN
    RAISE EXCEPTION 'project queue claim transition is invalid' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'in_flight' AND NEW.status = 'in_flight' AND
     (NEW.attempt_count <> OLD.attempt_count OR NEW.lease_sequence <> OLD.lease_sequence OR
      NEW.lease_worker_id IS DISTINCT FROM OLD.lease_worker_id OR
      NEW.lease_token_hash IS DISTINCT FROM OLD.lease_token_hash OR
      NEW.lease_expires_at <= OLD.lease_expires_at) THEN
    RAISE EXCEPTION 'project queue lease renewal is invalid' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'in_flight' AND NEW.status <> 'in_flight' AND
     (NEW.attempt_count <> OLD.attempt_count OR NEW.lease_sequence <> OLD.lease_sequence OR
      NEW.last_failure_code IS NULL AND NEW.status <> 'completed') THEN
    RAISE EXCEPTION 'project queue settlement transition is invalid' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION qkern_validate_project_queue_message_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  configured_retention integer;
BEGIN
  SELECT retention_seconds INTO configured_retention
  FROM project_queues
  WHERE organization_id=OLD.organization_id AND project_id=OLD.project_id
    AND environment=OLD.environment AND id=OLD.queue_id;
  IF OLD.status <> 'completed' OR OLD.completed_at IS NULL OR
     OLD.completed_at + make_interval(secs => configured_retention) > clock_timestamp() OR
     OLD.dedupe_key_hash IS NOT NULL THEN
    RAISE EXCEPTION 'project queue message cannot be deleted before safe retention' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER project_queues_immutable
  BEFORE UPDATE ON project_queues FOR EACH ROW
  EXECUTE FUNCTION qkern_reject_project_queue_mutation();
CREATE TRIGGER project_queue_messages_update_guard
  BEFORE UPDATE ON project_queue_messages FOR EACH ROW
  EXECUTE FUNCTION qkern_validate_project_queue_message_update();
CREATE TRIGGER project_queue_messages_delete_guard
  BEFORE DELETE ON project_queue_messages FOR EACH ROW
  EXECUTE FUNCTION qkern_validate_project_queue_message_delete();

ALTER TABLE project_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_queue_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_queues_select ON project_queues
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_queues_insert ON project_queues
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

CREATE POLICY project_queue_messages_select ON project_queue_messages
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_queue_messages_insert ON project_queue_messages
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_queue_messages_update ON project_queue_messages
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_queue_messages_delete ON project_queue_messages
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_queues, project_queue_messages FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_project_queue_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_validate_project_queue_message_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_validate_project_queue_message_delete() FROM PUBLIC;

GRANT SELECT, INSERT ON project_queues TO qkern_runtime;
GRANT SELECT, INSERT, DELETE ON project_queue_messages TO qkern_runtime;
GRANT UPDATE (status,dedupe_key_hash,dedupe_expires_at,attempt_count,available_at,
  lease_worker_id,lease_token_hash,lease_sequence,lease_expires_at,last_failure_code,
  completed_at,dead_lettered_at) ON project_queue_messages TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_project_queue_mutation() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_validate_project_queue_message_update() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_validate_project_queue_message_delete() TO qkern_runtime;

COMMIT;
