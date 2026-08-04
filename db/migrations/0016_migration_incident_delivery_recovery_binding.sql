BEGIN;

ALTER TABLE migration_incident_delivery_commands
  ADD COLUMN expected_failure_code text;

-- Keep the legacy backfill on one stable outbox snapshot while command-table
-- ALTER locks already exclude concurrent command inserts.
LOCK TABLE migration_incident_outbox IN SHARE ROW EXCLUSIVE MODE;

-- Pending pre-v0.17 commands can still be bound to the current dead-letter
-- snapshot. Processed historical commands remain nullable and immutable.
UPDATE migration_incident_delivery_commands AS command
SET expected_failure_code = event.last_failure_code
FROM migration_incident_outbox AS event
WHERE command.organization_id = event.organization_id
  AND command.migration_incident_id = event.migration_incident_id
  AND command.status = 'pending'
  AND event.status = 'dead_lettered';

-- A legacy pending command with an incompatible reason is safer rejected than
-- silently reinterpreted under the stronger v0.17 contract.
UPDATE migration_incident_delivery_commands
SET status = 'rejected', expected_failure_code = NULL,
    processed_at = now(), updated_at = now()
WHERE status = 'pending'
  AND NOT COALESCE((
    (expected_failure_code = 'SIGNING_KEY_UNAVAILABLE' AND reason_code = 'credentials_rotated') OR
    (expected_failure_code = 'DESTINATION_REJECTED') OR
    (expected_failure_code IN ('PUBLISH_FAILED', 'INVALID_ACK', 'DELIVERY_TIMEOUT') AND
      reason_code IN ('destination_recovered', 'provider_incident_resolved'))
  ), false);

ALTER TABLE migration_incident_delivery_commands
  ADD CONSTRAINT migration_incident_delivery_commands_expected_failure_code CHECK (
    (expected_failure_code IS NULL AND status IN ('applied', 'rejected')) OR
    (
      expected_failure_code IN (
        'PUBLISH_FAILED',
        'INVALID_ACK',
        'SIGNING_KEY_UNAVAILABLE',
        'DELIVERY_TIMEOUT',
        'DESTINATION_REJECTED'
      ) AND (
        (expected_failure_code = 'SIGNING_KEY_UNAVAILABLE' AND reason_code = 'credentials_rotated') OR
        (expected_failure_code = 'DESTINATION_REJECTED') OR
        (expected_failure_code IN ('PUBLISH_FAILED', 'INVALID_ACK', 'DELIVERY_TIMEOUT') AND
          reason_code IN ('destination_recovered', 'provider_incident_resolved'))
      )
    )
  );

-- Bind actor, tenant, dead-letter state, retry capacity, observed failure and
-- compatible fixed recovery reason in one database-side decision.
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

REVOKE ALL ON FUNCTION qkern_bind_incident_delivery_retry()
  FROM PUBLIC, qkern_runtime, qkern_worker;

GRANT INSERT (expected_failure_code)
  ON migration_incident_delivery_commands TO qkern_runtime;

COMMIT;
