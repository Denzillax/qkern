-- PostgreSQL requires an enum value to be committed before it is referenced by
-- later schema statements. Execute this file in order and do not wrap the full
-- file in an additional outer transaction.
ALTER TYPE qkern_migration_incident_status ADD VALUE IF NOT EXISTS 'resolved';

BEGIN;

CREATE TYPE qkern_migration_incident_resolution_code AS ENUM (
  'target_ledger_match'
);

CREATE TYPE qkern_migration_incident_resolution_reason_code AS ENUM (
  'target_ledger_recheck'
);

CREATE TYPE qkern_migration_incident_resolution_command_status AS ENUM (
  'pending',
  'applied',
  'rejected'
);

ALTER TABLE migration_incidents
  ADD COLUMN resolved_by text,
  ADD COLUMN resolution_code qkern_migration_incident_resolution_code,
  ADD COLUMN resolved_at timestamptz,
  DROP CONSTRAINT migration_incidents_state_shape,
  ADD CONSTRAINT migration_incidents_state_shape CHECK (
    (
      status = 'open' AND
      acknowledged_by IS NULL AND acknowledgement_code IS NULL AND acknowledged_at IS NULL AND
      resolved_by IS NULL AND resolution_code IS NULL AND resolved_at IS NULL
    ) OR (
      status = 'acknowledged' AND
      acknowledged_by IS NOT NULL AND acknowledgement_code IS NOT NULL AND acknowledged_at IS NOT NULL AND
      resolved_by IS NULL AND resolution_code IS NULL AND resolved_at IS NULL
    ) OR (
      status = 'resolved' AND
      (
        (acknowledged_by IS NULL AND acknowledgement_code IS NULL AND acknowledged_at IS NULL) OR
        (acknowledged_by IS NOT NULL AND acknowledgement_code IS NOT NULL AND acknowledged_at IS NOT NULL)
      ) AND
      resolved_by IS NOT NULL AND resolution_code = 'target_ledger_match' AND resolved_at IS NOT NULL
    )
  );

-- Operators can request only a bounded read-only ledger verification. The
-- command contains no SQL, database reference, credentials or free text.
CREATE TABLE migration_incident_resolution_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  migration_incident_id uuid NOT NULL,
  requested_by text NOT NULL CHECK (char_length(requested_by) BETWEEN 1 AND 200),
  reason_code qkern_migration_incident_resolution_reason_code NOT NULL,
  status qkern_migration_incident_resolution_command_status NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_incident_resolution_commands_incident_scope_fk
    FOREIGN KEY (organization_id, migration_incident_id)
    REFERENCES migration_incidents (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT migration_incident_resolution_commands_scope_key
    UNIQUE (organization_id, id),
  CONSTRAINT migration_incident_resolution_commands_state_shape CHECK (
    (status = 'pending' AND processed_at IS NULL) OR
    (status IN ('applied', 'rejected') AND processed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX migration_incident_resolution_commands_one_pending
  ON migration_incident_resolution_commands (organization_id, migration_incident_id)
  WHERE status = 'pending';

CREATE INDEX migration_incident_resolution_commands_claim_idx
  ON migration_incident_resolution_commands (organization_id, created_at, id)
  WHERE status = 'pending';

CREATE TRIGGER migration_incident_resolution_commands_touch_updated_at
BEFORE UPDATE ON migration_incident_resolution_commands
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

-- Preserve immutable incident evidence. Runtime callers may only acknowledge;
-- only the worker role may resolve, and only after the bound job is already
-- applied by the target-ledger reconciliation path in the same transaction.
CREATE OR REPLACE FUNCTION qkern_validate_migration_incident_acknowledgement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  bound_actor text;
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.migration_job_id IS DISTINCT FROM OLD.migration_job_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.change_set_id IS DISTINCT FROM OLD.change_set_id OR
     NEW.kind IS DISTINCT FROM OLD.kind OR
     NEW.severity IS DISTINCT FROM OLD.severity OR
     NEW.detected_review_cycle IS DISTINCT FROM OLD.detected_review_cycle OR
     NEW.detected_reconciliation_attempt IS DISTINCT FROM OLD.detected_reconciliation_attempt OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'migration incident evidence is immutable' USING ERRCODE = '55000';
  END IF;

  bound_actor := nullif(pg_catalog.current_setting('qkern.actor_ref', true), '');
  IF bound_actor IS NULL OR char_length(bound_actor) > 200 THEN
    RAISE EXCEPTION 'migration incident actor is invalid' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'open' AND NEW.status = 'acknowledged' THEN
    IF NEW.resolved_by IS NOT NULL OR NEW.resolution_code IS NOT NULL OR NEW.resolved_at IS NOT NULL THEN
      RAISE EXCEPTION 'migration incident resolution evidence is worker-owned' USING ERRCODE = '55000';
    END IF;
    NEW.acknowledged_by := bound_actor;
    NEW.acknowledged_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('open', 'acknowledged') AND NEW.status = 'resolved' THEN
    IF NOT pg_catalog.pg_has_role(session_user, 'qkern_worker', 'MEMBER') OR
       NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by OR
       NEW.acknowledgement_code IS DISTINCT FROM OLD.acknowledgement_code OR
       NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at OR
       OLD.resolved_by IS NOT NULL OR OLD.resolution_code IS NOT NULL OR OLD.resolved_at IS NOT NULL OR
       NEW.resolved_by IS NOT NULL OR NEW.resolved_at IS NOT NULL OR
       NEW.resolution_code IS DISTINCT FROM 'target_ledger_match'::qkern_migration_incident_resolution_code OR
       NOT EXISTS (
         SELECT 1
         FROM public.migration_jobs AS job
         WHERE job.organization_id = OLD.organization_id
           AND job.id = OLD.migration_job_id
           AND job.status = 'applied'
           AND NOT job.reconciliation_required
       ) THEN
      RAISE EXCEPTION 'migration incident resolution requires worker-verified ledger evidence' USING ERRCODE = '55000';
    END IF;
    NEW.resolved_by := bound_actor;
    NEW.resolved_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'migration incident transition is append-only' USING ERRCODE = '55000';
END;
$$;

-- Bind tenant, actor, unresolved incident, exhausted job state and the fixed
-- three-cycle limit in one database-side decision.
CREATE FUNCTION qkern_bind_migration_incident_resolution_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  bound_actor text;
BEGIN
  bound_actor := nullif(pg_catalog.current_setting('qkern.actor_ref', true), '');
  IF bound_actor IS NULL OR char_length(bound_actor) > 200 OR
     NEW.organization_id <> public.qkern_current_organization_id() THEN
    RETURN NULL;
  END IF;

  -- Match the worker's command -> job lock order. A concurrent idempotent
  -- insert therefore waits without forming a command/job deadlock cycle.
  PERFORM 1
  FROM public.migration_incident_resolution_commands AS pending
  WHERE pending.organization_id = NEW.organization_id
    AND pending.migration_incident_id = NEW.migration_incident_id
    AND pending.status = 'pending'
  FOR UPDATE;

  PERFORM 1
  FROM public.migration_incidents AS incident
  JOIN public.migration_jobs AS job
    ON job.organization_id = incident.organization_id
   AND job.id = incident.migration_job_id
  WHERE incident.organization_id = NEW.organization_id
    AND incident.id = NEW.migration_incident_id
    AND incident.status IN ('open', 'acknowledged')
    AND job.status = 'review_required'
    AND job.reconciliation_required
    AND (
      SELECT count(*)
      FROM public.migration_incident_resolution_commands AS prior
      WHERE prior.organization_id = incident.organization_id
        AND prior.migration_incident_id = incident.id
        AND prior.status = 'applied'
    ) < 3
  FOR UPDATE OF incident, job;

  IF NOT FOUND THEN RETURN NULL; END IF;
  NEW.requested_by := bound_actor;
  RETURN NEW;
END;
$$;

-- v0.17 locked the outbox snapshot in its insert trigger. Take any existing
-- pending command first so duplicate API requests use the same command ->
-- outbox order as the publisher worker and cannot form a lock-order cycle.
CREATE OR REPLACE FUNCTION qkern_bind_incident_delivery_retry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  bound_actor text;
  current_failure_code text;
BEGIN
  bound_actor := nullif(pg_catalog.current_setting('qkern.actor_ref', true), '');
  IF bound_actor IS NULL OR char_length(bound_actor) > 200 OR
     NEW.organization_id <> public.qkern_current_organization_id() THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM public.migration_incident_delivery_commands AS pending
  WHERE pending.organization_id = NEW.organization_id
    AND pending.migration_incident_id = NEW.migration_incident_id
    AND pending.status = 'pending'
  FOR UPDATE;

  SELECT event.last_failure_code
  INTO current_failure_code
  FROM public.migration_incident_outbox AS event
  WHERE event.organization_id = NEW.organization_id
    AND event.migration_incident_id = NEW.migration_incident_id
    AND event.status = 'dead_lettered'
    AND event.retry_cycle_count < event.max_retry_cycles
  FOR UPDATE;

  IF current_failure_code IS NULL OR
     NEW.expected_failure_code IS DISTINCT FROM current_failure_code OR
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

CREATE TRIGGER migration_incident_resolution_commands_bind_actor
BEFORE INSERT ON migration_incident_resolution_commands
FOR EACH ROW EXECUTE FUNCTION qkern_bind_migration_incident_resolution_command();

ALTER TABLE migration_incident_resolution_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_incident_resolution_commands FORCE ROW LEVEL SECURITY;

CREATE POLICY migration_incident_resolution_commands_select
  ON migration_incident_resolution_commands
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY migration_incident_resolution_commands_insert
  ON migration_incident_resolution_commands
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY migration_incident_resolution_commands_update
  ON migration_incident_resolution_commands
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON migration_incident_resolution_commands
  FROM PUBLIC, qkern_runtime, qkern_worker;
REVOKE ALL ON FUNCTION qkern_bind_migration_incident_resolution_command()
  FROM PUBLIC, qkern_runtime, qkern_worker;

GRANT SELECT ON migration_incident_resolution_commands TO qkern_runtime;
GRANT INSERT (organization_id, migration_incident_id, requested_by, reason_code)
  ON migration_incident_resolution_commands TO qkern_runtime;

GRANT SELECT ON migration_incident_resolution_commands TO qkern_worker;
GRANT UPDATE (status, processed_at, updated_at)
  ON migration_incident_resolution_commands TO qkern_worker;
GRANT UPDATE (status, resolution_code) ON migration_incidents TO qkern_worker;

COMMIT;
