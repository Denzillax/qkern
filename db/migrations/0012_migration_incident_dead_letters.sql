-- PostgreSQL requires a newly added enum value to be committed before it can
-- be used by subsequent DDL. Run this file in order and do not wrap the whole
-- file in an additional transaction.
ALTER TYPE qkern_outbox_status ADD VALUE IF NOT EXISTS 'dead_lettered';

BEGIN;

ALTER TABLE migration_incident_outbox
  DROP CONSTRAINT migration_incident_outbox_state_shape,
  ADD COLUMN failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN max_failures integer NOT NULL DEFAULT 8,
  ADD COLUMN last_failure_code text,
  ADD COLUMN dead_lettered_at timestamptz,
  ADD COLUMN retry_cycle_count integer NOT NULL DEFAULT 0,
  ADD COLUMN max_retry_cycles integer NOT NULL DEFAULT 3,
  ADD CONSTRAINT migration_incident_outbox_failure_bounds CHECK (
    failure_count BETWEEN 0 AND max_failures AND max_failures BETWEEN 1 AND 100 AND
    attempt_count >= failure_count
  ),
  ADD CONSTRAINT migration_incident_outbox_retry_bounds CHECK (
    retry_cycle_count BETWEEN 0 AND max_retry_cycles AND max_retry_cycles BETWEEN 1 AND 10
  ),
  ADD CONSTRAINT migration_incident_outbox_failure_code CHECK (
    (failure_count = 0 AND last_failure_code IS NULL) OR
    (failure_count > 0 AND last_failure_code IN ('PUBLISH_FAILED', 'INVALID_ACK'))
  ),
  ADD CONSTRAINT migration_incident_outbox_state_shape CHECK (
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

CREATE INDEX migration_incident_outbox_dead_letter_idx
  ON migration_incident_outbox (organization_id, dead_lettered_at, id)
  WHERE status = 'dead_lettered';

CREATE TYPE qkern_migration_incident_delivery_command_status
  AS ENUM ('pending', 'applied', 'rejected');

-- The web runtime can request only a bounded delivery retry. The command does
-- not resolve the incident, mutate the migration job or publish a message.
CREATE TABLE migration_incident_delivery_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  migration_incident_id uuid NOT NULL,
  requested_by text NOT NULL CHECK (char_length(requested_by) BETWEEN 1 AND 200),
  reason_code text NOT NULL CHECK (
    reason_code IN ('destination_recovered', 'credentials_rotated', 'provider_incident_resolved')
  ),
  status qkern_migration_incident_delivery_command_status NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_incident_delivery_commands_incident_scope_fk
    FOREIGN KEY (organization_id, migration_incident_id)
    REFERENCES migration_incidents (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT migration_incident_delivery_commands_scope_key UNIQUE (organization_id, id),
  CONSTRAINT migration_incident_delivery_commands_state_shape CHECK (
    (status = 'pending' AND processed_at IS NULL) OR
    (status IN ('applied', 'rejected') AND processed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX migration_incident_delivery_commands_one_pending
  ON migration_incident_delivery_commands (organization_id, migration_incident_id)
  WHERE status = 'pending';

CREATE INDEX migration_incident_delivery_commands_claim_idx
  ON migration_incident_delivery_commands (organization_id, created_at, id)
  WHERE status = 'pending';

CREATE TRIGGER migration_incident_delivery_commands_touch_updated_at
BEFORE UPDATE ON migration_incident_delivery_commands
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

-- Bind the actor to the transaction context and silently suppress commands
-- unless the exact tenant incident is dead-lettered and has retry capacity.
-- SECURITY DEFINER is deliberately narrow: the caller never receives SELECT
-- rights on the incident outbox.
CREATE OR REPLACE FUNCTION qkern_bind_incident_delivery_retry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  bound_actor text;
BEGIN
  bound_actor := nullif(pg_catalog.current_setting('qkern.actor_ref', true), '');
  IF bound_actor IS NULL OR char_length(bound_actor) > 200 THEN
    RETURN NULL;
  END IF;
  IF NEW.organization_id <> public.qkern_current_organization_id() OR NOT EXISTS (
    SELECT 1
    FROM public.migration_incident_outbox AS event
    WHERE event.organization_id = NEW.organization_id
      AND event.migration_incident_id = NEW.migration_incident_id
      AND event.status = 'dead_lettered'
      AND event.retry_cycle_count < event.max_retry_cycles
  ) THEN
    RETURN NULL;
  END IF;
  NEW.requested_by := bound_actor;
  RETURN NEW;
END;
$$;

CREATE TRIGGER migration_incident_delivery_commands_bind_actor
BEFORE INSERT ON migration_incident_delivery_commands
FOR EACH ROW EXECUTE FUNCTION qkern_bind_incident_delivery_retry();

ALTER TABLE migration_incident_delivery_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_incident_delivery_commands FORCE ROW LEVEL SECURITY;

CREATE POLICY migration_incident_delivery_commands_select ON migration_incident_delivery_commands
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY migration_incident_delivery_commands_insert ON migration_incident_delivery_commands
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY migration_incident_delivery_commands_update ON migration_incident_delivery_commands
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON migration_incident_delivery_commands FROM PUBLIC, qkern_runtime, qkern_worker;
REVOKE ALL ON FUNCTION qkern_bind_incident_delivery_retry() FROM PUBLIC, qkern_runtime, qkern_worker;

GRANT SELECT ON migration_incident_delivery_commands TO qkern_runtime;
GRANT INSERT (organization_id, migration_incident_id, requested_by, reason_code)
  ON migration_incident_delivery_commands TO qkern_runtime;

GRANT SELECT ON migration_incident_delivery_commands TO qkern_worker;
GRANT UPDATE (status, processed_at, updated_at)
  ON migration_incident_delivery_commands TO qkern_worker;
GRANT UPDATE (
  status, failure_count, last_failure_code, dead_lettered_at, retry_cycle_count,
  available_at, lease_owner, lease_token, lease_expires_at, updated_at
) ON migration_incident_outbox TO qkern_worker;

COMMIT;
