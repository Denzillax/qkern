BEGIN;

-- Runtime observability is deliberately aggregate-only. The function binds
-- itself to the transaction tenant and exposes no event, incident, actor,
-- endpoint, response, diagnostic or credential fields.
CREATE OR REPLACE FUNCTION qkern_migration_incident_delivery_health()
RETURNS TABLE (
  pending_count bigint,
  overdue_pending_count bigint,
  in_flight_count bigint,
  expired_lease_count bigint,
  recovery_pending_count bigint,
  dead_lettered_count bigint,
  recovery_exhausted_count bigint,
  oldest_pending_at timestamptz,
  latest_dead_lettered_at timestamptz,
  measured_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    count(*) FILTER (WHERE event.status = 'pending') AS pending_count,
    count(*) FILTER (
      WHERE event.status = 'pending'
        AND event.created_at <= statement_timestamp() - interval '5 minutes'
    ) AS overdue_pending_count,
    count(*) FILTER (
      WHERE event.status = 'pending'
        AND event.lease_owner IS NOT NULL
        AND event.lease_expires_at > statement_timestamp()
    ) AS in_flight_count,
    count(*) FILTER (
      WHERE event.status = 'pending'
        AND event.lease_expires_at IS NOT NULL
        AND event.lease_expires_at <= statement_timestamp()
    ) AS expired_lease_count,
    count(*) FILTER (
      WHERE event.status = 'pending' AND event.retry_cycle_count > 0
    ) AS recovery_pending_count,
    count(*) FILTER (WHERE event.status = 'dead_lettered') AS dead_lettered_count,
    count(*) FILTER (
      WHERE event.status = 'dead_lettered'
        AND event.retry_cycle_count >= event.max_retry_cycles
    ) AS recovery_exhausted_count,
    min(event.created_at) FILTER (WHERE event.status = 'pending') AS oldest_pending_at,
    max(event.dead_lettered_at) FILTER (WHERE event.status = 'dead_lettered') AS latest_dead_lettered_at,
    statement_timestamp() AS measured_at
  FROM public.migration_incident_outbox AS event
  WHERE event.organization_id = public.qkern_current_organization_id()
$$;

REVOKE ALL ON FUNCTION qkern_migration_incident_delivery_health()
  FROM PUBLIC, qkern_runtime, qkern_worker;
GRANT EXECUTE ON FUNCTION qkern_migration_incident_delivery_health()
  TO qkern_runtime;

COMMIT;
