-- Webhook-Definitionen und Zustell-Outbox.
--
-- WebhookDeliverer existiert seit Release 1.6 Alpha 4 mit Signatur- und
-- Transportport, aber ohne Ort fuer Definitionen und ohne Warteschlange fuer
-- Zustellversuche. Ein Ereignis konnte damit nirgends hinterlegt und kein
-- Versuch wiederholt werden.
--
-- Die Outbox folgt demselben Muster wie project_queue_messages, das seit
-- Release 1.17 ueber sechs konkurrierende Instanzen zertifiziert ist: atomarer
-- Claim ueber FOR UPDATE SKIP LOCKED, workergebundene Lease als
-- SHA-256-Verifier, serverberechnetes Backoff und Dead Letter. Ein eigenes
-- Verfahren zu erfinden waere hier die schlechtere Wahl.

CREATE TABLE project_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{2,62}$'),
  -- Der Deliverer erzwingt HTTPS ohne Query und ohne Redirect. Hier steht nur
  -- die Laengengrenze; die Form prueft der Dienst, damit beide Seiten nicht
  -- auseinanderlaufen koennen.
  url text NOT NULL CHECK (char_length(url) BETWEEN 12 AND 2048),
  event_types text[] NOT NULL CHECK (
    array_length(event_types, 1) BETWEEN 1 AND 32
  ),
  -- Nur eine Referenz. Das Geheimnis selbst liegt im Vault und niemals hier.
  signing_secret_ref text NOT NULL CHECK (char_length(signing_secret_ref) BETWEEN 3 AND 256),
  timeout_ms integer NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 250 AND 30000),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT project_webhooks_name_key
    UNIQUE (organization_id, project_id, environment, name),
  CONSTRAINT project_webhooks_scope_id_key
    UNIQUE (organization_id, project_id, environment, id)
);

CREATE TABLE project_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  webhook_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9._-]{0,63}$'),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 65536),
  occurred_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_flight', 'delivered', 'dead_lettered')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_worker_id text CHECK (
    lease_worker_id IS NULL OR lease_worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  lease_token_hash text CHECK (lease_token_hash IS NULL OR lease_token_hash ~ '^[0-9a-f]{64}$'),
  lease_expires_at timestamptz,
  last_failure_code text CHECK (last_failure_code IS NULL OR last_failure_code IN (
    'WEBHOOK_INVALID', 'WEBHOOK_TIMEOUT', 'WEBHOOK_REJECTED', 'WEBHOOK_SIGNING_FAILED'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  FOREIGN KEY (organization_id, project_id, environment, webhook_id)
    REFERENCES project_webhooks (organization_id, project_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT project_webhook_deliveries_schedule CHECK (available_at >= created_at),
  CONSTRAINT project_webhook_deliveries_lease_shape CHECK (
    (status = 'in_flight' AND lease_worker_id IS NOT NULL AND lease_token_hash IS NOT NULL
      AND lease_expires_at IS NOT NULL) OR
    (status <> 'in_flight' AND lease_worker_id IS NULL AND lease_token_hash IS NULL
      AND lease_expires_at IS NULL)
  ),
  CONSTRAINT project_webhook_deliveries_terminal_shape CHECK (
    (status = 'delivered' AND delivered_at IS NOT NULL AND dead_lettered_at IS NULL) OR
    (status = 'dead_lettered' AND dead_lettered_at IS NOT NULL AND delivered_at IS NULL) OR
    (status IN ('pending', 'in_flight') AND delivered_at IS NULL AND dead_lettered_at IS NULL)
  )
);

CREATE INDEX project_webhook_deliveries_claim_idx
  ON project_webhook_deliveries (organization_id, project_id, environment, available_at, created_at, id)
  WHERE status = 'pending';
CREATE INDEX project_webhook_deliveries_expiry_idx
  ON project_webhook_deliveries (organization_id, project_id, environment, lease_expires_at)
  WHERE status = 'in_flight';

-- Die Nutzlast eines Zustellversuchs ist unveraenderlich: Waere sie es nicht,
-- koennte ein Wiederholungsversuch etwas anderes senden als der erste, und die
-- Signatur des Empfaengers wuerde eine andere Nachricht bestaetigen als die
-- ausgeloeste.
CREATE OR REPLACE FUNCTION qkern_validate_project_webhook_delivery_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id
     OR NEW.project_id <> OLD.project_id OR NEW.environment <> OLD.environment
     OR NEW.webhook_id <> OLD.webhook_id OR NEW.event_type <> OLD.event_type
     OR NEW.payload::text <> OLD.payload::text OR NEW.occurred_at <> OLD.occurred_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'webhook delivery content is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'webhook attempts must not move backwards' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('delivered', 'dead_lettered') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'a settled webhook delivery is final' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_webhook_deliveries_guard
  BEFORE UPDATE ON project_webhook_deliveries FOR EACH ROW
  EXECUTE FUNCTION qkern_validate_project_webhook_delivery_update();

ALTER TABLE project_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_webhooks_select ON project_webhooks
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_webhooks_insert ON project_webhooks
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_webhooks_delete ON project_webhooks
  FOR DELETE USING (organization_id = qkern_current_organization_id());

CREATE POLICY project_webhook_deliveries_select ON project_webhook_deliveries
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_webhook_deliveries_insert ON project_webhook_deliveries
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_webhook_deliveries_update ON project_webhook_deliveries
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_webhook_deliveries_delete ON project_webhook_deliveries
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_webhooks, project_webhook_deliveries FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_validate_project_webhook_delivery_update() FROM PUBLIC;

GRANT SELECT, INSERT, DELETE ON project_webhooks TO qkern_runtime;
-- Lesen und Sperren der Definition: SELECT ... FOR UPDATE verlangt zusaetzlich
-- ein UPDATE-Recht auf mindestens einer Spalte. Genau diese Lehre aus
-- Release 1.9 wird hier vorbeugend angewandt.
GRANT UPDATE (enabled) ON project_webhooks TO qkern_runtime;
CREATE POLICY project_webhooks_lock ON project_webhooks
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());

GRANT SELECT, INSERT, DELETE ON project_webhook_deliveries TO qkern_runtime;
GRANT UPDATE (status, attempt_count, available_at, lease_worker_id, lease_token_hash,
  lease_expires_at, last_failure_code, delivered_at, dead_lettered_at)
  ON project_webhook_deliveries TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_validate_project_webhook_delivery_update() TO qkern_runtime;
