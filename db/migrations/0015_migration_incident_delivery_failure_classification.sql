BEGIN;

-- Expand only the fixed, redacted failure taxonomy. Existing v0.12 rows stay
-- valid and no provider response, endpoint or diagnostic field is added.
ALTER TABLE migration_incident_outbox
  DROP CONSTRAINT migration_incident_outbox_failure_code,
  ADD CONSTRAINT migration_incident_outbox_failure_code CHECK (
    (failure_count = 0 AND last_failure_code IS NULL) OR
    (failure_count > 0 AND last_failure_code IN (
      'PUBLISH_FAILED',
      'INVALID_ACK',
      'SIGNING_KEY_UNAVAILABLE',
      'DELIVERY_TIMEOUT',
      'DESTINATION_REJECTED'
    ))
  );

-- PostgreSQL cannot change a table function's return type in place. Preserve
-- the v0.14 projection in history and replace only the aggregate health shape.
REVOKE ALL ON FUNCTION qkern_migration_incident_delivery_health()
  FROM PUBLIC, qkern_runtime, qkern_worker;
DROP FUNCTION qkern_migration_incident_delivery_health();

CREATE FUNCTION qkern_migration_incident_delivery_health()
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
           WHERE event.status = 'pending'
             AND event.available_at <= pg_catalog.statement_timestamp()
             AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= pg_catalog.statement_timestamp())
         )::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending'
             AND event.available_at > pg_catalog.statement_timestamp()
             AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= pg_catalog.statement_timestamp())
         )::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending'
             AND event.lease_expires_at > pg_catalog.statement_timestamp()
         )::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending'
             AND event.created_at <= pg_catalog.statement_timestamp() - interval '5 minutes'
         )::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending'
             AND event.lease_expires_at IS NOT NULL
             AND event.lease_expires_at <= pg_catalog.statement_timestamp()
         )::bigint,
         count(*) FILTER (
           WHERE event.status = 'pending' AND event.retry_cycle_count > 0
         )::bigint,
         count(*) FILTER (WHERE event.status = 'published')::bigint,
         count(*) FILTER (WHERE event.status = 'dead_lettered')::bigint,
         count(*) FILTER (
           WHERE event.status = 'dead_lettered'
             AND event.retry_cycle_count >= event.max_retry_cycles
         )::bigint,
         (
           SELECT count(*)::bigint
           FROM public.migration_incident_delivery_commands AS command
           WHERE command.organization_id = public.qkern_current_organization_id()
             AND command.status = 'pending'
         ),
         count(*) FILTER (
           WHERE event.status <> 'published' AND event.failure_count > 0
         )::bigint,
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
  FROM public.migration_incident_outbox AS event
  WHERE event.organization_id = public.qkern_current_organization_id()
$$;

REVOKE ALL ON FUNCTION qkern_migration_incident_delivery_health()
  FROM PUBLIC, qkern_runtime, qkern_worker;
GRANT EXECUTE ON FUNCTION qkern_migration_incident_delivery_health() TO qkern_runtime;

COMMIT;
