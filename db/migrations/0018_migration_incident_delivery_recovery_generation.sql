BEGIN;

ALTER TABLE migration_incident_delivery_commands
  ADD COLUMN expected_retry_cycle integer;

-- Freeze the outbox generation while pre-v0.19 pending commands are either
-- bound to their still-current dead-letter snapshot or rejected fail-closed.
LOCK TABLE migration_incident_outbox IN SHARE ROW EXCLUSIVE MODE;

UPDATE migration_incident_delivery_commands AS command
SET expected_retry_cycle = event.retry_cycle_count
FROM migration_incident_outbox AS event
WHERE command.organization_id = event.organization_id
  AND command.migration_incident_id = event.migration_incident_id
  AND command.status = 'pending'
  AND event.status = 'dead_lettered'
  AND event.retry_cycle_count < event.max_retry_cycles
  AND command.expected_failure_code = event.last_failure_code;

-- A pending command that no longer identifies the current dead-letter
-- generation must never be replayed against a later same-code failure.
UPDATE migration_incident_delivery_commands
SET status = 'rejected', processed_at = now(), updated_at = now()
WHERE status = 'pending'
  AND expected_retry_cycle IS NULL;

-- CHECK accepts SQL NULL unless the predicate is explicitly false. Replace
-- the v0.17 constraint so a pending row cannot bypass its failure binding.
ALTER TABLE migration_incident_delivery_commands
  DROP CONSTRAINT migration_incident_delivery_commands_expected_failure_code,
  ADD CONSTRAINT migration_incident_delivery_commands_expected_failure_code CHECK (
    (expected_failure_code IS NULL AND status IN ('applied', 'rejected')) OR
    (
      expected_failure_code IS NOT NULL AND
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

ALTER TABLE migration_incident_delivery_commands
  ADD CONSTRAINT migration_incident_delivery_commands_expected_retry_cycle CHECK (
    (expected_retry_cycle IS NULL AND status IN ('applied', 'rejected')) OR
    (expected_retry_cycle IS NOT NULL AND expected_retry_cycle BETWEEN 0 AND 10)
  );

-- Preserve v0.18's command-first lock order, then bind actor, tenant,
-- dead-letter state, capacity, failure code, reason and monotone retry
-- generation in one locked database-side decision.
CREATE OR REPLACE FUNCTION qkern_bind_incident_delivery_retry()
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
  FROM public.migration_incident_delivery_commands AS pending
  WHERE pending.organization_id = NEW.organization_id
    AND pending.migration_incident_id = NEW.migration_incident_id
    AND pending.status = 'pending'
  FOR UPDATE;

  SELECT event.last_failure_code, event.retry_cycle_count
  INTO current_failure_code, current_retry_cycle
  FROM public.migration_incident_outbox AS event
  WHERE event.organization_id = NEW.organization_id
    AND event.migration_incident_id = NEW.migration_incident_id
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

REVOKE ALL ON FUNCTION qkern_bind_incident_delivery_retry()
  FROM PUBLIC, qkern_runtime, qkern_worker;

GRANT INSERT (expected_retry_cycle)
  ON migration_incident_delivery_commands TO qkern_runtime;

COMMIT;
