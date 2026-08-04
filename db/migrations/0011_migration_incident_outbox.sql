BEGIN;

-- Delivery state remains reference-only. Incident details are joined only
-- while a fenced claim is hydrated for the injected notification sink.
CREATE TABLE migration_incident_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  migration_incident_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'migration.incident.opened'),
  status qkern_outbox_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_incident_outbox_incident_scope_fk
    FOREIGN KEY (organization_id, migration_incident_id)
    REFERENCES migration_incidents (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT migration_incident_outbox_scope_key UNIQUE (organization_id, id),
  CONSTRAINT migration_incident_outbox_one_event
    UNIQUE (organization_id, migration_incident_id, event_type),
  CONSTRAINT migration_incident_outbox_state_shape CHECK (
    (status = 'pending' AND published_at IS NULL AND (
      (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) OR
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    )) OR
    (status = 'published' AND published_at IS NOT NULL AND
      lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX migration_incident_outbox_claim_idx
  ON migration_incident_outbox (organization_id, available_at, created_at, id)
  WHERE status = 'pending';

CREATE TRIGGER migration_incident_outbox_touch_updated_at
BEFORE UPDATE ON migration_incident_outbox
FOR EACH ROW EXECUTE FUNCTION qkern_touch_updated_at();

-- Existing v0.9 incidents receive exactly one pending notification event.
INSERT INTO migration_incident_outbox (organization_id, migration_incident_id, event_type)
SELECT organization_id, id, 'migration.incident.opened'
FROM migration_incidents
ON CONFLICT (organization_id, migration_incident_id, event_type) DO NOTHING;

ALTER TABLE migration_incident_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_incident_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY migration_incident_outbox_select ON migration_incident_outbox
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY migration_incident_outbox_insert ON migration_incident_outbox
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY migration_incident_outbox_update ON migration_incident_outbox
  FOR UPDATE
  USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON migration_incident_outbox FROM PUBLIC, qkern_runtime, qkern_worker;

-- The web runtime cannot inspect, create or publish notification events.
-- The independently configured publisher reuses the verified worker boundary.
GRANT SELECT ON migration_incident_outbox, migration_incidents TO qkern_worker;
GRANT INSERT (organization_id, migration_incident_id, event_type)
  ON migration_incident_outbox TO qkern_worker;
GRANT UPDATE (
  status, attempt_count, available_at, lease_owner, lease_token, lease_expires_at,
  published_at, updated_at
) ON migration_incident_outbox TO qkern_worker;

COMMIT;
