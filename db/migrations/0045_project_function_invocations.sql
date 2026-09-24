BEGIN;

-- Das Aufrufprotokoll je Function — "Function-Logs als Produktflaeche" aus
-- der Paritaetsleiter, in der Form, die QKERN vertreten kann.
--
-- Protokolliert wird der **Aufruf**: Beginn, Dauer, Ausgang, Statuscode oder
-- ein fester Fehlercode. Bewusst **nicht** protokolliert werden stdout und
-- stderr: Sie stammen aus fremdem Code und koennten alles enthalten, was die
-- Function gesehen hat (die Haltung aus 1.22). Append-only: keine UPDATE-,
-- keine DELETE-Policy; was gelaufen ist, laesst sich nicht umschreiben.
CREATE TABLE project_function_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  function_id uuid NOT NULL,
  invocation_id uuid NOT NULL,
  invoked_by text NOT NULL CHECK (char_length(invoked_by) BETWEEN 1 AND 320),
  started_at timestamptz NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('completed', 'failed')),
  status_code integer CHECK (status_code BETWEEN 100 AND 599),
  -- Nur feste Codes, nie eine Meldung: Eine Datenbank- oder Sandbox-Meldung
  -- an dieser Stelle waere ein Leck.
  error_code text CHECK (error_code ~ '^[A-Z_]{3,64}$'),
  CONSTRAINT project_function_invocations_outcome_shape CHECK (
    (outcome = 'completed' AND status_code IS NOT NULL AND error_code IS NULL) OR
    (outcome = 'failed' AND status_code IS NULL AND error_code IS NOT NULL)),
  UNIQUE (organization_id, invocation_id),
  FOREIGN KEY (organization_id, project_id, environment, function_id)
    REFERENCES project_functions (organization_id, project_id, environment, id)
    ON DELETE CASCADE
);

CREATE INDEX project_function_invocations_recent_idx
  ON project_function_invocations (organization_id, function_id, started_at DESC);

ALTER TABLE project_function_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_function_invocations FORCE ROW LEVEL SECURITY;

CREATE POLICY project_function_invocations_tenant_select ON project_function_invocations
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_function_invocations_tenant_insert ON project_function_invocations
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_function_invocations
  FROM PUBLIC, qkern_worker, qkern_provisioner, qkern_auth;
GRANT SELECT ON project_function_invocations TO qkern_runtime;
GRANT INSERT (organization_id, project_id, environment, function_id, invocation_id,
  invoked_by, started_at, duration_ms, outcome, status_code, error_code)
  ON project_function_invocations TO qkern_runtime;

COMMIT;
