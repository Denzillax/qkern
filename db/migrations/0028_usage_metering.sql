BEGIN;

CREATE TABLE usage_quota_policies (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  metric text NOT NULL CHECK (metric IN (
    'api_requests','database_row_reads','storage_egress_bytes','realtime_messages',
    'queue_operations','function_invocations'
  )),
  quota_limit bigint NOT NULL CHECK (quota_limit BETWEEN 1 AND 9000000000000000),
  mode text NOT NULL CHECK (mode IN ('observe','enforce')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 2147483647),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 320),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,project_id,environment,metric),
  FOREIGN KEY (organization_id,project_id,environment)
    REFERENCES project_environments (organization_id,project_id,environment)
    ON DELETE CASCADE,
  CONSTRAINT usage_quota_policy_time_order CHECK (updated_at >= created_at)
);

CREATE TABLE usage_counters (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  metric text NOT NULL CHECK (metric IN (
    'api_requests','database_row_reads','storage_egress_bytes','realtime_messages',
    'queue_operations','function_invocations'
  )),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  quantity bigint NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 9223372036854775807),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,project_id,environment,metric,window_start),
  FOREIGN KEY (organization_id,project_id,environment)
    REFERENCES project_environments (organization_id,project_id,environment)
    ON DELETE CASCADE,
  CONSTRAINT usage_counter_month_window CHECK (
    window_start = date_trunc('month', window_start) AND
    window_end = window_start + interval '1 month'
  )
);

CREATE TABLE usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  metric text NOT NULL CHECK (metric IN (
    'api_requests','database_row_reads','storage_egress_bytes','realtime_messages',
    'queue_operations','function_invocations'
  )),
  source text NOT NULL CHECK (source IN (
    'control_plane','data_plane','generated_data_api','project_auth','project_storage',
    'realtime','project_queues','compute','mcp'
  )),
  event_key_hash text NOT NULL CHECK (event_key_hash ~ '^[0-9a-f]{64}$'),
  event_fingerprint text NOT NULL CHECK (event_fingerprint ~ '^[0-9a-f]{64}$'),
  quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 1000000000000),
  observed_at timestamptz NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  accepted boolean NOT NULL,
  rejection_code text CHECK (rejection_code IS NULL OR rejection_code = 'QUOTA_EXCEEDED'),
  resulting_quantity bigint NOT NULL CHECK (resulting_quantity BETWEEN 0 AND 9223372036854775807),
  limit_at_decision bigint CHECK (limit_at_decision BETWEEN 1 AND 9000000000000000),
  mode_at_decision text NOT NULL CHECK (mode_at_decision IN ('unlimited','observe','enforce')),
  quota_revision integer CHECK (quota_revision BETWEEN 1 AND 2147483647),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,project_id,environment)
    REFERENCES project_environments (organization_id,project_id,environment)
    ON DELETE CASCADE,
  CONSTRAINT usage_events_scope_id_key UNIQUE (organization_id,project_id,environment,id),
  CONSTRAINT usage_events_idempotency_key UNIQUE
    (organization_id,project_id,environment,event_key_hash),
  CONSTRAINT usage_event_month_window CHECK (
    window_start = date_trunc('month', window_start) AND
    window_end = window_start + interval '1 month' AND
    observed_at >= window_start AND observed_at < window_end
  ),
  CONSTRAINT usage_event_decision_shape CHECK (
    (accepted AND rejection_code IS NULL) OR
    (NOT accepted AND rejection_code = 'QUOTA_EXCEEDED')
  ),
  CONSTRAINT usage_event_policy_shape CHECK (
    (mode_at_decision = 'unlimited' AND limit_at_decision IS NULL AND quota_revision IS NULL) OR
    (mode_at_decision IN ('observe','enforce') AND limit_at_decision IS NOT NULL AND quota_revision IS NOT NULL)
  )
);

CREATE INDEX usage_events_window_idx ON usage_events
  (organization_id,project_id,environment,window_start,metric,recorded_at,id);
CREATE INDEX usage_events_rejected_idx ON usage_events
  (organization_id,project_id,environment,window_start,metric,recorded_at,id)
  WHERE accepted = false;

CREATE OR REPLACE FUNCTION qkern_validate_usage_policy_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.metric IS DISTINCT FROM OLD.metric OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'usage quota policy identity or revision is invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION qkern_validate_usage_counter_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.project_id IS DISTINCT FROM OLD.project_id OR
     NEW.environment IS DISTINCT FROM OLD.environment OR
     NEW.metric IS DISTINCT FROM OLD.metric OR
     NEW.window_start IS DISTINCT FROM OLD.window_start OR
     NEW.window_end IS DISTINCT FROM OLD.window_end OR
     NEW.quantity < OLD.quantity OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'usage counter identity or monotonicity is invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION qkern_reject_usage_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'usage events are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER usage_quota_policy_update_guard
  BEFORE UPDATE ON usage_quota_policies FOR EACH ROW
  EXECUTE FUNCTION qkern_validate_usage_policy_update();
CREATE TRIGGER usage_counter_update_guard
  BEFORE UPDATE ON usage_counters FOR EACH ROW
  EXECUTE FUNCTION qkern_validate_usage_counter_update();
CREATE TRIGGER usage_events_update_guard
  BEFORE UPDATE OR DELETE ON usage_events FOR EACH ROW
  EXECUTE FUNCTION qkern_reject_usage_event_mutation();

ALTER TABLE usage_quota_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_quota_policies_select ON usage_quota_policies
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY usage_quota_policies_insert ON usage_quota_policies
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY usage_quota_policies_update ON usage_quota_policies
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY usage_counters_select ON usage_counters
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY usage_counters_insert ON usage_counters
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY usage_counters_update ON usage_counters
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY usage_events_select ON usage_events
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY usage_events_insert ON usage_events
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON usage_quota_policies,usage_counters,usage_events FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_validate_usage_policy_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_validate_usage_counter_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_reject_usage_event_mutation() FROM PUBLIC;

GRANT SELECT,INSERT ON usage_quota_policies TO qkern_runtime;
GRANT UPDATE (quota_limit,mode,revision,updated_by,updated_at) ON usage_quota_policies TO qkern_runtime;
GRANT SELECT,INSERT ON usage_counters TO qkern_runtime;
GRANT UPDATE (quantity,updated_at) ON usage_counters TO qkern_runtime;
GRANT SELECT,INSERT ON usage_events TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_validate_usage_policy_update() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_validate_usage_counter_update() TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_reject_usage_event_mutation() TO qkern_runtime;

COMMIT;
