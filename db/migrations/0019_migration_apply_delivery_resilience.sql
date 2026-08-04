BEGIN;

-- Apply dispatch now has the same bounded, observable delivery lifecycle as
-- incident delivery. The event remains reference-only; no SQL or credential
-- field is introduced.
ALTER TABLE migration_outbox
  DROP CONSTRAINT migration_outbox_state_shape,
  ADD COLUMN failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN max_failures integer NOT NULL DEFAULT 8,
  ADD COLUMN last_failure_code text,
  ADD COLUMN dead_lettered_at timestamptz,
  ADD COLUMN retry_cycle_count integer NOT NULL DEFAULT 0,
  ADD COLUMN max_retry_cycles integer NOT NULL DEFAULT 3,
  ADD CONSTRAINT migration_outbox_failure_bounds CHECK (
    failure_count BETWEEN 0 AND max_failures AND max_failures BETWEEN 1 AND 100 AND
    attempt_count >= failure_count
  ),
  ADD CONSTRAINT migration_outbox_retry_bounds CHECK (
    retry_cycle_count BETWEEN 0 AND max_retry_cycles AND max_retry_cycles BETWEEN 1 AND 10
  ),
  ADD CONSTRAINT migration_outbox_failure_code CHECK (
    (failure_count = 0 AND last_failure_code IS NULL) OR
    (failure_count > 0 AND last_failure_code IN (
      'PUBLISH_FAILED', 'INVALID_ACK', 'SIGNING_KEY_UNAVAILABLE',
      'DELIVERY_TIMEOUT', 'DESTINATION_REJECTED'
    ))
  ),
  ADD CONSTRAINT migration_outbox_state_shape CHECK (
    (status = 'pending' AND published_at IS NULL AND dead_lettered_at IS NULL AND
      failure_count < max_failures AND (
        (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) OR
        (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      )) OR
    (status = 'published' AND published_at IS NOT NULL AND dead_lettered_at IS NULL AND
      lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) OR
    (status = 'dead_lettered' AND published_at IS NULL AND dead_lettered_at IS NOT NULL AND
      failure_count = max_failures AND last_failure_code IS NOT NULL AND
      lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  );

CREATE INDEX migration_outbox_dead_letter_idx
  ON migration_outbox (organization_id, dead_lettered_at, id)
  WHERE status = 'dead_lettered';

CREATE TYPE qkern_migration_outbox_delivery_command_status
  AS ENUM ('pending', 'applied', 'rejected');

CREATE TABLE migration_outbox_delivery_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  migration_job_id uuid NOT NULL,
  requested_by text NOT NULL CHECK (char_length(requested_by) BETWEEN 1 AND 200),
  reason_code text NOT NULL CHECK (
    reason_code IN ('destination_recovered', 'credentials_rotated', 'provider_incident_resolved')
  ),
  expected_failure_code text NOT NULL CHECK (
    expected_failure_code IN (
      'PUBLISH_FAILED', 'INVALID_ACK', 'SIGNING_KEY_UNAVAILABLE',
      'DELIVERY_TIMEOUT', 'DESTINATION_REJECTED'
    )
  ),
  expected_retry_cycle integer NOT NULL CHECK (expected_retry_cycle BETWEEN 0 AND 10),
  status qkern_migration_outbox_delivery_command_status NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_outbox_delivery_commands_job_scope_fk
    FOREIGN KEY (organization_id, migration_job_id)
    REFERENCES migration_jobs (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT migration_outbox_delivery_commands_scope_key UNIQUE (organization_id, id),
  CONSTRAINT migration_outbox_delivery_commands_reason_compatible CHECK (
    (expected_failure_code = 'SIGNING_KEY_UNAVAILABLE' AND reason_code = 'credentials_rotated') OR
    (expected_failure_code = 'DESTINATION_REJECTED') OR
    (expected_failure_code IN ('PUBLISH_FAILED', 'INVALID_ACK', 'DELIVERY_TIMEOUT') AND
      reason_code IN ('destination_recovered', 'provider_incident_resolved'))
  ),
  CONSTRAINT migration_outbox_delivery_commands_state_shape CHECK (
    (status = 'pending' AND processed_at IS NULL) OR
    (status IN ('applied', 'rejected') AND processed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX migration_outbox_delivery_commands_one_pending
  ON migration_outbox_delivery_commands (organization_id, migration_job_id)
  WHERE status = 'pending';

CREATE INDEX migration_outbox_delivery_commands_claim_idx
  ON migration_outbox_delivery_commands (organization_id, created_at, id)
  WHERE status = 'pending';

CREATE TRIGGER migration_outbox_delivery_commands_touch_updated_at
BEFORE UPDATE ON migration_outbox_delivery_commands
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

-- Actor, tenant, observed failure, retry generation and reason are bound in
-- one database-side lock decision. Request payloads cannot reopen a different
-- or later dead letter (including same-code ABA replays).
CREATE FUNCTION qkern_bind_migration_outbox_delivery_retry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  bound_actor text;
  current_failure_code text;
  current_retry_cycle integer;
BEGIN
  bound_actor := nullif(pg_catalog.current_setting('qkern.actor_ref', true), '');
  IF bound_actor IS NULL OR char_length(bound_actor) > 200 OR
     NEW.organization_id <> public.qkern_current_organization_id() THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM public.migration_outbox_delivery_commands AS pending
  WHERE pending.organization_id = NEW.organization_id
    AND pending.migration_job_id = NEW.migration_job_id
    AND pending.status = 'pending'
  FOR UPDATE;

  SELECT event.last_failure_code, event.retry_cycle_count
  INTO current_failure_code, current_retry_cycle
  FROM public.migration_outbox AS event
  WHERE event.organization_id = NEW.organization_id
    AND event.migration_job_id = NEW.migration_job_id
    AND event.status = 'dead_lettered'
    AND event.retry_cycle_count < event.max_retry_cycles
  FOR UPDATE;

  IF current_failure_code IS NULL OR current_retry_cycle IS NULL OR
     NEW.expected_failure_code IS DISTINCT FROM current_failure_code OR
     NEW.expected_retry_cycle IS DISTINCT FROM current_retry_cycle OR
     NOT (
       (current_failure_code = 'SIGNING_KEY_UNAVAILABLE' AND NEW.reason_code = 'credentials_rotated') OR
       (current_failure_code = 'DESTINATION_REJECTED') OR
       (current_failure_code IN ('PUBLISH_FAILED', 'INVALID_ACK', 'DELIVERY_TIMEOUT') AND
         NEW.reason_code IN ('destination_recovered', 'provider_incident_resolved'))
     ) THEN
    RETURN NULL;
  END IF;

  NEW.requested_by := bound_actor;
  RETURN NEW;
END;
$$;

CREATE TRIGGER migration_outbox_delivery_commands_bind_actor
BEFORE INSERT ON migration_outbox_delivery_commands
FOR EACH ROW EXECUTE FUNCTION qkern_bind_migration_outbox_delivery_retry();

ALTER TABLE migration_outbox_delivery_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_outbox_delivery_commands FORCE ROW LEVEL SECURITY;

CREATE POLICY migration_outbox_delivery_commands_select ON migration_outbox_delivery_commands
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY migration_outbox_delivery_commands_insert ON migration_outbox_delivery_commands
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY migration_outbox_delivery_commands_update ON migration_outbox_delivery_commands
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

-- Aggregate visibility deliberately omits lease owners/tokens, actor refs,
-- endpoints, provider responses and job payloads.
CREATE FUNCTION qkern_migration_outbox_delivery_health()
RETURNS TABLE (
  total_count bigint,
  pending_count bigint,
  ready_count bigint,
  scheduled_count bigint,
  in_flight_count bigint,
  overdue_pending_count bigint,
  expired_lease_count bigint,
  recovery_pending_count bigint,
  published_count bigint,
  dead_lettered_count bigint,
  recovery_exhausted_count bigint,
  pending_retry_command_count bigint,
  active_failure_count bigint,
  active_publish_failed_count bigint,
  active_invalid_ack_count bigint,
  active_signing_key_unavailable_count bigint,
  active_delivery_timeout_count bigint,
  active_destination_rejected_count bigint,
  oldest_pending_at timestamptz,
  oldest_dead_lettered_at timestamptz,
  latest_dead_lettered_at timestamptz,
  measured_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE event.status = 'pending')::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending' AND event.available_at <= pg_catalog.statement_timestamp()
             AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= pg_catalog.statement_timestamp())
         )::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending' AND event.available_at > pg_catalog.statement_timestamp()
             AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= pg_catalog.statement_timestamp())
         )::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending' AND event.lease_expires_at > pg_catalog.statement_timestamp()
         )::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending'
             AND event.created_at <= pg_catalog.statement_timestamp() - interval '5 minutes'
         )::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending' AND event.lease_expires_at IS NOT NULL
             AND event.lease_expires_at <= pg_catalog.statement_timestamp()
         )::bigint,
         count(*) FILTER (WHERE event.status = 'pending' AND event.retry_cycle_count > 0)::bigint,
         count(*) FILTER (WHERE event.status = 'published')::bigint,
         count(*) FILTER (WHERE event.status = 'dead_lettered')::bigint,
         count(*) FILTER (
           WHERE event.status = 'dead_lettered' AND event.retry_cycle_count >= event.max_retry_cycles
         )::bigint,
         (
           SELECT count(*)::bigint
           FROM public.migration_outbox_delivery_commands AS command
           WHERE command.organization_id = public.qkern_current_organization_id()
             AND command.status = 'pending'
         ),
         count(*) FILTER (WHERE event.status <> 'published' AND event.failure_count > 0)::bigint,
         count(*) FILTER (
           WHERE event.status <> 'published' AND event.last_failure_code = 'PUBLISH_FAILED'
         )::bigint,
         count(*) FILTER (
           WHERE event.status <> 'published' AND event.last_failure_code = 'INVALID_ACK'
         )::bigint,
         count(*) FILTER (
           WHERE event.status <> 'published' AND event.last_failure_code = 'SIGNING_KEY_UNAVAILABLE'
         )::bigint,
         count(*) FILTER (
           WHERE event.status <> 'published' AND event.last_failure_code = 'DELIVERY_TIMEOUT'
         )::bigint,
         count(*) FILTER (
           WHERE event.status <> 'published' AND event.last_failure_code = 'DESTINATION_REJECTED'
         )::bigint,
         min(event.created_at) FILTER (WHERE event.status = 'pending'),
         min(event.dead_lettered_at) FILTER (WHERE event.status = 'dead_lettered'),
         max(event.dead_lettered_at) FILTER (WHERE event.status = 'dead_lettered'),
         pg_catalog.statement_timestamp()
  FROM public.migration_outbox AS event
  WHERE event.organization_id = public.qkern_current_organization_id()
$$;

CREATE FUNCTION qkern_migration_outbox_delivery_status(requested_job_id uuid)
RETURNS TABLE (
  migration_job_id uuid,
  event_id uuid,
  delivery_status qkern_outbox_status,
  attempt_count integer,
  failure_count integer,
  max_failures integer,
  last_failure_code text,
  dead_lettered_at timestamptz,
  retry_cycle_count integer,
  max_retry_cycles integer,
  available_at timestamptz,
  published_at timestamptz,
  retry_command_pending boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT event.migration_job_id, event.id, event.status, event.attempt_count,
         event.failure_count, event.max_failures, event.last_failure_code,
         event.dead_lettered_at, event.retry_cycle_count, event.max_retry_cycles,
         event.available_at, event.published_at,
         EXISTS (
           SELECT 1 FROM public.migration_outbox_delivery_commands AS command
           WHERE command.organization_id = event.organization_id
             AND command.migration_job_id = event.migration_job_id
             AND command.status = 'pending'
         )
  FROM public.migration_outbox AS event
  WHERE event.organization_id = public.qkern_current_organization_id()
    AND event.migration_job_id = requested_job_id
$$;

REVOKE ALL ON migration_outbox_delivery_commands FROM PUBLIC, qkern_runtime, qkern_worker;
REVOKE ALL ON FUNCTION qkern_bind_migration_outbox_delivery_retry()
  FROM PUBLIC, qkern_runtime, qkern_worker;
REVOKE ALL ON FUNCTION qkern_migration_outbox_delivery_health()
  FROM PUBLIC, qkern_runtime, qkern_worker;
REVOKE ALL ON FUNCTION qkern_migration_outbox_delivery_status(uuid)
  FROM PUBLIC, qkern_runtime, qkern_worker;

-- Runtime can request and observe only its command plus aggregate health. It
-- loses direct outbox SELECT, preventing lease or broker-state inspection.
REVOKE SELECT ON migration_outbox FROM qkern_runtime;
GRANT SELECT ON migration_outbox_delivery_commands TO qkern_runtime;
GRANT INSERT (
  organization_id, migration_job_id, requested_by, reason_code,
  expected_failure_code, expected_retry_cycle
) ON migration_outbox_delivery_commands TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_migration_outbox_delivery_health() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_migration_outbox_delivery_status(uuid) TO qkern_runtime;

GRANT SELECT ON migration_outbox_delivery_commands TO qkern_worker;
GRANT UPDATE (status, processed_at, updated_at)
  ON migration_outbox_delivery_commands TO qkern_worker;
GRANT UPDATE (
  status, failure_count, last_failure_code, dead_lettered_at, retry_cycle_count,
  available_at, lease_owner, lease_token, lease_expires_at, updated_at
) ON migration_outbox TO qkern_worker;

COMMIT;
