BEGIN;

-- Preserve the v0.13 aggregate contract in migration history, then replace
-- it transactionally with the v0.14 superset. PostgreSQL requires a drop
-- because a function's table return type cannot be changed in-place.
REVOKE ALL ON FUNCTION qkern_migration_incident_delivery_health()
  FROM PUBLIC, qkern_runtime, qkern_worker;
DROP FUNCTION qkern_migration_incident_delivery_health();

-- The web runtime keeps zero table privileges on the incident outbox. This
-- projection exposes fixed operational state for at most 100 incident ids
-- that the service has already authorized inside the current tenant.
CREATE FUNCTION qkern_migration_incident_delivery_statuses(p_incident_ids uuid[])
RETURNS TABLE (
  migration_incident_id uuid,
  event_id uuid,
  delivery_status text,
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
  SELECT event.migration_incident_id,
         event.id,
         event.status::text,
         event.attempt_count,
         event.failure_count,
         event.max_failures,
         event.last_failure_code,
         event.dead_lettered_at,
         event.retry_cycle_count,
         event.max_retry_cycles,
         event.available_at,
         event.published_at,
         EXISTS (
           SELECT 1
           FROM public.migration_incident_delivery_commands AS command
           WHERE command.organization_id = event.organization_id
             AND command.migration_incident_id = event.migration_incident_id
             AND command.status = 'pending'
         )
  FROM public.migration_incident_outbox AS event
  WHERE event.organization_id = public.qkern_current_organization_id()
    AND pg_catalog.cardinality(p_incident_ids) BETWEEN 1 AND 100
    AND event.migration_incident_id = ANY (p_incident_ids)
  ORDER BY event.migration_incident_id ASC
$$;

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
         min(event.created_at) FILTER (WHERE event.status = 'pending'),
         min(event.dead_lettered_at) FILTER (WHERE event.status = 'dead_lettered'),
         max(event.dead_lettered_at) FILTER (WHERE event.status = 'dead_lettered'),
         pg_catalog.statement_timestamp()
  FROM public.migration_incident_outbox AS event
  WHERE event.organization_id = public.qkern_current_organization_id()
$$;

REVOKE ALL ON FUNCTION qkern_migration_incident_delivery_statuses(uuid[])
  FROM PUBLIC, qkern_runtime, qkern_worker;
REVOKE ALL ON FUNCTION qkern_migration_incident_delivery_health()
  FROM PUBLIC, qkern_runtime, qkern_worker;

GRANT EXECUTE ON FUNCTION qkern_migration_incident_delivery_statuses(uuid[]) TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_migration_incident_delivery_health() TO qkern_runtime;

COMMIT;
