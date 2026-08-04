BEGIN;

-- Provisioner liveness is persisted separately from jobs. RLS binds every
-- write to both the transaction tenant and the provisioner identity in
-- qkern.actor_ref, so a compromised process cannot impersonate a peer.
CREATE TABLE project_database_provisioner_heartbeats (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provisioner_id text NOT NULL CHECK (char_length(provisioner_id) BETWEEN 1 AND 200),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, provisioner_id),
  CONSTRAINT project_database_provisioner_heartbeats_time_order
    CHECK (last_seen_at >= started_at)
);

CREATE INDEX project_database_provisioner_heartbeats_seen_idx
  ON project_database_provisioner_heartbeats (organization_id, last_seen_at DESC);

ALTER TABLE project_database_provisioner_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_database_provisioner_heartbeats FORCE ROW LEVEL SECURITY;

CREATE POLICY project_database_provisioner_heartbeats_self
  ON project_database_provisioner_heartbeats
  USING (
    organization_id = qkern_current_organization_id()
    AND provisioner_id = nullif(current_setting('qkern.actor_ref', true), '')
  )
  WITH CHECK (
    organization_id = qkern_current_organization_id()
    AND provisioner_id = nullif(current_setting('qkern.actor_ref', true), '')
  );

-- Runtime observability is deliberately aggregate-only. This projection
-- exposes fixed error classes and SLO measurements, never job, project,
-- environment, actor, lease, provider, endpoint, binding or secret fields.
CREATE FUNCTION qkern_project_database_provisioning_health()
RETURNS TABLE (
  total_count bigint,
  pending_count bigint,
  ready_count bigint,
  scheduled_count bigint,
  running_count bigint,
  overdue_pending_count bigint,
  expired_lease_count bigint,
  succeeded_count bigint,
  failed_count bigint,
  recovery_exhausted_count bigint,
  active_failure_count bigint,
  active_provider_unavailable_count bigint,
  active_provider_rejected_count bigint,
  active_invalid_binding_count bigint,
  active_bootstrap_unverified_count bigint,
  active_provisioning_timeout_count bigint,
  observed_provisioner_count bigint,
  active_provisioner_count bigint,
  stale_provisioner_count bigint,
  oldest_pending_at timestamptz,
  latest_failed_at timestamptz,
  latest_heartbeat_at timestamptz,
  measured_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH measurement AS (
    SELECT pg_catalog.statement_timestamp() AS measured_at
  ),
  job_health AS (
    SELECT
      count(*)::bigint AS total_count,
      count(*) FILTER (WHERE job.status = 'pending')::bigint AS pending_count,
      count(*) FILTER (
        WHERE job.status = 'pending' AND job.available_at <= measurement.measured_at
      )::bigint AS ready_count,
      count(*) FILTER (
        WHERE job.status = 'pending' AND job.available_at > measurement.measured_at
      )::bigint AS scheduled_count,
      count(*) FILTER (WHERE job.status = 'running')::bigint AS running_count,
      count(*) FILTER (
        WHERE job.status = 'pending'
          AND job.created_at <= measurement.measured_at - interval '5 minutes'
      )::bigint AS overdue_pending_count,
      count(*) FILTER (
        WHERE job.status = 'running' AND job.lease_expires_at <= measurement.measured_at
      )::bigint AS expired_lease_count,
      count(*) FILTER (WHERE job.status = 'succeeded')::bigint AS succeeded_count,
      count(*) FILTER (WHERE job.status = 'failed')::bigint AS failed_count,
      count(*) FILTER (
        WHERE job.status = 'failed' AND job.retry_cycle_count >= job.max_retry_cycles
      )::bigint AS recovery_exhausted_count,
      count(*) FILTER (
        WHERE job.status <> 'succeeded' AND job.last_error_code IS NOT NULL
      )::bigint AS active_failure_count,
      count(*) FILTER (
        WHERE job.status <> 'succeeded' AND job.last_error_code = 'PROVIDER_UNAVAILABLE'
      )::bigint AS active_provider_unavailable_count,
      count(*) FILTER (
        WHERE job.status <> 'succeeded' AND job.last_error_code = 'PROVIDER_REJECTED'
      )::bigint AS active_provider_rejected_count,
      count(*) FILTER (
        WHERE job.status <> 'succeeded' AND job.last_error_code = 'INVALID_BINDING'
      )::bigint AS active_invalid_binding_count,
      count(*) FILTER (
        WHERE job.status <> 'succeeded' AND job.last_error_code = 'BOOTSTRAP_UNVERIFIED'
      )::bigint AS active_bootstrap_unverified_count,
      count(*) FILTER (
        WHERE job.status <> 'succeeded' AND job.last_error_code = 'PROVISIONING_TIMEOUT'
      )::bigint AS active_provisioning_timeout_count,
      min(job.created_at) FILTER (WHERE job.status = 'pending') AS oldest_pending_at,
      max(job.finished_at) FILTER (WHERE job.status = 'failed') AS latest_failed_at
    FROM public.project_database_provisioning_jobs AS job
    CROSS JOIN measurement
    WHERE job.organization_id = public.qkern_current_organization_id()
  ),
  heartbeat_health AS (
    SELECT
      count(*) FILTER (
        WHERE heartbeat.last_seen_at > measurement.measured_at - interval '24 hours'
      )::bigint AS observed_provisioner_count,
      count(*) FILTER (
        WHERE heartbeat.last_seen_at > measurement.measured_at - interval '2 minutes'
      )::bigint AS active_provisioner_count,
      count(*) FILTER (
        WHERE heartbeat.last_seen_at <= measurement.measured_at - interval '2 minutes'
          AND heartbeat.last_seen_at > measurement.measured_at - interval '24 hours'
      )::bigint AS stale_provisioner_count,
      max(heartbeat.last_seen_at) AS latest_heartbeat_at
    FROM public.project_database_provisioner_heartbeats AS heartbeat
    CROSS JOIN measurement
    WHERE heartbeat.organization_id = public.qkern_current_organization_id()
  )
  SELECT
    job_health.total_count,
    job_health.pending_count,
    job_health.ready_count,
    job_health.scheduled_count,
    job_health.running_count,
    job_health.overdue_pending_count,
    job_health.expired_lease_count,
    job_health.succeeded_count,
    job_health.failed_count,
    job_health.recovery_exhausted_count,
    job_health.active_failure_count,
    job_health.active_provider_unavailable_count,
    job_health.active_provider_rejected_count,
    job_health.active_invalid_binding_count,
    job_health.active_bootstrap_unverified_count,
    job_health.active_provisioning_timeout_count,
    heartbeat_health.observed_provisioner_count,
    heartbeat_health.active_provisioner_count,
    heartbeat_health.stale_provisioner_count,
    job_health.oldest_pending_at,
    job_health.latest_failed_at,
    heartbeat_health.latest_heartbeat_at,
    measurement.measured_at
  FROM job_health
  CROSS JOIN heartbeat_health
  CROSS JOIN measurement
$$;

REVOKE ALL ON project_database_provisioner_heartbeats
  FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;
REVOKE ALL ON FUNCTION qkern_project_database_provisioning_health()
  FROM PUBLIC, qkern_runtime, qkern_worker, qkern_provisioner;

GRANT INSERT (organization_id, provisioner_id, started_at, last_seen_at)
  ON project_database_provisioner_heartbeats TO qkern_provisioner;
GRANT UPDATE (last_seen_at)
  ON project_database_provisioner_heartbeats TO qkern_provisioner;
GRANT EXECUTE ON FUNCTION qkern_project_database_provisioning_health()
  TO qkern_runtime;

COMMIT;
