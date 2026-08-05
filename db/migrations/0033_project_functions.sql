-- Function-Definitionen.
--
-- Die Sandbox aus Release 1.22 laeuft, aber ihre Definitionen kamen aus dem
-- Nichts: Es gab keinen Ort, an dem ein Betreiber eine Function hinterlegen
-- konnte. Damit war sie eine Bibliothek, die niemand aufruft — dasselbe Muster,
-- das dieser Sprint schon beim Realtime-Poller, beim dauerhaften Event-Log und
-- bei der Webhook-Outbox gefunden hat.
--
-- Die Spaltengrenzen spiegeln `validateFunctionDefinition`. Sie stehen hier
-- zusaetzlich, nicht ersatzweise: Der Dienst prueft die Form genauer, aber ein
-- zweiter Schreiber umgeht den Dienst, nicht die Datenbank.

CREATE TABLE project_functions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment qkern_environment NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{2,62}$'),
  runtime text NOT NULL CHECK (runtime = 'nodejs24'),
  -- Inhaltsadressiert. Ein Tag waere veraenderlich, und derselbe Name koennte
  -- morgen einen anderen Inhalt bezeichnen.
  image text NOT NULL CHECK (image ~ '^[a-z0-9][a-z0-9./_-]{2,255}@sha256:[0-9a-f]{64}$'),
  entrypoint text NOT NULL CHECK (entrypoint ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'),
  timeout_ms integer NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 100 AND 300000),
  memory_mib integer NOT NULL DEFAULT 128 CHECK (memory_mib BETWEEN 64 AND 2048),
  max_concurrency integer NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 100),
  -- Leer bedeutet: kein Egress. Das ist der Normalfall und der einzige, den die
  -- Sandbox derzeit ausfuehrt; eine nicht leere Liste wird beim Aufruf
  -- abgewiesen, solange kein Egress-Proxy existiert.
  egress_origins text[] NOT NULL DEFAULT '{}'
    CHECK (coalesce(array_length(egress_origins, 1), 0) <= 20),
  -- Nur Referenzen. Ein Geheimniswert steht nie in dieser Tabelle.
  secret_refs text[] NOT NULL DEFAULT '{}'
    CHECK (coalesce(array_length(secret_refs, 1), 0) <= 20),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, environment)
    REFERENCES project_environments (organization_id, project_id, environment)
    ON DELETE CASCADE,
  CONSTRAINT project_functions_name_key
    UNIQUE (organization_id, project_id, environment, name),
  CONSTRAINT project_functions_scope_id_key
    UNIQUE (organization_id, project_id, environment, id)
);

CREATE INDEX project_functions_enabled_idx
  ON project_functions (organization_id, project_id, environment, name)
  WHERE enabled;

-- Alles ausser dem Aktivierungsflag ist unveraenderlich. Ein Aufruf darf
-- niemals gegen eine Definition laufen, die sich zwischen Aufloesen und
-- Ausfuehren veraendert hat; eine Aenderung erfolgt ueber Loeschen und
-- Neuanlegen und damit ueber den Audit-Weg.
CREATE OR REPLACE FUNCTION qkern_validate_project_function_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id
     OR NEW.project_id <> OLD.project_id OR NEW.environment <> OLD.environment
     OR NEW.name <> OLD.name OR NEW.runtime <> OLD.runtime OR NEW.image <> OLD.image
     OR NEW.entrypoint <> OLD.entrypoint OR NEW.timeout_ms <> OLD.timeout_ms
     OR NEW.memory_mib <> OLD.memory_mib OR NEW.max_concurrency <> OLD.max_concurrency
     OR NEW.egress_origins <> OLD.egress_origins OR NEW.secret_refs <> OLD.secret_refs
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'function definition is immutable except for the enabled flag'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_functions_guard
  BEFORE UPDATE ON project_functions FOR EACH ROW
  EXECUTE FUNCTION qkern_validate_project_function_update();

ALTER TABLE project_functions ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_functions_select ON project_functions
  FOR SELECT USING (organization_id = qkern_current_organization_id());
CREATE POLICY project_functions_insert ON project_functions
  FOR INSERT WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_functions_update ON project_functions
  FOR UPDATE USING (organization_id = qkern_current_organization_id())
  WITH CHECK (organization_id = qkern_current_organization_id());
CREATE POLICY project_functions_delete ON project_functions
  FOR DELETE USING (organization_id = qkern_current_organization_id());

REVOKE ALL ON project_functions FROM PUBLIC;
REVOKE ALL ON FUNCTION qkern_validate_project_function_update() FROM PUBLIC;

GRANT SELECT, INSERT, DELETE ON project_functions TO qkern_runtime;
-- Eng: ausschliesslich das Aktivierungsflag. Bild, Entrypoint, Grenzen und
-- Referenzen bleiben unveraenderlich, und zwar ueber das Spaltenrecht — eine
-- Pruefung im Dienst koennte ein zweiter Schreiber umgehen.
GRANT UPDATE (enabled) ON project_functions TO qkern_runtime;
GRANT EXECUTE ON FUNCTION qkern_validate_project_function_update() TO qkern_runtime;
